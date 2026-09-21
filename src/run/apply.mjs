import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extract, writeZip, collect } from '../util/zip.mjs';
import { readAddon } from '../verify/addon.mjs';
import { bundle } from '../util/bundle.mjs';
import { readState, writeState, makeHandoff } from './handoff.mjs';

function findAddonRoot(dir) {
  const hits = [];
  const walk = (d, depth = 0) => {
    if (depth > 6) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (list.some((e) => e.isFile() && e.name === 'manifest.json')) { hits.push(d); return; }
    for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(d, e.name), depth + 1);
  };
  walk(dir);
  if (!hits.length) throw new Error('返ってきた zip の中に manifest.json が見つかりません（アドオンのフォルダごと入れてもらってください）');
  if (hits.length > 1) {
    const scripted = hits.filter((h) => { try { return JSON.parse(fs.readFileSync(path.join(h, 'manifest.json'), 'utf8')).modules?.some((m) => m.type === 'script'); } catch { return false; } });
    if (scripted.length === 1) return scripted[0];
    throw new Error(`アドオンが ${hits.length} 個見つかりました。1 つにしてください:\n  ${hits.join('\n  ')}`);
  }
  return hits[0];
}

function findSpecs(dir) {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 6) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p, depth + 1); }
      else if (e.name.endsWith('.spec.mjs')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
};

/**
 * 入れ替える前に、返ってきた中身が動くかを見る。
 * 構文エラー・途中で切れたファイル・載せられない import は、ここで止める（入れ替えてから実機で気づくのでは遅い）。
 */
export function validate(pack) {
  const problems = [];
  const files = Object.fromEntries(Object.entries(pack.files)
    .map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString('utf8') : v]));

  for (const [rel, text] of Object.entries(files)) {
    if (!rel.endsWith('.js')) continue;
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`${rel}: ${(r.stderr ?? '').split('\n').find((l) => /Error|error/.test(l))?.trim() ?? '構文エラー'}`);
    if (/^\s*(\.\.\.|…|\/\/ 以下同じ|\/\/ 省略)/m.test(text)) problems.push(`${rel}: 中身が省略されています（… や「以下同じ」）`);
  }

  const entry = pack.manifest?.modules?.find((m) => m.type === 'script')?.entry;
  if (entry && files[entry] === undefined) problems.push(`入口がありません: ${entry}`);
  else if (entry) {
    const r = bundle({ files, entry });
    if (r.error) problems.push(`差し替えに載りません: ${r.error}`);
  }
  return problems.slice(0, 5);
}

export async function apply({ ROOT, zipPath, addonDir, specsDir, say = console.log, takeSpecs = true }) {
  if (!fs.existsSync(zipPath)) throw new Error(`zip がありません: ${zipPath}`);
  const state = readState(ROOT);
  const round = state.round ?? 0;
  const tmp = path.join(ROOT, '.bds-lab', 'incoming');
  await extract(zipPath, tmp);

  const src = findAddonRoot(tmp);
  const incoming = readAddon(src);          // ここで壊れた manifest は弾かれる
  say(`受け取りました: ${incoming.name}（${Object.keys(incoming.files).length} ファイル）`);

  const problems = validate(incoming);
  if (problems.length) {
    say('');
    say('✘ 入れ替えませんでした。返ってきた中身が動きません:');
    for (const p of problems) say(`  ${p}`);
    say('  いまのアドオンはそのまま残っています。直した zip をもう一度渡してください。');
    throw new Error(`返信を入れ替えられません: ${problems[0]}`);
  }

  const hist = path.join(ROOT, '.bds-lab', 'history', String(round).padStart(2, '0'));
  if (fs.existsSync(addonDir)) { fs.rmSync(hist, { recursive: true, force: true }); copyDir(addonDir, hist); }

  const keep = ['TASK.md'];
  const kept = {};
  for (const k of keep) { const p = path.join(addonDir, k); if (fs.existsSync(p)) kept[k] = fs.readFileSync(p); }
  fs.rmSync(addonDir, { recursive: true, force: true });
  copyDir(src, addonDir);
  for (const [k, v] of Object.entries(kept)) if (!fs.existsSync(path.join(addonDir, k))) fs.writeFileSync(path.join(addonDir, k), v);

  const specs = takeSpecs ? findSpecs(tmp).filter((p) => !p.startsWith(src)) : [];
  for (const p of specs) {
    const to = path.join(specsDir, path.basename(p));
    fs.mkdirSync(specsDir, { recursive: true });
    fs.copyFileSync(p, to);
    say(`  仕様書を取り込みました: ${path.basename(p)}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  say(`  前の版は .bds-lab/history/${path.basename(hist)}/ に残しました`);
  return { addon: incoming.name, files: Object.keys(incoming.files).length, specs: specs.length };
}

export async function cycle({ ROOT, zipPath, bdsDir, addonDir, specsDir, say = console.log, how = 'auto' }) {
  if (zipPath) await apply({ ROOT, zipPath, addonDir, specsDir, say });
  const { check } = await import('./check.mjs');
  const report = await check({ ROOT, bdsDir, addonDir, specsDir, say, how });
  say('');
  if (report.ok) {
    say('すべて通りました。仕上げるなら:');
    say('  npm run real     # 本物のクライアントで入力を確かめる');
    say('  npm run ship     # Release に上げる');
    say('  npm run publish  # public に出す');
  } else {
    makeHandoff({ ROOT, addonDir, specsDir, say });
  }
  return report;
}

export async function ship({ ROOT, addonDir, say = console.log, version = null }) {
  const { pushCurrent, gitReady } = await import('./github.mjs');
  const { publish } = await import('./release.mjs');
  if (gitReady(ROOT)) {
    const { branch, pushed } = pushCurrent({ ROOT, message: `ship ${version ?? ''}`.trim(), say });
    if (pushed) say(`  ${branch} に push しました`);
  }
  return publish({ ROOT, addonDir, say, version });
}
