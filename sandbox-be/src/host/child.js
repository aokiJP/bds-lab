// サンドボックスの子プロセス。host/spawn.js から起動される（直接は呼ばない）。
//
//   node --experimental-vm-modules [--permission …] src/host/child.js  < request.json
//
// 標準入力でリクエストを受け、標準出力に結果の JSON を 1 つだけ書く。
// 検証対象のコードは vm の文脈の中だけで動き、この Node プロセスの API には触れない。

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { DATA_DIR as DATA } from './paths.js';
import { assembleVmSource, mapStack, VM_FILENAME } from './assemble.js';

let spans = null; // 例外の位置を断片のファイルに戻すため

const ALLOWED = {
  '@minecraft/server': true,
  '@minecraft/server-ui': true,
};
// 実機にはあるが、このサンドボックスでは再現していないモジュール
const KNOWN_ELSEWHERE = new Set([
  '@minecraft/server-net', '@minecraft/server-admin', '@minecraft/server-gametest',
  '@minecraft/server-editor', '@minecraft/debug-utilities', '@minecraft/server-graphics',
  '@minecraft/diagnostics',
]);

function readStdin() {
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function norm(p) {
  return path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** manifest.json から、使うモジュールの版と入口を読む */
function readManifest(files) {
  const key = Object.keys(files).find((k) => norm(k).endsWith('manifest.json'));
  if (!key) return null;
  let m;
  try { m = JSON.parse(files[key]); } catch (e) { throw new Error(`manifest.json が JSON として読めません: ${e.message}`); }
  const base = path.posix.dirname(norm(key));
  const deps = {};
  for (const d of m.dependencies ?? []) {
    if (d.module_name) deps[d.module_name] = String(d.version);
  }
  const script = (m.modules ?? []).find((x) => x.type === 'script');
  return { deps, entry: script?.entry ? norm(path.posix.join(base === '.' ? '' : base, script.entry)) : null };
}


/**
 * パックの定義ファイル（blocks/ items/ entities/）を読む。実機はこれを読んで型を知るので、
 * サンドボックスも同じものを材料にする（推測はしない。書いてある値だけを渡す）。
 *   custom      components の中の名前空間付きの名前（minecraft: 以外）→ その値がパラメータ
 *               components["minecraft:custom_components"] の配列 → パラメータ無し（{}）
 *   components  そのまま（minecraft: のぶんも含む。体力や最大スタック数の出どころ）
 * permutations にも書けるので、そちらの components も同じ規則で拾う。
 */
export function readPackDefinitions(files) {
  const out = { blocks: {}, items: {}, entities: {}, lootTables: {} };
  // the pack's loot tables by their path from the pack root (loot_tables/entities/x.json), for what its mobs drop
  for (const [file, body] of Object.entries(files)) { const lm = /(?:^|\/)(loot_tables\/.+\.json)$/.exec(file); if (lm) { try { out.lootTables[lm[1]] = JSON.parse(body); } catch { /* not JSON */ } } }
  const addTag = (def, t) => { if (typeof t === 'string' && t && !def.tags.includes(t)) def.tags.push(t); };
  const collect = (def, components) => {
    for (const [name, params] of Object.entries(components ?? {})) {
      if (name === 'minecraft:custom_components') {
        for (const n of Array.isArray(params) ? params : []) if (typeof n === 'string') def.custom[n] ??= {};
        continue;
      }
      // タグ。"minecraft:tags": ["wood", …] / { "tags": [...] } と、古い書き方の "tag:wood": {}
      if (name === 'minecraft:tags') {
        for (const t of Array.isArray(params) ? params : Array.isArray(params?.tags) ? params.tags : []) addTag(def, t);
        continue;
      }
      if (name.startsWith('tag:')) { addTag(def, name.slice(4)); continue; }
      if (name.includes(':') && !name.startsWith('minecraft:')) def.custom[name] = params ?? {};
      else def.components[name] = params;
    }
  };
  for (const [file, body] of Object.entries(files)) {
    const m = /(?:^|\/)(blocks|items|entities)\/.+\.json$/.exec(file);
    if (!m) continue;
    const kind = m[1];
    let json;
    try { json = JSON.parse(body); } catch { continue; }
    const def = json?.['minecraft:block'] ?? json?.['minecraft:item'] ?? json?.['minecraft:entity'];
    const id = def?.description?.identifier;
    if (!id) continue;
    const into = (out[kind][id] ??= { custom: {}, components: {}, tags: [], summonable: def.description?.is_summonable !== false });
    // ブロックの状態（description.states）。実機はここに書いた順の最初の値が既定になる
    for (const [name, spec] of Object.entries(def.description?.states ?? {})) {
      const vals = Array.isArray(spec) ? spec
        : Array.isArray(spec?.values) ? spec.values
        : spec?.values && Number.isInteger(spec.values.min) && Number.isInteger(spec.values.max)
          ? Array.from({ length: spec.values.max - spec.values.min + 1 }, (_, i) => spec.values.min + i)
          : null;
      if (vals && vals.length) (into.states ??= {})[name] = vals;
    }
    collect(into, def.components);
    for (const perm of Array.isArray(def.permutations) ? def.permutations : []) collect(into, perm?.components);
    for (const grp of Object.values(def.component_groups ?? {})) collect(into, grp);
  }
  return out;
}

/**
 * vanilla.json に measured・behavior を足した 1 つの JSON（文脈の中で 1 回だけ読む）。ここで読んで書き直さず、文字のままつなぐ:
 * 4 MB を読んで書き直すだけで 1 回の実行の 100 ms だった。同じ名前の鍵は JSON.parse では後ろが勝つので、代入で重ねたのと同じ。
 * 壊れたファイル（測り直しの試しなど）は、文脈の中の JSON.parse が SyntaxError で止める（前はここで止めていた）
 */
export function vanillaJson(base, extra) {
  const body = base.trim();
  if (!body.startsWith('{') || !body.endsWith('}')) throw new SyntaxError('vanilla.json is not a JSON object');
  const parts = [body.slice(1, -1).trim()].filter(Boolean);
  for (const [k, v] of Object.entries(extra)) if (v != null) parts.push(`${JSON.stringify(k)}:${v.trim() || 'null'}`);
  return `{${parts.join(',')}}`;
}

async function main() {
  const req = JSON.parse(await readStdin());
  const api = fs.readFileSync(path.join(DATA, 'script-api.json'), 'utf8');
  const apiObj = JSON.parse(api);
  // 公式メタデータの一覧に、実機 BDS から測った値（既定の状態・タグ・体力など）を重ねる
  // 実測データの差し替え口（テストと、測り直したファイルの試し読み用）
  const measuredPath = process.env.SANDBOX_BE_MEASURED || path.join(DATA, 'vanilla-measured.json');
  // 公式のビヘイビアパック（ルートテーブル・エンティティ定義）
  const behaviorPath = path.join(DATA, 'behavior.json');
  const vanilla = vanillaJson(fs.readFileSync(path.join(DATA, 'vanilla.json'), 'utf8'), {
    measured: fs.existsSync(measuredPath) ? fs.readFileSync(measuredPath, 'utf8') : null,
    behavior: fs.existsSync(behaviorPath) ? fs.readFileSync(behaviorPath, 'utf8') : null,
  });

  const limits = { hangMs: 3000, spikeMs: 100, ticks: 100, ...(req.limits ?? {}) };
  const files = {};
  for (const [k, v] of Object.entries(req.files ?? {})) files[norm(k)] = String(v);
  if (typeof req.code === 'string') files['scripts/main.js'] ??= req.code;

  if (req.mode === 'coverage') files['scripts/main.js'] ??= '';
  const manifest = readManifest(files);
  const entry = norm(req.entry ?? manifest?.entry ?? (files['scripts/main.js'] !== undefined ? 'scripts/main.js' : Object.keys(files).find((k) => k.endsWith('.js')) ?? ''));
  if (files[entry] === undefined) return out({ fatal: { stage: 'load', name: 'Error', message: `入口のファイル ${entry || '(未指定)'} がありません` } });

  // 版の決定
  const versions = {};
  const notes = [];
  for (const mod of Object.keys(ALLOWED)) {
    const avail = apiObj.modules[mod].versions;
    const stable = avail.filter((v) => !/-beta$/.test(v)).at(-1) ?? avail.at(-1);   // (the default: the newest stable; a beta only when asked for)
    const want = manifest ? manifest.deps[mod] : (req.versions?.[mod] ?? stable);
    if (want === undefined) continue;
    const plain = String(want).replace(/-.*$/, '');
    // a beta the official metadata has: its own shape (APIs only it has exist; their behaviour only where measured)
    const beta = String(want) === 'beta' ? avail.filter((v) => /-beta$/.test(v)).at(-1) : avail.includes(String(want)) && /-beta$/.test(String(want)) ? String(want) : null;
    if (beta) {
      versions[mod] = beta;
      notes.push(`${mod} ${want} → ${beta}（公式メタデータの形。ベータだけの API の動きは測ったものだけ）`);
    } else if (/-beta/.test(String(want)) || String(want) === 'beta') {
      notes.push(`${mod} ${want} はベータです。サンドボックスは安定版 ${stable} の形で動かします（ベータだけの API は存在しない扱い）`);
      versions[mod] = stable;
    } else if (!avail.includes(plain)) {
      return out({ fatal: { stage: 'load', name: 'Error', message: `${mod} ${want} はこのゲーム版（${apiObj.game}）にありません。使える版: ${avail.join(', ')}` } });
    } else {
      versions[mod] = plain;
    }
  }

  // 文脈。null プロトタイプの器にすると、globalThis.constructor から外に出られない
  const sandbox = Object.create(null);
  const ctx = vm.createContext(sandbox, {
    name: 'bedrock-sandbox',
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });

  const assembled = assembleVmSource(bootstrap);
  spans = assembled.spans;
  const boot = new vm.Script(assembled.source, { filename: VM_FILENAME });
  const start = boot.runInContext(ctx);
  // start(api, vanilla, cfg) は、ホストが持つ関数（文脈の関数）を 1 つずつ返す
  const cfg = JSON.stringify({
    world: req.world ?? {},
    players: req.players,
    actions: req.actions ?? [],
    ui: req.ui ?? [],
    // パックの中の .mcfunction（/function と /schedule が読む）
    functions: Object.fromEntries(Object.entries(files)
      .map(([k, v]) => [/(?:^|\/)functions\/(.+)\.mcfunction$/.exec(k)?.[1], v])
      .filter(([k]) => k)),
    // パックの blocks/*.json・items/*.json で付けたカスタムコンポーネント（名前とパラメータ）
    definitions: readPackDefinitions(files),
    seed: req.seed ?? 1,
    clock: req.clock,
    carry: Boolean(req.carry),   // the report also says what a server restart would keep (world, players)
    limits,
  });
  const ctl = start(api, vanilla, cfg);
  ctl.setVersions(JSON.stringify(versions));
  ctl.wireAll();
  if (req.mode === 'coverage') {
    for (const m of Object.keys(ALLOWED)) ctl.buildModule(m);
    return out({ coverage: JSON.parse(ctl.coverage()) });
  }

  // 文脈の関数は、timeout の効く runInContext を通して呼ぶ
  const callScript = new vm.Script('(() => { const f = globalThis.__sb_call; delete globalThis.__sb_call; return f(); })()', { filename: 'sandbox-call.js' });
  function guarded(fn, timeout) {
    sandbox.__sb_call = fn;
    try {
      return callScript.runInContext(ctx, { timeout });
    } finally {
      delete sandbox.__sb_call;
    }
  }
  const isTimeout = (e) => e && (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /Script execution timed out/.test(String(e.message)));

  // モジュール
  const cacheMods = new Map();
  function apiModule(name) {
    if (cacheMods.has(name)) return cacheMods.get(name);
    const exp = ctl.buildModule(name);
    const names = ctl.keysOf(exp);
    const m = new vm.SyntheticModule(names, function init() {
      for (const n of names) this.setExport(n, ctl.get(exp, n));
    }, { context: ctx, identifier: name });
    cacheMods.set(name, m);
    return m;
  }
  const userMods = new Map();
  function userModule(file) {
    if (userMods.has(file)) return userMods.get(file);
    const m = new vm.SourceTextModule(files[file], {
      context: ctx,
      identifier: file,
      initializeImportMeta() {},
      importModuleDynamically() { throw new Error('動的 import はサポートされていません'); },
    });
    userMods.set(file, m);
    return m;
  }
  async function linker(spec, ref) {
    if (ALLOWED[spec]) {
      if (manifest && !manifest.deps[spec]) throw new Error(`manifest.json の dependencies に ${spec} がありません`);
      return apiModule(spec);
    }
    if (KNOWN_ELSEWHERE.has(spec)) {
      ctl.markUnsupported(`import ${spec}`);
      throw new Error(`[sandbox] ${spec} は実機（主に BDS）にはありますが、サンドボックスでは再現していません`);
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = path.posix.dirname(ref.identifier);
      const target = norm(spec.startsWith('/') ? spec : path.posix.join(base, spec));
      if (files[target] === undefined) throw new Error(`Module [${target}] not found. Native module error or file not found.`);
      return userModule(target);
    }
    throw new Error(`Module [${spec}] not found. Native module error or file not found.`);
  }

  const result = { versions, notes, hang: null, spikes: [], tickTimes: { max: 0, total: 0 } };
  let entryMod;
  try {
    entryMod = userModule(entry);
    await entryMod.link(linker);
  } catch (e) {
    return out({ fatal: { stage: 'load', name: e.name, message: e.message }, report: JSON.parse(ctl.report()), ...result });
  }

  // import していなくても、ゲーム側のクラスは存在する（イベントやプレイヤーの参加に要る）
  for (const mod of Object.keys(versions)) apiModule(mod);
  // API モジュールを先に評価し、その後で利用者のコード（early execution）
  for (const m of cacheMods.values()) { if (m.status === 'unlinked') await m.link(() => { throw new Error('unexpected'); }); await m.evaluate(); }
  let t0 = performance.now();
  try {
    ctl.enterEarly();
    await entryMod.evaluate({ timeout: limits.hangMs });
  } catch (e) {
    if (isTimeout(e)) {
      guarded(() => ctl.markHang(limits.hangMs), 1000);
      result.hang = { stage: 'load', ms: limits.hangMs };
      return out({ report: JSON.parse(ctl.report()), ...result });
    }
    ctl.logUncaught('スクリプトの読み込み', e);
    result.loadError = { name: e?.name, message: e?.message, stack: mapStack(e?.stack, spans) };
  }
  const loadMs = performance.now() - t0;
  if (loadMs > limits.spikeMs) result.spikes.push({ tick: 'load', ms: Math.round(loadMs) });

  if (!result.loadError) {
    guarded(() => ctl.startup(), limits.hangMs);
    for (let i = 0; i < limits.ticks; i++) {
      t0 = performance.now();
      try {
        guarded(() => ctl.beginTick(), limits.hangMs);
        for (;;) {
          const left = Math.max(1, Math.ceil(limits.hangMs - (performance.now() - t0)));
          if (!guarded(() => ctl.step(), left)) break;
          if (performance.now() - t0 > limits.hangMs) throw Object.assign(new Error('Script execution timed out'), { code: 'ERR_SCRIPT_EXECUTION_TIMEOUT' });
        }
      } catch (e) {
        if (isTimeout(e)) {
          const running = guarded(() => ctl.running(), 1000);
          guarded(() => ctl.markHang(limits.hangMs), 1000);
          result.hang = { stage: 'tick', tick: i, ms: limits.hangMs, running };
          break;
        }
        throw e;
      }
      const ms = performance.now() - t0;
      result.tickTimes.total += ms;
      if (ms > result.tickTimes.max) result.tickTimes.max = ms;
      if (ms > limits.spikeMs) {
        result.spikes.push({ tick: i, ms: Math.round(ms) });
        guarded(() => ctl.logSpike(i, Math.round(ms)), 1000);
      }
    }
  }
  result.tickTimes.max = Math.round(result.tickTimes.max * 100) / 100;
  result.tickTimes.total = Math.round(result.tickTimes.total);
  if (!result.hang && !result.loadError) {
    try { guarded(() => ctl.shutdown(), limits.hangMs); } catch (e) { if (!isTimeout(e)) throw e; }
  }
  const report = JSON.parse(guarded(() => ctl.report(), 5000));
  return out({ report, ...result });
}

/**
 * 文脈の中で評価される。ホストに渡すのは「文字列を受けて文字列（か文脈のオブジェクト）を返す」関数だけ。
 * @param {string} api
 */
function bootstrap(api, vanilla, cfg) {
  // eslint-disable-next-line no-undef
  const rt = SB_RUNTIME(api, vanilla, cfg);
  const realDate = Date;
  const clockNow = rt.now;
  // 仮想の時計と乱数
  const VDate = function Date(...a) {
    if (!new.target) return new realDate(clockNow()).toString();
    return a.length ? new realDate(...a) : new realDate(clockNow());
  };
  VDate.prototype = realDate.prototype;
  VDate.now = () => clockNow();
  VDate.parse = realDate.parse;
  VDate.UTC = realDate.UTC;
  Object.defineProperty(realDate.prototype, 'constructor', { value: VDate, writable: true, configurable: true });
  globalThis.Date = VDate;
  Math.random = rt.random;
  globalThis.console = rt.console;
  // 実機の Script API には無いもの
  for (const k of ['SharedArrayBuffer', 'Atomics', 'WebAssembly']) delete globalThis[k];

  return {
    setVersions: (v) => rt.setVersions(JSON.parse(v)),
    wireAll: () => rt.wireAll(),
    buildModule: (n) => rt.buildModule(n),
    keysOf: (o) => Object.keys(o),
    get: (o, k) => o[k],
    enterEarly: () => rt.enterEarly(),
    shutdown: () => rt.shutdown(),
    startup: () => rt.startup(),
    beginTick: () => rt.beginTick(),
    step: () => rt.step(),
    report: () => rt.report(),
    running: () => rt.running(),
    markHang: (ms) => rt.markHang(ms),
    logSpike: (t, ms) => rt.logSpike(t, ms),
    logUncaught: (label, e) => rt.logUncaught(label, e),
    markUnsupported: (k) => rt.markUnsupported(k),
    runCommandDirect: (c, p) => rt.runCommandDirect(c, p),
    coverage: () => rt.coverage(),
  };
}

main().catch((e) => {
  out({ fatal: { stage: 'host', name: e?.name, message: e?.message, stack: mapStack(e?.stack, spans) } });
  process.exitCode = 1;
});
