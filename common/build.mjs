// Script build for addons with src/ (TypeScript or JavaScript): esbuild bundle -> bp/<manifest entry>,
// tsc type check before BDS boots, and source maps so BDS errors point at src/ lines.
// Types and Mojang libraries live in one shared SDK per (module versions) in the cache: no node_modules per addon
// unless the addon adds its own npm libraries (`lib add`).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const WIN = process.platform === 'win32';
const exists = (f) => fs.existsSync(f);
// native modules the game provides (never bundled); everything else that is imported gets bundled
export const NATIVE = ['@minecraft/server', '@minecraft/server-ui', '@minecraft/server-gametest', '@minecraft/server-net', '@minecraft/server-admin',
  '@minecraft/server-editor', '@minecraft/server-graphics', '@minecraft/common', '@minecraft/debug-utilities', '@minecraft/diagnostics'];
export const LIBS = ['@minecraft/math', '@minecraft/vanilla-data', '@minecraft/gameplay-utilities'];   // bundled Mojang libraries, always in the SDK
const TOOLS = { esbuild: '^0.28.0', typescript: '~6.0.3' };
const ENV_TYPES = '@bedrock-apis/env-types@1.1.0-rc';

function npmI(dir, specs, extra = []) {
  fs.mkdirSync(dir, { recursive: true });
  if (!exists(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}\n');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', ...specs, '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps', ...extra], { cwd: dir, encoding: 'utf8', shell: WIN });
  if (r.status !== 0) throw new Error(`npm i ${specs.join(' ')} failed:\n${(r.stderr || r.stdout).slice(-600)}`);
}

