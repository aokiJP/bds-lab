// The lab's own knowledge follows Minecraft by itself (maintain runs this after it moves to a new BDS; maint checks it):
//   common/data/bds-versions.json       the BDS versions (downloads and `bds --update` when the download API is unreachable)
//   common/data/minecraft-modules.json  the @minecraft/* module versions for that BDS (`new` and `mode` without npm)
//   common/data/kb.json                 what the world is made of, for the goal planner: rebuilt on the lab's BDS (kb-build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const vcmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const semParts = (v) => v.split(/[-+]/)[0].split('.').map(Number);
const semCmp = (a, b) => { const x = semParts(a), y = semParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; const pa = Number(/preview\.(\d+)$/.exec(a)?.[1] ?? -1), pb = Number(/preview\.(\d+)$/.exec(b)?.[1] ?? -1); return pa - pb || (a < b ? -1 : a > b ? 1 : 0); };
const fam = (v) => String(v).split('.').slice(0, 3).join('.');
const data = (top, f) => path.join(top, 'common', 'data', f);
export function labBds(top) {
  for (const f of [path.join(top, 'bds', '.lab', 'bds', 'VERSION'), path.join(top, 'bds', 'vendor', 'bds-version.txt')]) { try { const v = fs.readFileSync(f, 'utf8').trim().split('\n')[0]; if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return v; } catch { /* next */ } }
  return null;
}
/** the BDS version in the version list (stable or preview); returns what changed, '' when it was there */
export function addVersion(top, v, { preview = false } = {}) {
  const f = data(top, 'bds-versions.json'); let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return ''; }
  const ch = new Set();
  for (const os of ['linux', 'windows']) {
    const o = j[os]; if (!o) continue;
    const list = preview ? (o.preview_versions ??= []) : (o.versions ??= []);
    if (!list.includes(v)) { list.push(v); list.sort(vcmp); ch.add(`+${v}`); }
    const key = preview ? 'preview' : 'stable';
    if (!o[key] || vcmp(v, o[key]) > 0) { o[key] = v; ch.add(`${key} ${v}`); }
  }
  if (ch.size) fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  return [...ch].join(', ');
}
/** the module versions for this BDS (stable / beta of its family, the newest preview beta); doc(name) → npm document */
export async function refreshModules(top, bds, doc) {
  const f = data(top, 'minecraft-modules.json'); let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
  const ch = [], bv = fam(bds);
  for (const [name, e] of Object.entries(j)) {
    if (!e?.versions) continue;
    let d; try { d = await doc(`@minecraft/${name}`); } catch { continue; }
    const all = Object.keys(d.versions ?? {}), time = d.time ?? {};
    const beta = all.filter((v) => v.endsWith(`-beta.${bv}-stable`)).sort(semCmp).at(-1);
    const until = beta && time[beta] ? Date.parse(time[beta]) + 3 * 864e5 : Infinity;
    const stable = all.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && !(Date.parse(time[v]) > until)).sort(semCmp).at(-1);
    const pbeta = all.filter((v) => /-beta\.\d+\.\d+\.\d+-preview\.\d+$/.test(v)).sort((a, b) => vcmp(/beta\.([\d.]+)-/.exec(a)[1], /beta\.([\d.]+)-/.exec(b)[1]) || semCmp(a, b)).at(-1);
    let any = false;
    for (const [k, v] of [['beta', beta], ['stable', stable], ['preview_beta', pbeta]]) {
      const cur = e.versions[k]?.version;
      if (!v || cur === v || (cur && k === 'stable' && semCmp(v, cur) < 0) || (k === 'stable' && e.versions.stable === null)) continue;
      e.versions[k] = { version: v, npm: `npm i @minecraft/${name}@${v}`, download: `https://registry.npmjs.org/@minecraft/${name}/-/${name}-${v}.tgz` };
      ch.push(`${name} ${k} ${v}`); any = true;
    }
    if (any) e.modified = Math.floor(Date.now() / 1000);
  }
  if (ch.length) fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  return ch;
}
/** { kb, bds, stale }: kb.json is for another BDS than the lab runs (major.minor.patch) */
export function kbState(top) {
  let kb = null; try { kb = /"version":\s*"([\d.]+)"/.exec(fs.readFileSync(data(top, 'kb.json'), 'utf8').slice(0, 4000))?.[1] ?? null; } catch { /* none */ }
  const bds = labBds(top);
  return { kb, bds, stale: !!(kb && bds && fam(kb) !== fam(bds) && vcmp(bds, kb) > 0) };
}
export function rebuildKb(top) {
  const r = spawnSync(process.execPath, [path.join(top, 'common', 'kb-build.mjs')], { cwd: top, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64e6, env: { ...process.env, LAB_NOTRACE: '1' } });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
  return { ok: r.status === 0 && lines.some((l) => l.startsWith('OK ')), line: lines.filter((l) => /^(OK|ERR|E )/.test(l)).at(-1) ?? lines.at(-1) ?? '' };
}
