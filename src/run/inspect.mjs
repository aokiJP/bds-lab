import fs from 'node:fs';
import path from 'node:path';

import { readAddon } from '../verify/addon.mjs';
import { bundle } from '../util/bundle.mjs';
import { moduleData, manifestVersion } from '../util/modules.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 実機の JSON は // のコメントを許す。素の JSON.parse は弾くので、落とす前に一度だけ外して試す。
 * 外して通るなら「壊れてはいない」（ただし他の道具は弾く）と分かる。
 */
export function parseLoose(text) {
  const body = Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
  try { return { ok: true, value: JSON.parse(body), comments: false }; } catch (e) {
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
    try { return { ok: true, value: JSON.parse(stripped), comments: true }; }
    catch { return { ok: false, why: String(e.message).slice(0, 80) }; }
  }
}

/**
 * 実機を上げずに分かることを、全部ここで見る。
 * 起動 1 回ぶん（十数秒〜1 分）を使う前に、確実に落ちると分かっているものを落とす。
 */
const CHECKS = [];
const check = (id, fn) => CHECKS.push({ id, fn });

const err = (what, why, where = null) => ({ level: 'error', what, why, where });
const warn = (what, why, where = null) => ({ level: 'warn', what, why, where });

check('manifest', ({ addon }) => {
  const out = [];
  const m = addon.manifest;
  if (m.format_version !== 2 && m.format_version !== 1) out.push(warn('manifest.json', `format_version が ${m.format_version} です（ふつうは 2）`));
  if (!UUID.test(m.header?.uuid ?? '')) out.push(err('manifest.json', `header.uuid が UUID の形ではありません: ${m.header?.uuid}`));
  if (!Array.isArray(m.header?.version)) out.push(err('manifest.json', 'header.version は [1, 0, 0] の形の配列です'));
  const ids = new Set([m.header?.uuid]);
  for (const mod of m.modules ?? []) {
    if (!UUID.test(mod.uuid ?? '')) out.push(err('manifest.json', `modules[].uuid が UUID の形ではありません: ${mod.uuid}`));
    if (ids.has(mod.uuid)) out.push(err('manifest.json', `同じ UUID が 2 か所にあります: ${mod.uuid}`));
    ids.add(mod.uuid);
  }
  if (addon.rp) {
    if (addon.rp.uuid === m.header?.uuid) out.push(err('manifest.json', 'ビヘイビアとリソースの header.uuid が同じです'));
    const needs = (m.dependencies ?? []).filter((d) => d.uuid).map((d) => d.uuid);
    if (needs.length && !needs.includes(addon.rp.uuid)) {
      out.push(warn('manifest.json', `BP が依存している UUID（${needs.join(' / ')}）と、同梱のリソースパック（${addon.rp.uuid}）が違います`));
    }
  } else if ((m.dependencies ?? []).some((d) => d.uuid)) {
    out.push(err('manifest.json', 'BP が別のパックに依存していますが、リソースパックが入っていません。実機はこの BP を読み込みません'));
  }
  return out;
});

check('modules', ({ addon }) => {
  const out = [];
  const known = moduleData();
  for (const d of addon.manifest.dependencies ?? []) {
    if (!d.module_name) continue;
    const name = String(d.module_name).replace('@minecraft/', '');
    if (!known[name]) { out.push(warn('manifest.json', `${d.module_name} は版の一覧にありません（npm run update で更新できます）`)); continue; }
    const now = manifestVersion(name, String(d.version).includes('beta') ? 'beta' : 'stable');
    const major = (v) => String(v).split('.')[0];
    if (now && major(now) !== major(d.version)) {
      out.push(err('manifest.json', `${d.module_name} ${d.version} は古い系列です。いまの実機は ${now} 系なので読み込まれません`));
    }
  }
  if (!(addon.manifest.dependencies ?? []).some((d) => d.module_name === '@minecraft/server')) {
    out.push(err('manifest.json', 'script モジュールがあるのに @minecraft/server への依存がありません'));
  }
  return out;
});

check('entry', ({ addon }) => {
  const out = [];
  if (!addon.files[addon.entry]) out.push(err(addon.entry, '入口のファイルがありません'));
  return out;
});