// esbuild + typescript, installed once into the cache
export function tools(cache) {
  const dir = path.join(cache, 'tool');
  const want = JSON.stringify(TOOLS);
  const stamp = path.join(dir, 'stamp');
  if (!exists(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
    npmI(dir, Object.entries(TOOLS).map(([k, v]) => `${k}@${v}`));
    fs.writeFileSync(stamp, want);
  }
  const req = createRequire(path.join(dir, 'package.json'));
  return { req, esbuild: req('esbuild'), get ts() { return req('typescript'); } };
}

// npm version of a manifest dependency for this BDS: "2.11.0-beta" -> "2.11.0-beta.1.26.51-stable"
export function npmVersion(doc, want, bv) {
  const vs = Object.keys(doc.versions);
  if (vs.includes(want)) return want;
  return vs.filter((x) => x.startsWith(want + '.') && x.includes(bv + '-stable')).pop()
    ?? vs.filter((x) => x.startsWith(want + '.') && x.includes(bv)).pop()
    ?? vs.filter((x) => x.startsWith(want + '.')).pop()
    ?? vs.filter((x) => x.startsWith(want)).pop();
}

// shared SDK: @minecraft/* types at the manifest's versions + Mojang libs + env types. Keyed by the exact set.
// Which exact set a manifest means (npm's newest build for this BDS) is remembered for SDK_MEMO_MS: every build used to fetch
// the five packages' whole version lists from npm first (about 0.6 s, offline it failed); LAB_SDK_MEMO=0 asks npm every time
const SDK_MEMO_MS = 12 * 3600_000;
export async function sdk({ cache, bv, deps, npmDoc }) {
  const memo = path.join(cache, 'sdk', 'resolved.json');
  const want = JSON.stringify([bv, deps.filter((d) => d.module_name?.startsWith('@minecraft/')).map((d) => `${d.module_name}@${d.version}`).sort(), LIBS, ENV_TYPES]);
  const read = () => { try { return JSON.parse(fs.readFileSync(memo, 'utf8')); } catch { return {}; } };
  if (process.env.LAB_SDK_MEMO !== '0') {
    const m = read()[want];
    if (m && Date.now() - m.at < SDK_MEMO_MS && exists(path.join(cache, 'sdk', String(m.key), 'ok'))) return path.join(cache, 'sdk', m.key);
  }
  const specs = [];
  for (const d of deps) {
    if (!d.module_name?.startsWith('@minecraft/')) continue;
    const v = npmVersion(await npmDoc(d.module_name), String(d.version), bv);
    if (v) specs.push(`${d.module_name}@${v}`);
  }
  if (!specs.some((s) => s.startsWith('@minecraft/server@'))) specs.push(`@minecraft/server@${npmVersion(await npmDoc('@minecraft/server'), '2.0.0', bv)}`);
  for (const l of LIBS) {
    const doc = await npmDoc(l);
    const v = l === '@minecraft/vanilla-data' ? (doc.versions[bv] ? bv : Object.keys(doc.versions).filter((x) => x.startsWith(bv)).pop() ?? doc['dist-tags'].latest) : doc['dist-tags'].latest;
    specs.push(`${l}@${v}`);
  }
  specs.push(ENV_TYPES);
  specs.sort();
  const key = crypto.createHash('sha1').update(specs.join(' ')).digest('hex').slice(0, 10);
  const dir = path.join(cache, 'sdk', key);
  if (!exists(path.join(dir, 'ok'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    npmI(dir, specs);
    fs.writeFileSync(path.join(dir, 'ok'), specs.join('\n') + '\n');
  }
  try {   // (several lab processes at once: written whole, then renamed)
    const all = read(); all[want] = { key, at: Date.now() };
    const tmp = `${memo}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(all)); fs.renameSync(tmp, memo);
  } catch { /* only a memo */ }
  return dir;
}

export const entryOf = (addon) => ['main.ts', 'main.js', 'index.ts', 'index.js'].map((f) => path.join(addon, 'src', f)).find(exists);
const srcFiles = (dir, acc = []) => { if (exists(dir)) for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) srcFiles(p, acc); else if (/\.[cm]?[jt]s$/.test(e.name) && !e.name.endsWith('.d.ts')) acc.push(p); } return acc; };

// tsconfig the editor also uses: @minecraft/* resolve from the shared SDK (paths relative to this file: no baseUrl, which
// TypeScript 6 reports as an error in every editor and tsc run, and 7 drops)
export function writeTsconfig(addon, sdkDir, js) {
  const rel = (p) => path.relative(addon, p).split(path.sep).join('/');
  const nm = rel(path.join(sdkDir, 'node_modules'));
  const cfg = {
    compilerOptions: {
      target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', strict: !js, noLib: true, types: ['@bedrock-apis/env-types'], typeRoots: [nm],
      paths: { '@minecraft/*': [`${nm}/@minecraft/*`], '@bedrock-apis/*': [`${nm}/@bedrock-apis/*`] },
      noEmit: true, skipLibCheck: true, allowJs: true, checkJs: !!js, isolatedModules: true, resolveJsonModule: true, noFallthroughCasesInSwitch: true,
    },
    include: [js ? 'bp/scripts' : 'src'],
  };
  const f = path.join(addon, 'tsconfig.json');
  const s = JSON.stringify(cfg, null, 2) + '\n';
  if (!exists(f) || fs.readFileSync(f, 'utf8') !== s) fs.writeFileSync(f, s);
  return f;
}

// type check: TS errors are E (the build fails), JS (checkJs, not strict) are W
// A check that found nothing is not run again on the same sources (tsconfig, src/ or bp/scripts, the unit's package files):
// loading TypeScript alone is most of a build's second (a test then a pack; the lab's own runs of a unit that did not change)
function typeStamp(addon, js) {
  const h = crypto.createHash('sha1').update(js ? 'js\n' : 'ts\n');
  const add = (f) => { try { h.update(path.relative(addon, f) + '\0').update(fs.readFileSync(f)).update('\0'); } catch { h.update(f + '\0-\0'); } };
  for (const f of ['tsconfig.json', 'package.json', 'package-lock.json']) add(path.join(addon, f));
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.([cm]?[jt]s|json)$/.test(e.name)) add(p); } };
  walk(path.join(addon, js ? path.join('bp', 'scripts') : 'src'));
  return h.digest('hex');
}
export function typecheck({ tl, addon, cache, js, max = 12 }) {
  const okFile = path.join(cache, 'tsinfo', crypto.createHash('sha1').update(addon).digest('hex').slice(0, 10) + (js ? '.js' : '') + '.clean');
  const stamp = process.env.LAB_TYPES_MEMO === '0' ? null : typeStamp(addon, js);
  try { if (stamp && fs.readFileSync(okFile, 'utf8') === stamp) return []; } catch { /* not checked yet */ }
  const res = typecheckNow({ tl, addon, cache, js, max });
  try { if (stamp && !res.length) { fs.mkdirSync(path.dirname(okFile), { recursive: true }); fs.writeFileSync(okFile, stamp); } else fs.rmSync(okFile, { force: true }); } catch { /* only a memo */ }
  return res;
}
function typecheckNow({ tl, addon, cache, js, max = 12 }) {
  const ts = tl.ts;
  const cfgFile = path.join(addon, 'tsconfig.json');
  const cfg = ts.getParsedCommandLineOfConfigFile(cfgFile, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!cfg) return [];
  if (js) cfg.fileNames = cfg.fileNames.filter((f) => !/[\\/]__lab/.test(f));
  const info = path.join(cache, 'tsinfo', crypto.createHash('sha1').update(addon).digest('hex').slice(0, 10) + '.json');
  fs.mkdirSync(path.dirname(info), { recursive: true });
  const opts = { ...cfg.options, incremental: true, tsBuildInfoFile: info, noEmit: true };
  const host = ts.createIncrementalCompilerHost(opts);
  const prog = ts.createIncrementalProgram({ rootNames: cfg.fileNames, options: opts, host });
  const diags = [...prog.getConfigFileParsingDiagnostics(), ...prog.getSyntacticDiagnostics(), ...prog.getSemanticDiagnostics()];
  prog.emit();   // writes only the build info (noEmit)
  return compactDiags(diags.map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ').replace(/\s+/g, ' ');
    const at = d.file ? { file: path.relative(addon, d.file.fileName).split(path.sep).join('/'), line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 } : null;
    return { code: d.code, msg, at };
  }), max);
}
// TypeScript's own text is long: import("/abs/path/node_modules/@minecraft/server/index").Player, whole object types, the same
// message on many lines. Kept: what is wrong and where, once per message (lines joined), the first 12, each under 220 chars.
// the type errors an AI keeps making with the Script API, and the fix (one short tail on the message; the message stays)
export const TS_FIXES = [
  [/'string' is not assignable to parameter of type 'ItemStack'/, "new ItemStack('ns:id', n), or kit give(p, id, n)"],
  [/possibly 'undefined'|is possibly undefined/, "getComponent/getItem/find can give undefined: check it first (kit inv(p) for a player's inventory)"],
  [/has no exported member '(\w+)'/, 'not in this module version (renamed, or beta only): node lab.mjs api ?$1'],
  [/Property '(\w+)' does not exist on type '(\w+)'/, 'not in this API version: node lab.mjs api $2'],
  [/Cannot find name '(\w+)'/, "import it (from '@minecraft/server', '@minecraft/server-ui' or './kit')"],
];
const fixOf = (m) => { for (const [re, f] of TS_FIXES) { const x = re.exec(m); if (x) return f.replace(/\$(\d)/g, (_, k) => x[k] ?? ''); } return ''; };
export function compactDiags(list, max = 12) {
  const groups = new Map();
  for (const { code, msg, at } of list) {
    const m0 = msg.replace(/import\("[^"]*"\)\./g, '').replace(/\{ [^{}]{120,}? \}/g, '{ … }').replace(/'(.{90})[^']{30,}'/g, "'$1…'");
    const fx = fixOf(m0), m = fx ? `${m0} → ${fx}` : m0;
    const k = `${at?.file ?? ''}\u0000TS${code} ${m}`;
    const g = groups.get(k) ?? groups.set(k, { file: at?.file, lines: [], text: `TS${code} ${m0.length > 220 ? m0.slice(0, 220) + '…' : m0}${fx ? ` → ${fx}` : ''}` }).get(k);
    if (at && !g.lines.includes(at.line)) g.lines.push(at.line);
  }
  const out = [...groups.values()].map((g) => `${g.file ? `${g.file}:${g.lines.slice(0, 6).join(',')}${g.lines.length > 6 ? ',…' : ''} ` : ''}${g.text}`);
  return out.length > max ? [...out.slice(0, max), `… ${out.length - max} more type errors (often the same cause: fix the first ones, then build again)`] : out;
}

// features.json (optional, next to tests.txt): the parts of a unit that can be switched off when a new Minecraft breaks them.
//   { "features": { "<name>": { "ja": "...", "tests": ["<tests.txt ## title>", ...] } }, "off": { "<name>": "<why>" } }
// `off` is written by `node lab.mjs maintain` (or by hand). The code asks kit's feature('<name>'): the build puts the off list in
// as the constant LAB_FEATURES_OFF; a plain-JS unit (no src/) gets bp/scripts/lab_features.js to import instead.
export function features(addon) {
  try { const j = JSON.parse(fs.readFileSync(path.join(addon, 'features.json'), 'utf8')); return { features: j.features ?? {}, off: j.off ?? {} }; } catch { return null; }
}
export const featuresOff = (addon) => Object.keys(features(addon)?.off ?? {});
export function writeFeatureModule(addon, bp) {
  const f = features(addon), out = path.join(bp, 'scripts', 'lab_features.js');
  if (!f || entryOf(addon)) return;
  const body = `// generated by bds-lab from features.json (edit that, not this). import './lab_features.js' first in the entry script.\nexport const OFF = ${JSON.stringify(Object.keys(f.off))};\nglobalThis.LAB_FEATURES_OFF = OFF;\n`;
  if (!exists(out) || fs.readFileSync(out, 'utf8') !== body) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body); }
}

