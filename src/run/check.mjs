import fs from 'node:fs';
import * as childProcess from 'node:child_process';
import path from 'node:path';
import { LabSession } from './session.mjs';
import { loadSpecs, runSpecs, writeReport, readReport, summarize } from '../verify/spec-runner.mjs';
import { makeSimCtx } from '../verify/sim-ctx.mjs';
import { whyFailed } from './docs.mjs';

const apiFile = (ROOT) => path.join(ROOT, '.bds-lab', 'api.json');

export async function captureApi({ ROOT, session, say = () => {} }) {
  const file = apiFile(ROOT);
  const key = `${session.version}`;
  try {
    const have = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (have.version === key) return have;
  } catch { /* 取り直す */ }
  const api = await session.do('reflect', { depth: 2 }, { timeoutMs: 30000 }).catch(() => null);
  if (!api) return null;
  const doc = { version: key, at: new Date().toISOString(), api };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 1));
  say(`  この実機の API を書き出しました（${Object.keys(api).length} 個）: ${path.relative(ROOT, file)}`);
  return doc;
}

const nowIso = () => new Date().toISOString();

export const otherAddons = (ROOT, mine) => {
  try { return fs.readdirSync(path.join(ROOT, 'addons')).filter((n) => !n.startsWith('_') && n !== mine); }
  catch { return []; }
};

async function flow({ ROOT, session, specsDir, filter, say }) {
  const addon = session.addon.name;
  const specs = await loadSpecs(specsDir, { addon, others: otherAddons(ROOT, addon) });
  const r = await runSpecs({ specs, makeCtx: makeSimCtx(session), tag: 'sim', filter, say });
  return {
    at: nowIso(), version: session.version, addon: session.addon.name,
    ...r,
    scriptErrors: session.scriptErrors ?? [],
    realPending: specs.filter((s) => (s.tags ?? []).includes('real')).map((s) => s.name),
  };
}

export async function check({ ROOT, bdsDir, addonDir, specsDir, filter, say, json = false, how = 'auto' }) {
  const session = await LabSession.open({ bdsDir, addonDir, say });
  try {
    const up = await session.apply({ how });
    say(`  ${up.how === 'eval' ? `eval で入れました（${up.chars} 文字・前の版から ${up.cleared} 件外した）` : '入れ直しました'}`);
    await captureApi({ ROOT, session, say });
    const report = { ...(await flow({ ROOT, session, specsDir, filter, say })), how: up.how };
    const file = writeReport({ ROOT, report });
    say('');
    say(summarize(report));
    say(`結果: ${path.relative(ROOT, file)}`);
    if (json) console.log(JSON.stringify(report));
    return report;
  } finally {
    await session.close();
  }
}

export async function dev({ ROOT, bdsDir, addonDir, specsDir, filter, say, how = 'auto' }) {
  const session = await LabSession.open({ bdsDir, addonDir, say });
  let running = false;
  let again = false;

  const cycle = async (reason) => {
    if (running) { again = true; return; }
    running = true;
    try {
      say('');
      say(`── ${reason}（${new Date().toLocaleTimeString()}）`);
      const t0 = Date.now();
      const up = await session.apply({ how });
      const report = { ...(await flow({ ROOT, session, specsDir, filter, say })), how: up.how };
      writeReport({ ROOT, report });
      say('');
      say(summarize(report));
      say(`1 サイクル ${((Date.now() - t0) / 1000).toFixed(1)} 秒（${up.how === 'eval' ? `eval ${up.ms}ms` : `入れ直し ${up.ms}ms`}）`);
    } catch (e) {
      say(`✘ サイクルが失敗しました: ${String(e.message ?? e)}`);
    } finally {
      running = false;
      if (again) { again = false; cycle('続けて変更がありました'); }
    }
  };

  await cycle('はじめの 1 回');

  const onChange = (f) => {
    if (!f || /~$|\.swp$|^\./.test(path.basename(f))) return;
    clearTimeout(onChange.timer);
    onChange.timer = setTimeout(() => cycle(`${path.basename(f)} が変わりました`), 250);
  };
  // recursive: true は古い Linux の Node では使えない。使えなければ下の階層を 1 つずつ見張る
  const watch = (dir) => {
    if (!fs.existsSync(dir)) return;
    try {
      fs.watch(dir, { recursive: true }, (_e, f) => onChange(f));
    } catch {
      fs.watch(dir, (_e, f) => onChange(f));
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.')) watch(path.join(dir, e.name));
      }
    }
  };
  watch(addonDir);
  watch(specsDir);

  say('');
  say('見張っています。保存するたびに流し直します（Ctrl+C で終わり）');
  await new Promise(() => {});  // 止めるのは session が拾う Ctrl+C
}

