// node lab.mjs apidiff [<from> [<to>]] [--module server] [--stable] [--preview] [--all] [--md <file>]
// What changed in the Script API between two Minecraft versions, and where each addon uses what changed (file:line).
// Zero tokens and no server: the two index.d.ts come from npm (@minecraft/<module>), compared declaration by declaration.
//   <from> <to>: BDS versions (1.26.52, 1.26.60.28) or npm versions (npm:2.11.0-beta.1.26.52-stable)
//   defaults: from = this lab's BDS, to = the newest BDS (--preview: the newest preview: what the NEXT update will break)
//   --stable: the stable module versions of those BDS (default: beta, what `new` starts with)
// `maintain` hands the part that touches a unit to the AI, so it does not have to explore the API itself.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decls, MEMBER, members } from './dts.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(TOP, 'bds', '.lab', 'apidiff');
const docs = new Map();
const semParts = (v) => v.split(/[-+]/)[0].split('.').map(Number);
const semCmp = (a, b) => { const x = semParts(a), y = semParts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a < b ? -1 : a > b ? 1 : 0; };
export const fam3 = (v) => String(v).split('.').slice(0, 3).join('.');

export async function npmDoc(name) {
  if (docs.has(name)) return docs.get(name);
  const f = path.join(CACHE, `${name.replace('/', '__')}.json`);
  let j = null;
  try { const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { signal: AbortSignal.timeout(30000) }); if (r.ok) { j = await r.json(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ versions: Object.fromEntries(Object.entries(j.versions).map(([k, v]) => [k, { dist: { tarball: v.dist.tarball } }])), time: j.time })); } } catch { /* offline */ }
  if (!j) try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new Error(`npm に届きません（${name}）: ネットワークを確認してください`); }
  docs.set(name, j);
  return j;
}
/** the npm version of @minecraft/<module> that goes with a BDS version (beta, or the stable one out by then) */
export async function versionFor(module, bds, { stable = false } = {}) {
  const name = `@minecraft/${module}`, doc = await npmDoc(name), all = Object.keys(doc.versions);
  if (String(bds).startsWith('npm:')) return String(bds).slice(4);
  const [ma, mi, pa, build] = String(bds).split('.').map(Number);
  // this build's beta: the release one (-stable), else that preview build, else the newest preview of the family;
  // a hotfix without its own (1.26.45 → 1.26.44) takes the newest earlier one of the same family
  const ofPatch = (p) => {
    const vs = all.filter((v) => v.includes(`-beta.${ma}.${mi}.${p}-`)).sort(semCmp);
    const pv = (v) => Number(/preview\.(\d+)$/.exec(v)?.[1] ?? -1);
    return vs.filter((v) => v.endsWith('-stable')).at(-1) ?? vs.filter((v) => pv(v) === build).at(-1) ?? vs.sort((a, b) => pv(a) - pv(b) || semCmp(a, b)).at(-1);
  };
  let beta = null;
  for (let q = pa; q >= Math.floor(pa / 10) * 10 && !beta; q--) beta = ofPatch(q);
  if (!beta) throw new Error(`${name}: BDS ${bds} 用の版が npm にありません`);
  if (!stable) return beta;
  const until = Date.parse(doc.time?.[beta] ?? '') + 3 * 864e5;
  return all.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && !(Date.parse(doc.time?.[v]) > until)).sort(semCmp).pop();
}
function untar(buf, want) {
  for (let o = 0; o + 512 <= buf.length;) {
    const name = buf.toString('utf8', o, o + 100).replace(/\0.*$/s, ''), size = parseInt(buf.toString('utf8', o + 124, o + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    if (!name) break;
    if (name === want) return buf.subarray(o + 512, o + 512 + size).toString('utf8');
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}
export async function dtsOf(module, version) {
  const f = path.join(CACHE, `${module}@${version}.d.ts`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const doc = await npmDoc(`@minecraft/${module}`), url = doc.versions[version]?.dist?.tarball;
  if (!url) throw new Error(`@minecraft/${module}@${version} は npm にありません`);
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const t = untar(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())), 'package/index.d.ts');
  if (!t) throw new Error(`index.d.ts が @minecraft/${module}@${version} にありません`);
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, t);
  return t;
}

// ---- the comparison ----
const memberMap = (body) => { const m = new Map(); for (const l of members(body)) { const k = MEMBER.exec(l)?.[1] ?? l.trim().split(/[ =:(]/)[0]; if (k) m.set(k, l.trim()); } return m; };
const plain = (l) => l.replace(/\s*\/\/.*$/, '').replace(/\s+/g, ' ').trim();
const kindOf = (body) => /^\s*(?:abstract )?(class|interface|enum|type|function|const)\b/.exec(body)?.[1] ?? '?';
/** { removed: [{name, member?, was}], added, changed: [{name, member, was, now}], stable: [{name, member}] } */
export function diff(textA, textB) {
  const A = decls([{ text: textA }]), Bm = decls([{ text: textB }]), res = { removed: [], added: [], changed: [], stable: [], owners: {} };
  for (const [, body] of A) for (const k of memberMap(body).keys()) res.owners[k] = (res.owners[k] ?? 0) + 1;   // how many declarations have a member of that name
  for (const [n, body] of A) {
    if (!Bm.has(n)) { res.removed.push({ name: n, kind: kindOf(body), was: plain(body.split('\n')[0]) }); continue; }
    const a = memberMap(body), b = memberMap(Bm.get(n)), ok = kindOf(body) === 'class';   // (a class method: worth a guess by name alone)
    for (const [k, l] of a) {
      if (!b.has(k)) res.removed.push({ name: n, member: k, was: plain(l), guess: ok && /\(/.test(l) });
      else if (plain(l) !== plain(b.get(k))) res.changed.push({ name: n, member: k, was: plain(l), now: plain(b.get(k)), guess: ok && /\(/.test(l) });
      else if (/\bbeta\b/.test(l.split('//')[1] ?? '') && !/\bbeta\b/.test(b.get(k).split('//')[1] ?? '')) res.stable.push({ name: n, member: k });
    }
    for (const [k, l] of b) if (!a.has(k)) res.added.push({ name: n, member: k, now: plain(l) });
    const ha = plain(body.split('\n')[0]), hb = plain(Bm.get(n).split('\n')[0]);
    if (ha !== hb && !a.size && !b.size) res.changed.push({ name: n, member: null, was: ha, now: hb });
  }
  for (const [n, body] of Bm) if (!A.has(n)) res.added.push({ name: n, kind: kindOf(body), now: plain(body.split('\n')[0]) });
  return res;
}

// ---- where a unit uses what changed ----
const srcFiles = (d, acc = []) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|dist|\.lab)$/.test(e.name)) srcFiles(p, acc); } else if (/\.[cm]?[jt]s$/.test(e.name) && !/\.d\.ts$|kit\.[jt]s$/.test(e.name)) acc.push(p); } } catch { /* none */ } return acc; };
export function unitFiles(unitDir) { const s = srcFiles(path.join(unitDir, 'src')); return s.length ? s : srcFiles(path.join(unitDir, 'bp', 'scripts')); }
const COMMON = new Set('has get set add delete clear size keys values entries forEach map filter find findIndex some every push pop shift unshift length includes indexOf join slice splice concat sort reverse then catch finally toString valueOf name id type value x y z start stop run open close update remove reset data'.split(' '));
/** [{ file, line, text, what }] for the removed/changed things a unit's scripts mention */
export function impact(d, unitDir) {
  const hits = [], files = unitFiles(unitDir), topNames = new Set(d.removed.filter((x) => !x.member).map((x) => x.name));
  const mem = new Map();
  for (const x of [...d.removed, ...d.changed]) if (x.member) (mem.get(x.member) ?? mem.set(x.member, []).get(x.member)).push(x);
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const imports = new Set([...lines.join('\n').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@minecraft\/[\w-]+['"]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)));
    lines.forEach((t, i) => {
      if (/^\s*(\/\/|\*)/.test(t)) return;
      for (const n of topNames) if (new RegExp(`\\b${n}\\b`).test(t) && (imports.has(n) || /@minecraft\//.test(t))) hits.push({ file: f, line: i + 1, text: t.trim(), what: `${n} (removed)` });
      for (const [m, xs] of mem) {
        if (!new RegExp(`\\.${m}\\b`).test(t)) continue;
        const x = xs[0], sure = xs.length === 1 && (imports.has(x.name) || new RegExp(`\\b${x.name}\\b`).test(t));
        if (!sure && (COMMON.has(m) || !xs.some((y) => y.guess))) continue;   // a property or an interface member: only when the owner is named   // .has / .get / .length ...: a Map or an array far more often than this API
        if (!sure && (d.owners?.[m] ?? 0) > xs.length) continue;   // .subscribe: other declarations have it unchanged, so this one is a guess
        hits.push({ file: f, line: i + 1, text: t.trim(), what: `${xs.map((y) => `${y.name}.${m}`).join(' / ')} ${x.now ? 'changed' : 'removed'}${sure ? '' : '?'}` });
      }
    });
  }
  return hits;
}

const UNITS = path.join(TOP, 'bds', 'addons');
export function labBds() {
  for (const f of [path.join(TOP, 'bds', '.lab', 'bds', 'VERSION'), path.join(TOP, 'bds', 'vendor', 'bds-version.txt')]) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^\d+\.\d+\.\d+/.test(v)) return v; } catch { /* next */ } }
  return null;
}
export async function newestBds(preview = false) {
  const j = await (await fetch('https://net-secondary.web.minecraft-services.net/api/v1.0/download/links', { signal: AbortSignal.timeout(20000) })).json();
  return /(\d+\.\d+\.\d+\.\d+)/.exec(j.result.links.find((l) => l.downloadType === (preview ? 'serverBedrockPreviewLinux' : 'serverBedrockLinux'))?.downloadUrl ?? '')?.[1] ?? null;
}
/** the text maintain gives the AI: only what this unit touches (a few hundred tokens instead of the whole API) */
export async function forUnit(unitDir, from, to, { module = 'server', stable = false } = {}) {
  const va = await versionFor(module, from, { stable }), vb = await versionFor(module, to, { stable });
  if (va === vb) return { va, vb, text: '', hits: [] };
  const d = diff(await dtsOf(module, va), await dtsOf(module, vb)), hits = impact(d, unitDir);
  const rel = (f) => path.relative(unitDir, f).split(path.sep).join('/');
  const used = new Set(hits.map((h) => h.what.split(' ')[0]));
  const lines = [`@minecraft/${module} ${va} → ${vb}:`, ...hits.slice(0, 40).map((h) => `  ${rel(h.file)}:${h.line} ${h.what}: ${h.text.slice(0, 120)}`)];
  for (const x of d.changed) if (used.has(`${x.name}.${x.member}`)) lines.push(`  now: ${x.name}.${x.member}: ${x.now.slice(0, 200)}`);
  return { va, vb, text: hits.length ? lines.join('\n') : '', hits, diff: d };
}

export async function apidiffCmd(args, out = console.log) {
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const module = flag('--module') ?? 'server', md = flag('--md'), stable = args.includes('--stable'), preview = args.includes('--preview'), all = args.includes('--all');
  const pos = args.filter((a) => !a.startsWith('--'));
  const from = pos[0] ?? labBds() ?? (() => { throw new Error('このラボの BDS がまだありません: apidiff <from> <to> で版を指定してください'); })();
  const to = pos[1] ?? await newestBds(preview);
  if (!to) throw new Error('最新の BDS が分かりません: apidiff <from> <to>');
  const va = await versionFor(module, from, { stable }), vb = await versionFor(module, to, { stable });
  out(`@minecraft/${module}: ${va} (BDS ${fam3(from)}) → ${vb} (BDS ${fam3(to)})`);
  if (va === vb) { out('OK 同じ版です（変更なし）'); return true; }
  const d = diff(await dtsOf(module, va), await dtsOf(module, vb));
  const cut = (xs, n, f) => { xs.slice(0, n).forEach((x) => out(f(x))); if (xs.length > n) out(`  … ほか ${xs.length - n}（--all で全部）`); };
  const N = all ? 1e9 : 25;
  out(`removed ${d.removed.length} | changed ${d.changed.length} | added ${d.added.length} | beta→stable ${d.stable.length}`);
  if (d.removed.length) { out('## 消えたもの（使っていれば壊れる）'); cut(d.removed, N, (x) => `- ${x.name}${x.member ? '.' + x.member : ` (${x.kind})`}`); }
  if (d.changed.length) { out('## 変わったもの'); cut(d.changed, N, (x) => `- ${x.name}.${x.member ?? ''}\n    was: ${x.was.slice(0, 160)}\n    now: ${x.now.slice(0, 160)}`); }
  if (d.stable.length) { out('## beta から stable になったもの（--stable でも使える）'); cut(d.stable, N, (x) => `- ${x.name}.${x.member}`); }
  if (d.added.length) { out('## 増えたもの'); cut(d.added, all ? 1e9 : 40, (x) => `- ${x.name}${x.member ? '.' + x.member : ` (${x.kind})`}`); }
  // every addon: what of it breaks
  let names = []; try { names = fs.readdirSync(UNITS).filter((n) => fs.statSync(path.join(UNITS, n)).isDirectory()); } catch { /* none */ }
  const rows = [];
  for (const n of names) { const h = impact(d, path.join(UNITS, n)); rows.push([n, h]); }
  out('## アドオンへの影響（? は同名の別物かもしれない箇所）');
  for (const [n, h] of rows) {
    out(`${h.length ? '✘' : '✔'} ${n}${h.length ? `: ${h.length} 箇所` : ''}`);
    h.slice(0, all ? 1e9 : 8).forEach((x) => out(`    ${path.relative(path.join(UNITS, n), x.file).split(path.sep).join('/')}:${x.line} ${x.what}`));
  }
  if (md) {
    const body = [`# @minecraft/${module} ${va} → ${vb}`, '', `BDS ${from} → ${to}`, '',
      '## Removed', ...d.removed.map((x) => `- \`${x.name}${x.member ? '.' + x.member : ''}\``), '', '## Changed', ...d.changed.map((x) => `- \`${x.name}.${x.member ?? ''}\`\n  - was: \`${x.was}\`\n  - now: \`${x.now}\``), '',
      '## Beta → stable', ...d.stable.map((x) => `- \`${x.name}.${x.member}\``), '', '## Added', ...d.added.map((x) => `- \`${x.name}${x.member ? '.' + x.member : ''}\``), '',
      '## Addons', ...rows.map(([n, h]) => `- ${h.length ? '✘' : '✔'} ${n}${h.map((x) => `\n  - ${path.relative(path.join(UNITS, n), x.file).split(path.sep).join('/')}:${x.line} ${x.what}`).join('')}`), ''].join('\n');
    fs.mkdirSync(path.dirname(path.resolve(md)), { recursive: true }); fs.writeFileSync(path.resolve(md), body); out(`OK ${md}`);
  }
  return true;
}