check('imports', ({ addon }) => {
  // 実機の import は拡張子まで書かないと通らない。bundle が使うのと同じ解決で確かめる
  const js = Object.fromEntries(Object.entries(addon.files).filter(([k]) => k.endsWith('.js')));
  const b = bundle({ files: js, entry: addon.entry });
  if (!b.error) return [];
  return b.error.split(' / ').map((why) => (/読めない import|入口がありません|見つからない/.test(why)
    ? err('scripts/', why)
    : warn('scripts/', `${why}（動きますが、eval での入れ替えは使えません）`)));
});

check('script-eval', ({ addon }) => {
  const uses = Object.entries(addon.files).filter(([k, v]) => k.endsWith('.js') && /\bnew Function\b|\beval\s*\(/.test(v));
  if (!uses.length) return addon.scriptEval ? [] : [];
  if (addon.scriptEval) return [];
  return [err(uses[0][0], 'new Function / eval を使っていますが、manifest の capabilities に "script_eval" がありません')];
});

const PATTERNS = [
  [/world\.beforeEvents\.chatSend|afterEvents\.chatSend/, 'error', 'chatSend は @minecraft/server 2.x にありません。scriptevent を使ってください'],
  [/new\s+Proxy\s*\(/, 'error', 'Proxy は実機が弾きます（proxy: inconsistent get）。素の入れ物に写してください'],
  [/getAllPlayers\(\)(?!\s*\.filter)/, 'warn', 'getAllPlayers() は undefined を混ぜることがあります。.filter(Boolean) を挟んでください'],
  [/\bsetFov\s*\(\s*(\d+(?:\.\d+)?)\s*\)/, 'warn', 'camera.setFov の範囲は [30, 110] です'],
  [/getComponent\(\s*['"]minecraft:flying_speed['"]/, 'warn', 'flying_speed はプレイヤーに付いていません（null が返ります）'],
  [/\bdebugger\b/, 'warn', 'debugger が残っています'],
  [/console\.log\s*\(/, 'warn', 'console.log は実機のログに出ません。console.warn を使ってください'],
];

check('scripts', ({ addon }) => {
  const out = [];
  for (const [rel, body] of Object.entries(addon.files)) {
    if (!rel.endsWith('.js')) continue;
    for (const [re, level, why] of PATTERNS) {
      const m = re.exec(body);
      if (!m) continue;
      const line = body.slice(0, m.index).split('\n').length;
      out.push(level === 'error' ? err(`${rel}:${line}`, why) : warn(`${rel}:${line}`, why));
    }
  }
  return out;
});

check('import-extension', ({ addon }) => {
  const out = [];
  for (const [rel, body] of Object.entries(addon.files)) {
    if (!rel.endsWith('.js')) continue;
    const hits = [...body.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)].filter((m) => !/\.(js|mjs|json)$/.test(m[1]));
    if (!hits.length) continue;
    const line = body.slice(0, hits[0].index).split('\n').length;
    out.push(warn(`${rel}:${line}`, `相対 import に拡張子がありません（${hits[0][1]}）。版によっては Import [...] not found になります。npm run inspect -- --fix で付けられます`));
  }
  return out;
});

check('json', ({ addon }) => {
  const out = [];
  const ids = new Map();
  for (const [rel, body] of Object.entries(addon.files)) {
    if (!rel.endsWith('.json') || rel === 'manifest.json') continue;
    const parsed = parseLoose(body);
    if (!parsed.ok) { out.push(err(rel, `JSON として読めません: ${parsed.why}`)); continue; }
    if (parsed.comments) out.push(warn(rel, 'コメント（//）が入った JSON です。実機は読めますが、ほかの道具は弾きます'));
    const doc = parsed.value;
    if (!doc.format_version && /^(entities|items|blocks|recipes|spawn_rules)\//.test(rel)) {
      out.push(warn(rel, 'format_version がありません'));
    }
    const id = doc['minecraft:entity']?.description?.identifier
      ?? doc['minecraft:item']?.description?.identifier
      ?? doc['minecraft:block']?.description?.identifier;
    if (!id) continue;
    if (ids.has(id)) out.push(err(rel, `identifier が ${ids.get(id)} と重複しています: ${id}`));
    else ids.set(id, rel);
  }
  return out;
});

check('resource-pack', ({ addon }) => {
  const out = [];
  if (!addon.rp) return out;
  for (const [rel, body] of Object.entries(addon.rp.files)) {
    if (!rel.endsWith('.json')) continue;
    const parsed = parseLoose(Buffer.isBuffer(body) ? body.toString('utf8') : body);
    if (!parsed.ok) out.push(err(`resource_pack/${rel}`, `JSON として読めません: ${parsed.why}`));
    else if (parsed.comments) out.push(warn(`resource_pack/${rel}`, 'コメント（//）が入った JSON です。実機は読めますが、ほかの道具は弾きます'));
  }
  return out;
});

check('size', ({ addon }) => {
  const out = [];
  const total = Object.values(addon.files).reduce((n, v) => n + Buffer.byteLength(v), 0);
  if (total > 20 * 1024 * 1024) out.push(warn('behavior_pack/', `ビヘイビアが ${(total / 1024 / 1024).toFixed(1)}MB あります。読み込みが遅くなります`));
  return out;
});

/** 同じ理由のものは 1 行にまとめる。64 体ぶん同じ警告が並んでも読めない */
function fold(list) {
  const byWhy = new Map();
  for (const f of list) {
    const hit = byWhy.get(f.why);
    if (hit) { hit.more = (hit.more ?? 0) + 1; continue; }
    byWhy.set(f.why, { ...f });
  }
  return [...byWhy.values()];
}

/**
 * 分かっている範囲で直せるものを直す（--fix）。
 * 直すのは「実機が読み込めない」ところだけで、中身の作りには手を入れない。
 */
export function fix({ addonDir, say = console.log }) {
  const addon = readAddon(addonDir);
  const done = [];

  const file = path.join(addon.bpDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  let touched = false;
  for (const d of manifest.dependencies ?? []) {
    if (!d.module_name) continue;
    const name = String(d.module_name).replace('@minecraft/', '');
    const now = manifestVersion(name, addon.lab.beta ? 'beta' : 'stable');
    if (!now || now === d.version) continue;
    done.push(`${d.module_name}: ${d.version} → ${now}`);
    d.version = now;
    touched = true;
  }
  if (!(manifest.capabilities ?? []).includes('script_eval')) {
    manifest.capabilities = [...(manifest.capabilities ?? []), 'script_eval'];
    done.push('capabilities に script_eval を足しました（保存のたびの入れ替えが 1 秒以下になります）');
    touched = true;
  }
  if (touched) fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

  let fixedImports = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.name.endsWith('.js')) continue;
      const before = fs.readFileSync(abs, 'utf8');
      const after = before.replace(/((?:from|import)\s*)(['"])(\.[^'"]*)\2/g, (whole, head, q, spec) => (/\.(js|mjs|json)$/.test(spec) ? whole : `${head}${q}${spec}.js${q}`));
      if (after === before) continue;
      fs.writeFileSync(abs, after);
      fixedImports++;
    }
  };
  const scripts = path.join(addon.bpDir, 'scripts');
  if (fs.existsSync(scripts)) walk(scripts);
  if (fixedImports) done.push(`相対 import に .js を付けました（${fixedImports} ファイル）`);

  if (done.length) { say('直しました:'); for (const d of done) say(`  ${d}`); }
  else say('直せるところはありませんでした');
  return { done };
}

/** 実機を上げずに、アドオンを丸ごと検める */
export function inspect({ ROOT, addonDir, say = console.log }) {
  const addon = readAddon(addonDir);
  const found = [];
  for (const c of CHECKS) {
    try { found.push(...(c.fn({ ROOT, addon }) ?? [])); }
    catch (e) { found.push(warn(c.id, `この検査自体が落ちました: ${String(e.message ?? e)}`)); }
  }
  const errors = found.filter((f) => f.level === 'error');
  const warns = found.filter((f) => f.level === 'warn');

  say(`${addon.name} を検めました（実機は上げていません）`);
  say(`  ビヘイビア: ${Object.keys(addon.files).length} ファイル・入口 ${addon.entry}`);
  if (addon.rp) say(`  リソース: ${Object.keys(addon.rp.files).length} ファイル`);
  say('');
  for (const f of fold([...errors, ...warns])) say(`${f.level === 'error' ? '✘' : '⚠'} ${f.what}${f.more ? `（ほか ${f.more} 件）` : ''}\n   ${f.why}`);
  if (!found.length) say('✔ 気になるところはありませんでした');
  say('');
  say(errors.length ? `${errors.length} 件は実機で必ず問題になります（警告 ${warns.length} 件）` : `実機で落ちるものはありません（警告 ${warns.length} 件）`);
  return { ok: errors.length === 0, errors, warns, addon: addon.name };
}