// the kit a unit was made with, kept current: a copy nobody edited (its hash is one the lab shipped, kit/versions.json) is
// replaced by the newest kit, so new helpers (menu, confirm...) and fixes reach old units and AGENTS.md's kit list holds for
// all of them. An edited copy is never touched. Returns the file it replaced (the caller keeps a checkpoint first).
export const kitHash = (t) => crypto.createHash('sha1').update(String(t).replace(/\r\n/g, '\n').replace(/^\/\/ generated[^\n]*\n/, '')).digest('hex').slice(0, 12);
export function kitStale(addon, bp, kitDir) {
  const ts = exists(path.join(addon, 'src')), f = ts ? path.join(addon, 'src', 'kit.ts') : path.join(bp, 'scripts', 'kit.js');
  let known; try { known = JSON.parse(fs.readFileSync(path.join(kitDir, 'versions.json'), 'utf8'))[ts ? 'ts' : 'js']; } catch { return null; }
  if (!exists(f) || !known?.length) return null;
  const h = kitHash(fs.readFileSync(f, 'utf8'));
  return known.includes(h) && h !== known.at(-1) ? { file: f, from: path.join(kitDir, ts ? 'kit.ts' : 'kit.js'), was: known.indexOf(h) + 1, of: known.length } : null;
}