function ensureRealDeps({ ROOT, say }) {
  const has = fs.existsSync(path.join(ROOT, 'node_modules', 'bedrock-protocol', 'package.json'));
  if (has) return { ok: true, why: null };
  const { spawnSync } = childProcess;
  const which = (b) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [b]).status === 0;
  if (!which('npm')) return { ok: false, why: 'npm がありません' };
  // npm に --prefix で置き場所を固定する。ここを決めないと、親の階層に pnpm の
  // ワークスペース（pnpm-lock.yaml）があるとそちらに吸われ、ROOT/node_modules に入らない。
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  say('  本物のクライアントに要る bedrock-protocol を入れています…');
  const r = spawnSync(npm, [
    'install', '--prefix', ROOT, '--no-save', '--ignore-scripts',
    '--no-audit', '--no-fund', '--loglevel', 'error', 'bedrock-protocol',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  if (r.status === 0 && fs.existsSync(path.join(ROOT, 'node_modules', 'bedrock-protocol', 'package.json'))) return { ok: true, why: null };
  return { ok: false, why: whyFailed(r) };
}

/**
 * 同じ実機に本物のクライアントで入り、tags:['real'] の仕様書を流す。
 * BDS は transport=raknet を強制してあるので、この版でも RakNet で入れる。
 */
export async function runReal({ ROOT, session, specs, filter, say, name = 'Cam', required = true, all = false }) {
  // --all のときは tags を見ずに全部を本物のクライアントで流す（sim で通ることと、
  // 本物のクライアント越しでも通ることは別なので、仕上げで一度は通しておきたい）
  const wanted = all ? specs.slice() : specs.filter((s) => (s.tags ?? []).includes('real'));
  if (!wanted.length) return { ok: true, total: 0, passed: 0, results: [], skipped: [] };

  const dep = ensureRealDeps({ ROOT, say });
  if (!dep.ok) {
    // 依存が入らないのは環境の話で、アドオンの欠陥ではない。
    // 明示的に real を叩いたときだけ失敗にし、auto の途中では飛ばして先へ進む。
    if (required) throw new Error(`bedrock-protocol を入れられませんでした（${dep.why}）`);
    say(`  本物のクライアントは飛ばします（bedrock-protocol が入りません: ${dep.why}）`);
    say(`    飛ばした ${wanted.length} 本: ${wanted.map((s) => s.name).join(' / ')}`);
    return { ok: true, total: 0, passed: 0, results: [], skipped: wanted.map((s) => s.name), why: dep.why };
  }

  const { makeRealCtx } = await import('../verify/real-ctx.mjs');
  say(`本物のクライアントで入ります（RakNet・ポート ${session.bds.port}）…`);
  const bot = await session.connectReal({ name });
  say(`  ${name} が入りました`);
  try {
    const tag = all ? null : 'real';
    return { skipped: [], ...(await runSpecs({ specs: wanted, makeCtx: makeRealCtx({ session, bot, name }), tag, filter, say })) };
  } finally {
    await session.disconnectReal();
  }
}

export async function real({ ROOT, bdsDir, addonDir, specsDir, filter, say, name = 'Cam', all = false }) {
  const session = await LabSession.open({ bdsDir, addonDir, say });
  try {
    await session.apply({ how: 'auto' });
    const addon = session.addon.name;
    const specs = await loadSpecs(specsDir, { addon, others: otherAddons(ROOT, addon) });
    const r = await runReal({ ROOT, session, specs, filter, say, name, required: true, all });
    const prev = readReport(ROOT) ?? {};
    writeReport({ ROOT, report: { ...prev, at: nowIso(), realResults: r.results, realOk: r.ok } });
    say('');
    say(`${r.passed}/${r.total} 通りました（本物のクライアント${all ? '・全部の仕様書' : ''}）`);
    return r;
  } finally {
    await session.close();
  }
}