// what keeps a unit on beta, from its build and tests on the stable modules: the beta-only API it uses, where (an update can
// change those first). One S line in go; maintain says the same when it cannot move a unit to stable.
export function betaWhy(lines) {
  const api = [];
  for (const l of lines) {
    const at = /^E (\S+?:\d+)/.exec(l)?.[1]?.replace(/,.*$/, ''), m = /Property '(\w+)' does not exist on type '(?:typeof )?(\w+)'|has no exported member '(\w+)'|Module '"@minecraft\/([\w-]+)"' has no/.exec(l);
    if (m) api.push(`${m[1] ? `${m[2]}.${m[1]}` : m[3] ?? '@minecraft/' + m[4]}${at ? ` (${at})` : ''}`);
  }
  const t = lines.find((l) => /^(✘|E )/.test(l));
  return api.length ? `uses beta-only ${[...new Set(api)].slice(0, 5).join(', ')}${api.length > 5 ? ` +${api.length - 5}` : ''}` : t ? `on the stable modules: ${t.slice(0, 160)}` : 'the stable modules did not pass';
}

// bundle src/ -> bp/<entry>. Returns the manifest entry it wrote (scripts/main.js) and keeps the map in .lab/maps
export async function bundle({ tl, addon, bp, sdkDir, mapDir, release = false }) {
  const entry = entryOf(addon);
  const mf = path.join(bp, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
  const mod = (m.modules ?? []).find((x) => x.type === 'script');
  const outRel = mod?.entry ?? 'scripts/main.js';
  const out = path.join(bp, outRel);
  const block = {
    name: 'minecraft-runtime',
    setup(b) {
      b.onResolve({ filter: /^node:|^(fs|path|os|child_process|http|https|net|crypto|stream|buffer|util|events|url|zlib|worker_threads|process)$/ }, (a) => ({
        errors: [{ text: `"${a.path}" is a Node.js module: Minecraft's script engine has no Node APIs (use @minecraft/server; for HTTP: @minecraft/server-net on BDS)` }] }));
    },
  };
  const r = await tl.esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', target: 'es2023', write: false, outfile: out,
    external: NATIVE, mainFields: ['module', 'main'], conditions: ['import', 'module'], sourcemap: release ? false : 'external', minify: false,
    nodePaths: [path.join(addon, 'node_modules'), path.join(sdkDir, 'node_modules')], logLevel: 'silent', plugins: [block], legalComments: 'none',
    banner: { js: '// generated by `node lab.mjs build` from src/ (edit src/, not this file)' }, define: { LAB_FEATURES_OFF: JSON.stringify(featuresOff(addon)) },
  }).catch((e) => e);
  const errs = (r.errors ?? []).map((e) => `${e.location ? path.relative(addon, path.resolve(e.location.file)).split(path.sep).join('/') + ':' + e.location.line + ' ' : ''}${e.text}`);
  if (errs.length) return { errs };
  const dir = path.dirname(out);
  // the script folder is build output: drop stale files from an earlier build, keep nothing else there
  if (exists(dir)) for (const f of fs.readdirSync(dir)) if (f !== path.basename(out) && /\.(m?js|map)$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of r.outputFiles) {
    if (f.path.endsWith('.map')) {
      const map = JSON.parse(f.text);
      fs.mkdirSync(mapDir, { recursive: true });
      fs.writeFileSync(path.join(mapDir, path.basename(addon) + '.json'), JSON.stringify({ out: outRel, addon, map }));
      // a plain .map with absolute sources for Mojang's minecraft-debugger (sourceMapRoot = .lab/debug/<addon>/)
      const dbg = path.join(path.dirname(mapDir), 'debug', path.basename(addon));
      fs.mkdirSync(dbg, { recursive: true });
      fs.writeFileSync(path.join(dbg, path.basename(out) + '.map'), JSON.stringify({ ...map, sources: map.sources.map((x) => path.resolve(path.dirname(out), x)) }));
    }
    else fs.writeFileSync(out, f.text.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'));
  }
  if (!mod) {
    m.modules = [...(m.modules ?? []), { type: 'script', language: 'javascript', uuid: crypto.randomUUID(), version: m.header?.version ?? [1, 0, 0], entry: outRel }];
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  }
  return { errs: [], out };
}

// ---------- source maps: BDS prints "(scripts/main.js:123)" or "(main.js:123)" -> "(src/foo.ts:45)" ----------
const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
function decodeLines(mappings) {
  const res = [];
  let src = 0, line = 0;
  for (const gl of mappings.split(';')) {
    let first = null;
    for (const seg of gl.split(',')) {
      if (!seg) continue;
      const v = [];
      let n = 0, sh = 0;
      for (const ch of seg) { const d = B64[ch]; n += (d & 31) << sh; if (d & 32) sh += 5; else { v.push(n & 1 ? -(n >>> 1) : n >>> 1); n = 0; sh = 0; } }
      if (v.length >= 4) { src += v[1]; line += v[2]; first ??= [src, line]; }
    }
    res.push(first);
  }
  return res;
}
export function remapper(mapFile) {
  const maps = [];
  if (exists(mapFile)) {
    try { const j = JSON.parse(fs.readFileSync(mapFile, 'utf8')); maps.push({ out: j.out, base: path.basename(j.out), lines: decodeLines(j.map.mappings), sources: j.map.sources.map((s) => path.relative(j.addon, path.resolve(j.addon, 'bp', path.dirname(j.out), s)).split(path.sep).join('/')) }); } catch { /* stale map */ }
  }
  if (!maps.length) return (s) => s;
  return (s) => s.replace(/([\w./-]+\.js):(\d+)/g, (all, file, ln) => {
    const m = maps.find((x) => file === x.out || file === x.base || file.endsWith('/' + x.base));
    const hit = m?.lines[Number(ln) - 1];
    return hit ? `${m.sources[hit[0]]}:${hit[1] + 1}` : all;
  });
}

// src location -> generated location for breakpoints: "src/util.ts:5" -> { path: 'main.js', line: 42 } (path relative to
// the scripts folder, as BDS names script files). Without a map (plain JS) the path is taken relative to bp/scripts.
export function locator(mapFile, addon) {
  let m = null;
  if (exists(mapFile)) try {
    const j = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const segs = [];   // every segment: [genLine, srcIdx, srcLine]
    let src = 0, line = 0;
    j.map.mappings.split(';').forEach((gl, g) => {
      for (const seg of gl.split(',')) {
        if (!seg) continue;
        const v = []; let n = 0, sh = 0;
        for (const ch of seg) { const d = B64[ch]; n += (d & 31) << sh; if (d & 32) sh += 5; else { v.push(n & 1 ? -(n >>> 1) : n >>> 1); n = 0; sh = 0; } }
        if (v.length >= 4) { src += v[1]; line += v[2]; segs.push([g + 1, src, line + 1]); }
      }
    });
    const sources = j.map.sources.map((s) => path.relative(j.addon, path.resolve(j.addon, 'bp', path.dirname(j.out), s)).split(path.sep).join('/'));
    m = { out: j.out.replace(/^scripts\//, ''), segs, sources };
  } catch { m = null; }
  return (loc) => {
    const r = /^(.+):(\d+)$/.exec(loc.trim());
    if (!r) return { err: `${loc}: use <file>:<line>, e.g. src/main.ts:12` };
    const file = r[1].replace(/\\/g, '/').replace(/^\.\//, ''), want = Number(r[2]);
    if (m && /\.[mc]?ts$|^src\//.test(file)) {
      const idx = m.sources.findIndex((s) => s === file || s.endsWith('/' + file) || file.endsWith(s));
      if (idx < 0) return { err: `${file} is not in the build (sources: ${m.sources.filter((s) => !s.includes('node_modules')).join(' ')})` };
      // first generated line of that source line; a line without code (comment, brace) moves to the next line that has some
      let best = null;
      for (const [g, s, l] of m.segs) if (s === idx && l >= want && (!best || l < best.l || (l === best.l && g < best.g))) best = { g, l };
      if (!best) return { err: `${file}:${want}: no code at or after this line` };
      // a source line can span several generated lines (esbuild spreads `() => { n++; }` over three): stop on all of them
      const lines = [...new Set(m.segs.filter(([, s2, l]) => s2 === idx && l === best.l).map(([g]) => g))].sort((a, b) => a - b);
      return { path: m.out, line: best.g, lines, src: `${m.sources[idx]}:${best.l}` };
    }
    const rel = file.replace(/^(addons\/[^/]+\/)?(bp\/)?(scripts\/)?/, '');
    return { path: rel, line: want, lines: [want], src: `bp/scripts/${rel}:${want}` };
  };
}

// every source line that has code -> its first generated line (for coverage); plain JS: every non-blank line of bp/scripts
export function codeLines(mapFile, bp) {
  const out = [];   // { path, line, src }
  if (exists(mapFile)) {
    const j = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const sources = j.map.sources.map((s) => path.relative(j.addon, path.resolve(j.addon, 'bp', path.dirname(j.out), s)).split(path.sep).join('/'));
    const first = new Map();
    let src = 0, line = 0;
    j.map.mappings.split(';').forEach((gl, g) => {
      for (const seg of gl.split(',')) {
        if (!seg) continue;
        const v = []; let n = 0, sh = 0;
        for (const ch of seg) { const d = B64[ch]; n += (d & 31) << sh; if (d & 32) sh += 5; else { v.push(n & 1 ? -(n >>> 1) : n >>> 1); n = 0; sh = 0; } }
        if (v.length >= 4) { src += v[1]; line += v[2]; const k = `${src}:${line}`; if (!first.has(k) && !sources[src].includes('node_modules')) first.set(k, g + 1); }
      }
    });
    for (const [k, g] of first) { const [s, l] = k.split(':').map(Number); out.push({ path: j.out.replace(/^scripts\//, ''), line: g, src: sources[s], srcLine: l + 1 }); }
    return out;
  }
  const dir = path.join(bp, 'scripts');
  for (const f of srcFiles(dir)) {
    if (/__lab/.test(f)) continue;
    const rel = path.relative(dir, f).split(path.sep).join('/');
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const t = l.trim(); if (t && !/^(\/\/|\*|\/\*|import |export \{|\}\)?;?$|\{$)/.test(t)) out.push({ path: rel, line: i + 1, src: 'bp/scripts/' + rel, srcLine: i + 1 }); });
  }
  return out;
}

// ---------- offline build (no network: a chat AI's sandbox) ----------
// TypeScript that is already on this machine (the lab's cache, global npm, NODE_PATH) transpiles src/ file by file into the
// script folder (Minecraft loads ES modules with relative imports, so no bundler is needed). @minecraft/* stay native imports;
// other packages need the real build. Types: @minecraft/* are unknown offline (any), so only your own code is type checked.
export function localTs(cache) {
  const tries = [path.join(cache, 'tool', 'package.json')];
  const g = spawnSync(WIN ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: WIN, timeout: 10000 });
  if (g.status === 0 && g.stdout.trim()) tries.push(path.join(g.stdout.trim(), 'noop.js'));
  for (const d of (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean)) tries.push(path.join(d, 'noop.js'));
  for (const t of tries) { try { return createRequire(t)('typescript'); } catch { /* next */ } }
  return null;
}
export function offlineBuild({ ts, addon, bp, realTypes = false }) {
  const src = path.join(addon, 'src'), entry = entryOf(addon);
  const m = JSON.parse(fs.readFileSync(path.join(bp, 'manifest.json'), 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
  const outRel = (m.modules ?? []).find((x) => x.type === 'script')?.entry ?? 'scripts/main.js';
  const outDir = path.join(bp, path.dirname(outRel));
  const list = srcFiles(src).filter((f) => /\.[cm]?[jt]s$/.test(f) && !/\.d\.ts$/.test(f));
  const errs = [], warns = [], rel = (f) => path.relative(addon, f).split(path.sep).join('/');
  const NATIVE_RE = new RegExp(`^(${NATIVE.map((n) => n.replace(/[/-]/g, '\\$&')).join('|')})$`);
  const outs = [];
  for (const f of list) {
    const code = fs.readFileSync(f, 'utf8');
    const r = ts.transpileModule(code, { fileName: f, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: false, verbatimModuleSyntax: false, isolatedModules: true } });
    for (const d of r.diagnostics ?? []) { const { line } = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0) : { line: 0 }; errs.push(`${rel(f)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`); }
    let js = r.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, '');
    // imports: relative ones get .js; @minecraft/* native stay; anything else needs npm (the real build)
    js = js.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g, (all, pre, q, spec) => {
      if (spec.startsWith('.')) return `${pre}${q}${spec.replace(/\.[cm]?ts$/, '.js').replace(/^(.*\/)?([^./][^/]*)$/, (x) => (/\.[cm]?js$/.test(x) ? x : x + '.js'))}${q}`;
      if (!NATIVE_RE.test(spec)) errs.push(`${rel(f)} imports "${spec}": offline only @minecraft/* native modules and your own files work (npm libraries need the network build)`);
      return all;
    });
    const isEntry = f === entry;
    const out = isEntry ? path.join(bp, outRel) : path.join(outDir, path.relative(src, f).replace(/\.[cm]?ts$/, '.js'));
    const off = isEntry && featuresOff(addon).length ? `globalThis.LAB_FEATURES_OFF = ${JSON.stringify(featuresOff(addon))};\n` : '';
    outs.push([out, '// generated offline from src/ by `node lab.mjs build` (edit src/, not this file)\n' + off + js]);
  }
  // own-code type check: @minecraft/* declared as any (skipped when carried real types check everything)
  if (!realTypes) try {
    const stub = path.join(addon, '.lab', 'offline-types.d.ts');
    fs.mkdirSync(path.dirname(stub), { recursive: true });
    fs.writeFileSync(stub, NATIVE.concat(LIBS).map((n) => `declare module '${n}';`).join('\n') + '\ndeclare var console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void; info(...a: any[]): void };\n');
    const opts = { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.NodeJs, lib: ['lib.es2023.d.ts'], types: [], strict: false, skipLibCheck: true, allowJs: true, allowImportingTsExtensions: true };
    const prog = ts.createProgram({ rootNames: [...list.filter((f) => /ts$/.test(f)), stub], options: opts });
    for (const d of prog.getSemanticDiagnostics()) { if (!d.file || d.file.fileName === stub) continue; const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0); warns.push(`${rel(d.file.fileName)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (offline check)`); }
  } catch { /* type check is advisory offline */ }
  if (errs.length) return { errs, warns };
  if (exists(outDir)) for (const f of srcFiles(outDir)) if (/\.(m?js|map)$/.test(f)) fs.rmSync(f, { force: true });
  for (const [f, t] of outs) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
  return { errs, warns, out: path.join(bp, outRel) };
}

// one-file bundle offline (LeviLamina's script engine loads a single script): each file transpiled to CommonJS and wrapped in a
// small module table; relative imports only (node:* kept for the nodejs engine)
export function offlineBundle({ ts, entries, rel }) {
  const mods = new Map(), errs = [];
  const resolve = (from, spec) => { const b = path.resolve(path.dirname(from), spec); for (const c of [b, b + '.ts', b + '.js', b.replace(/\.js$/, '.ts'), path.join(b, 'index.ts'), path.join(b, 'index.js')]) if (exists(c) && fs.statSync(c).isFile()) return c; return null; };
  const add = (f) => {
    if (mods.has(f)) return mods.get(f).id;
    const m = { id: mods.size, code: '', file: f, lines: [] }; mods.set(f, m);
    const r = ts.transpileModule(fs.readFileSync(f, 'utf8'), { fileName: f, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true, sourceMap: true } });
    try { m.lines = decodeLines(JSON.parse(r.sourceMapText).mappings); } catch { /* no map: its lines stay unmapped */ }
    for (const d of r.diagnostics ?? []) { const { line } = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0) : { line: 0 }; errs.push(`${rel(f)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`); }
    m.code = r.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, '').replace(/\brequire\((['"])([^'"]+)\1\)/g, (all, q, spec) => {
      if (spec.startsWith('.')) { const t = resolve(f, spec); if (!t) { errs.push(`${rel(f)}: cannot find "${spec}"`); return all; } return `__req(${add(t)})`; }
      if (/^node:/.test(spec)) return all;
      errs.push(`${rel(f)} imports "${spec}": offline only your own files work (npm packages need the network build)`); return all;
    });
    return m.id;
  };
  const ids = entries.map(add);
  // the bundle and a line-level source map (a script error's "name.js:383" → "src/main.ts:17", as with the network build)
  const head = ['// generated offline by bds-lab (no network): relative imports only', '(function () {', 'var __defs = {'], lines = [...head], at = head.map(() => null);
  [...mods.values()].forEach((m, k) => {
    lines.push(`${m.id}: function (module, exports, __req) {`); at.push(null);
    m.code.split('\n').forEach((l, n) => { lines.push(l); at.push(m.lines[n] ? [m.file, m.lines[n][1]] : null); });
    lines.push(k < mods.size - 1 ? '},' : '}'); at.push(null);
  });
  lines.push('};', 'var __cache = {};', 'function __req(i) { if (__cache[i]) return __cache[i].exports; var m = __cache[i] = { exports: {} }; __defs[i](m, m.exports, __req); return m.exports; }', ...ids.map((i) => `__req(${i});`), '})();', '');
  const sources = [...mods.keys()], C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = (n) => { let v = n < 0 ? (-n << 1) | 1 : n << 1, s = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += C[d]; } while (v); return s; };
  let ps = 0, pl = 0;
  const mappings = lines.map((_, n) => { const a = at[n]; if (!a) return ''; const si = sources.indexOf(a[0]), seg = vlq(0) + vlq(si - ps) + vlq(a[1] - pl) + vlq(0); ps = si; pl = a[1]; return seg; }).join(';');
  return { errs, code: lines.join('\n'), map: { version: 3, sources, names: [], mappings } };
}

// ---------- carry: the type definitions travel inside the work folder ----------
// verify (a machine with network) saves the addon's SDK types (*.d.ts + package.json, gzipped JSON) to <top>/carry/; a chat AI
// without network then type checks against the real @minecraft/* API and `api` works. Nothing executable travels.
export function carrySave(sdkDir, file, meta) {
  const nm = path.join(sdkDir, 'node_modules'), files = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.d\.[cm]?ts$|^package\.json$/.test(e.name)) files[path.relative(nm, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8'); } };
  for (const scope of ['@minecraft', '@bedrock-apis']) if (exists(path.join(nm, scope))) walk(path.join(nm, scope));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const z = zlib.gzipSync(JSON.stringify({ ...meta, files }), { level: 9 });
  fs.writeFileSync(file, z);
  return { count: Object.keys(files).length, bytes: z.length };
}
export function carryLoad(file, cache) {
  if (!exists(file)) return null;
  const buf = fs.readFileSync(file), key = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const dir = path.join(cache, 'carry-sdk', key);
  let meta;
  if (!exists(path.join(dir, 'ok'))) {
    const j = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    for (const [rel, text] of Object.entries(j.files ?? {})) { if (rel.includes('..')) continue; const f = path.join(dir, 'node_modules', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
    delete j.files; meta = j;
    fs.writeFileSync(path.join(dir, 'ok'), JSON.stringify(j));
  } else meta = JSON.parse(fs.readFileSync(path.join(dir, 'ok'), 'utf8'));
  return { dir, meta };
}
