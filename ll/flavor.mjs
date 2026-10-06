// ll lab: LeviLamina mods, verified on a real LeviLamina server (BDS for Windows, under Wine on Linux) with real players.
//   script mods  LegacyScriptEngine (QuickJS by default) in TypeScript: src/ is type-checked against @levimc-lse/types and bundled
//                into one file with the lab helper first, so `lse <code>` runs inside the mod's own context
//   native mods  C++ with xmake (the levilamina-mod-template layout); built on Windows, or a prebuilt bin/<Mod>/ is tested as is
//   server       LeviLamina + LegacyScriptEngine installed by lip into the cache (Windows: lip; Linux: lip.exe under Wine),
//                or LAB_LL_SERVER = an existing LeviLamina server folder/zip
//   reload       `ll unload <mod>` → copy the new build → `ll load <mod>`: players stay online
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const LL_VERSION = process.env.LAB_LL_VERSION || '26.51.5';    // LeviLamina for Minecraft 26.51.1 = BDS 1.26.51.1
const LSE_VERSION = process.env.LAB_LSE_VERSION || '0.22.1';   // LegacyScriptEngine for that LeviLamina
const HELPER = path.join(HERE, 'lib', 'lab_lse.js');
const exists = (f) => fs.existsSync(f);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const pascal = (n) => n.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
function walk(d, pred = () => true, acc = []) {
  if (!exists(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', '.xmake', 'build'].includes(e.name)) walk(p, pred, acc); } else if (pred(p)) acc.push(p); }
  return acc;
}

// ---------------------------------------------------------------- what a unit is
// script mod: manifest.json {name, entry, type: "lse-quickjs"|"lse-nodejs"|..., version} + src/main.ts
// native mod: xmake.lua (+ bin/<Mod>/ once built)
export function unitMeta(dir) {
  if (!dir) return null;
  if (exists(path.join(dir, 'xmake.lua'))) {
    const name = /target\(\s*["']([^"']+)["']/.exec(fs.readFileSync(path.join(dir, 'xmake.lua'), 'utf8'))?.[1];
    const bin = path.join(dir, 'bin', name ?? '');
    let version = '0.1.0';
    try { version = readJson(path.join(dir, 'manifest.json')).version ?? version; } catch { /* template */ }
    return { kind: 'native', name, version, bin, out: bin };
  }
  const mf = path.join(dir, 'manifest.json');
  if (!exists(mf)) return null;
  let m;
  try { m = readJson(mf); } catch { return { kind: 'bad', name: path.basename(dir), err: 'manifest.json is not valid JSON' }; }
  if (!m.type) return null;
  const engine = /^lse-(\w+)$/.exec(m.type)?.[1] ?? null;
  const entry = ['main.ts', 'main.js', 'index.ts', 'index.js'].map((f) => path.join(dir, 'src', f)).find(exists);
  return { kind: engine ? 'lse' : 'other', name: m.name, version: m.version ?? '0.1.0', type: m.type, engine, entry: m.entry, src: entry, manifest: m };
}
const outDir = (L) => path.join(L.CACHE, 'build', path.basename(L.ADDON));
// the bundle's source map → the lab's remapper: "name.js:812" in LSE errors → "src/main.ts:14" (network and offline builds alike)
function useMap(L, outfile, release) {
  if (release || !exists(outfile + '.map')) return;
  const mapFile = path.join(L.CACHE, 'maps', path.basename(L.ADDON) + '.lse.json');
  fs.mkdirSync(path.dirname(mapFile), { recursive: true });
  fs.writeFileSync(mapFile, JSON.stringify({ out: path.relative(path.join(L.ADDON, 'bp'), outfile).split(path.sep).join('/'), addon: L.ADDON, map: JSON.parse(fs.readFileSync(outfile + '.map', 'utf8')) }));
  L.setRemap(L.B.remapper(mapFile));
}

// ---------------------------------------------------------------- the server: LeviLamina + LSE through lip
const WINEPREFIX = (L) => path.join(L.CACHE, 'wine');
// Wine on the server side: the host's (Linux; macOS with LAB_RUNTIME=native and e.g. wine-crossover) or the lab container's (macOS)
// Wine 9 (Ubuntu 24.04, Debian 12's packages) runs BDS but nearly stops its ticks while a player is connected (measured: 2 ticks in
// 5 s, the server idle); Wine 10 runs it at 20 tps. An older system Wine is replaced by a portable Wine 10 in the cache (Kron4ek's
// builds: one tarball, no 32-bit libraries), fetched from GitHub (LAB_GITHUB_MIRROR works for it too). LAB_WINE=<wine> overrides.
// the newest vX.Y.Z tag of a GitHub repo through git (works where api.github.com is refused)
export function gitLatestTag(repo) {
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', repo], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) return null;
  const tags = [...r.stdout.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map((m) => m[1]);
  const key = (t) => t.slice(1).split('.').map(Number);
  return tags.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).at(-1) ?? null;
}
const PORTABLE_WINE = 'wine-10.15-staging-amd64-wow64', PORTABLE_URL = `https://github.com/Kron4ek/Wine-Builds/releases/download/10.15/${PORTABLE_WINE}.tar.xz`;
const portableWine = (L) => path.join(L.CACHE, 'wine-bin', PORTABLE_WINE, 'bin', 'wine');
const wineMajor = (L, w) => { const r = L.RT.run(w, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); return r.status === 0 ? Number(/wine-(\d+)/.exec(r.stdout ?? '')?.[1] ?? 0) : -1; };
let WINE;
function wineBin(L) {
  if (WINE !== undefined) return WINE;
  if (process.env.LAB_WINE && L.RT.has(process.env.LAB_WINE)) return (WINE = process.env.LAB_WINE);
  if (exists(portableWine(L))) return (WINE = portableWine(L));
  for (const w of ['wine', 'wine64']) if (L.RT.has(w)) return (WINE = w);
  return (WINE = null);
}
async function ensureGoodWine(L) {
  if (WIN || process.env.LAB_WINE || exists(portableWine(L)) || process.env.LAB_LL_LAUNCH) return;
  const sys = ['wine', 'wine64'].find((w) => L.RT.has(w));
  if (sys && wineMajor(L, sys) >= 10) return;
  if (process.arch !== 'x64' && L.RT.kind !== 'docker') return;   // (portable builds are x86-64)
  L.out(`setup: Wine ${sys ? wineMajor(L, sys) + ' is too old for BDS (it stalls with a player on)' : 'not found'}: fetching a portable Wine 10.15 into the cache (first time only)...`);
  try {
    const dir = path.join(L.CACHE, 'wine-bin'), tar = path.join(dir, 'wine.tar.xz');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tar, await L.get(viaMirror(PORTABLE_URL)));
    const r = spawnSync('tar', ['-xJf', tar, '-C', dir], { encoding: 'utf8' });
    fs.rmSync(tar, { force: true });
    if (r.status !== 0 || !exists(portableWine(L))) throw new Error((r.stderr || 'tar failed').trim().split('\n').at(-1));
    WINE = undefined;
  } catch (e) { L.out(`W portable Wine: ${e.message} (set LAB_WINE=<a Wine 10+>, or LAB_GITHUB_MIRROR); going on with ${sys ?? 'no Wine'}`); }
}
// a container user has no passwd entry and no $USER: Wine then builds no user profile, and Windows programs find no
// %LOCALAPPDATA% (lip: "the default install location cannot be obtained"). Name the user and its folders explicitly.
const wineEnv = (L) => ({ WINEPREFIX: WINEPREFIX(L), WINEDEBUG: process.env.LAB_WINEDEBUG || '-all', WINEARCH: 'win64', USER: 'lab', LOGNAME: 'lab', USERNAME: 'lab',
  USERPROFILE: 'C:\\users\\lab', APPDATA: 'C:\\users\\lab\\AppData\\Roaming', LOCALAPPDATA: 'C:\\users\\lab\\AppData\\Local' });
function needWine(L) {
  if (WIN) return null;
  const w = wineBin(L);
  if (!w) L.die(L.RT.kind === 'docker' ? `LeviLamina runs under Wine in the lab container, and it has no wine: rebuild the image (docker rmi ${L.RT.image}; node lab.mjs server)` : 'LeviLamina is a Windows server: on Linux it runs under Wine. Install it (Debian/Ubuntu: sudo apt update && sudo apt install -y wine winetricks cabextract; an older Wine than 10 is replaced by a portable one in the cache), or set LAB_LL_SERVER to a LeviLamina server folder/zip made on Windows.');
  // a fresh Wine prefix: create it and add the VC++ 2015-2022 runtime LeviLamina links against (once; the docker image of
  // LiteLDev/docker-levilamina-server does the same)
  const mark = path.join(WINEPREFIX(L), '.lab-prefix-v2');
  if (!exists(mark)) {
    fs.rmSync(WINEPREFIX(L), { recursive: true, force: true });   // a prefix made without a user profile (v33) is rebuilt
    fs.mkdirSync(WINEPREFIX(L), { recursive: true });
    L.out('setup: preparing the Wine prefix (wineboot + winetricks vcrun2022, first time only)...');
    L.RT.run(w, ['wineboot', '-i'], { env: wineEnv(L), timeout: 10 * 60000 });
    if (L.RT.has('winetricks')) L.RT.run('winetricks', ['-q', 'vcrun2022'], { env: { ...wineEnv(L), WINE: w, WINESERVER: path.join(path.dirname(w), 'wineserver') }, timeout: 30 * 60000 });   // (the same Wine, portable or not)
    else L.out('W winetricks not found: if LeviLamina fails with c0000135, install it and run WINEPREFIX=' + WINEPREFIX(L) + ' winetricks -q vcrun2022');
    fs.writeFileSync(mark, new Date().toISOString());
  }
  return w;
}
// LiteLDev's own Wine image installs LeviLamina (+ packages) into /data on its first start: the fallback when lip fails in the
// lab's container. Start it with the cache's server folder as /data, stop it once the server is up; the lab then runs that folder.
const OFFICIAL = process.env.LAB_LL_IMAGE || 'ghcr.io/liteldev/levilamina-server:latest-wine';
async function officialImage(L) {
  L.out(`setup: installing with ${OFFICIAL} (LiteLDev's image; first time a few minutes)...`);
  const name = `bdslab-ll-install-${process.pid}`;
  const child = spawn(L.RT.docker, ['run', '--rm', '-i', '--name', name, '--platform', 'linux/amd64', '-e', 'EULA=TRUE', '-e', `VERSION=${LL_VERSION}`, '-e', `PACKAGES=${ENGINE_PKG('quickjs')}`, '-v', `${L.BDS}:/data`, OFFICIAL], { stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '', up = false;
  const feed = (d) => { log += d; if (!up && /Server started|Done \(|IPv4 supported/.test(log)) { up = true; setTimeout(() => child.stdin.write('stop\n'), 3000); } };
  child.stdout.setEncoding('utf8').on('data', feed); child.stderr.setEncoding('utf8').on('data', feed);
  const code = await new Promise((res) => { child.on('exit', res); setTimeout(() => { spawnSync(L.RT.docker, ['rm', '-f', name], { stdio: 'ignore' }); res('timeout'); }, 45 * 60000); });
  if (up && code !== 0) spawnSync(L.RT.docker, ['rm', '-f', name], { stdio: 'ignore' });
  const inner = walk(L.BDS, (f) => /bedrock_server_mod\.exe$/i.test(f))[0];
  if (!inner) L.die(`${OFFICIAL} did not install LeviLamina (exit ${code}):\n${log.trim().split('\n').slice(-15).join('\n')}\n(alternative: LAB_LL_SERVER=<a LeviLamina server folder or zip made on Windows>)`);
  if (path.dirname(inner) !== L.BDS) { const tmp = L.BDS + '.tmp'; fs.renameSync(path.dirname(inner), tmp); fs.rmSync(L.BDS, { recursive: true, force: true }); fs.renameSync(tmp, L.BDS); }
  for (const d of ['worlds', 'logs']) fs.rmSync(path.join(L.BDS, d), { recursive: true, force: true });
}
// LAB_GITHUB_MIRROR=https://<mirror> : GitHub release downloads go through a mirror that takes the full URL after it
// (e.g. https://ghfast.top/https://github.com/...): for networks where github.com downloads are blocked. lip gets it too.
const GH_MIRROR = (process.env.LAB_GITHUB_MIRROR || '').replace(/\/$/, '');
const viaMirror = (u) => (GH_MIRROR && /^https:\/\/github\.com\//.test(u) ? `${GH_MIRROR}/${u}` : u);
// lip is a .NET 10 app: under Wine it needs the Windows .NET runtime, taken from Microsoft's own download (no winetricks)
async function ensureDotnet(L) {
  if (WIN) return;
  const dir = path.join(WINEPREFIX(L), 'drive_c', 'Program Files', 'dotnet');
  if (exists(path.join(dir, 'dotnet.exe'))) return;
  L.out('setup: .NET runtime for lip under Wine (Microsoft download, first time only)...');
  try {
    const meta = JSON.parse((await L.get('https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json')).toString());
    const url = meta.releases[0].runtime.files.find((f) => f.rid === 'win-x64' && /\/dotnet-runtime-[\d.]+-win-x64\.zip$/.test(f.url)).url;
    fs.mkdirSync(dir, { recursive: true });
    L.unzip(await L.get(url), dir);
  } catch (e) { L.out(`W .NET runtime: ${e.message} (lip falls back to winetricks dotnet10)`); }
}
async function lipExe(L) {
  const dir = path.join(L.CACHE, 'lip'), exe = path.join(dir, 'lip.exe');
  if (!WIN) { needWine(L); await ensureDotnet(L); }
  const cfg = (x) => { if (GH_MIRROR && !L.__lipCfg) { L.__lipCfg = true; L.__lip = x; lip(L, ['config', 'set', 'github_proxy', GH_MIRROR], dir, true); } return x; };
  if (exists(exe)) return cfg(exe);
  if (WIN) { const r = spawnSync('where', ['lip'], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim(); }
  L.out('setup: downloading lip (the LeviLamina package manager)...');
  let url = process.env.LAB_LIP_URL;
  if (!url) {
    const help = 'LeviLamina, lip and LSE come from GitHub releases. Fix one of: LAB_GITHUB_MIRROR=<a mirror such as https://ghfast.top>; GITHUB_TOKEN=<token>; LAB_LIP_URL=<lip win-x64 zip>; LAB_LL_SERVER=<a LeviLamina server folder/zip made on Windows>';
    try {
      const rel = JSON.parse((await L.get('https://api.github.com/repos/futrime/lip/releases/latest')).toString());
      url = viaMirror(rel.assets?.find((a) => /win-x64\.zip$/.test(a.name))?.browser_download_url ?? '');
    } catch (e) {
      // no API (rate limit, a network that lets only git and downloads through): git names the tags, the asset name is fixed
      const tag = !GH_MIRROR && gitLatestTag('https://github.com/futrime/lip');
      if (tag) url = `https://github.com/futrime/lip/releases/download/${tag}/lip-${tag.slice(1)}-win-x64.zip`;
      else if (!GH_MIRROR) L.die(`lip: ${e.message}\n${help}`);
    }
    if (!url && GH_MIRROR) {
      // no API: the mirror's redirect for releases/latest names the tag
      const r = await fetch(`${GH_MIRROR}/https://github.com/futrime/lip/releases/latest`, { redirect: 'manual' }).catch((x) => L.die(`lip via ${GH_MIRROR}: ${x.message}\n${help}`));
      const tag = /\/tag\/(v[\d.]+)/.exec(r.headers.get('location') ?? '')?.[1];
      if (!tag) L.die(`lip: ${GH_MIRROR} did not name the latest release (HTTP ${r.status})\n${help}`);
      url = `${GH_MIRROR}/https://github.com/futrime/lip/releases/download/${tag}/lip-${tag.slice(1)}-win-x64.zip`;
    }
    if (!url) L.die('lip: no win-x64 asset in the latest release (set LAB_LIP_URL)');
  }
  fs.mkdirSync(dir, { recursive: true });
  L.unzip(await L.get(url), dir);
  const found = walk(dir, (f) => /lip\.exe$/i.test(f))[0];
  if (!found) L.die('lip: lip.exe not in the downloaded zip');
  if (found !== exe) fs.copyFileSync(found, exe);
  return cfg(exe);
}
function lip(L, args, cwd, soft = false) {
  const exe = L.__lip;
  const w = needWine(L);
  const [cmd, a] = w ? [w, [exe, ...args]] : [exe, args];
  L.out(`setup: lip ${args.join(' ')}`);
  let r = L.RT.run(cmd, a, { cwd, env: w ? wineEnv(L) : {}, timeout: 30 * 60000 });
  if (r.status !== 0 && w && /dotnet|\.NET|mscoree|hostfxr/i.test((r.stdout || '') + (r.stderr || '')) && L.RT.has('winetricks')) {
    L.out('setup: lip needs .NET under Wine: winetricks -q dotnet10 (one time, slow)...');
    L.RT.run('winetricks', ['-q', 'dotnet10'], { env: wineEnv(L), timeout: 60 * 60000 });
    r = L.RT.run(cmd, a, { cwd, env: wineEnv(L), timeout: 30 * 60000 });
  }
  if (r.status !== 0 && soft) return `lip ${args.join(' ')} failed (exit ${r.status}): ${((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' | ')}`;
  if (r.status !== 0) L.die(`lip ${args.join(' ')} failed (exit ${r.status}):\n${((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-12).join('\n')}\n` +
    `(alternatives: install on Windows with lip and set LAB_LL_SERVER=<that folder or a zip of it>)`);
}
const ENGINE_PKG = (e) => `github.com/LiteLDev/LegacyScriptEngine#${e}@${LSE_VERSION}`;
const engineDir = (L, e) => path.join(L.BDS, 'plugins', `legacy-script-engine-${e}`);
function stampVersion(L) {
  const bds = /\b(1\.\d+\.\d+\.\d+)\b/.exec(exists(path.join(L.BDS, 'release-notes.txt')) ? fs.readFileSync(path.join(L.BDS, 'release-notes.txt'), 'utf8') : '')?.[1]
    ?? (() => { const m = /^(\d+)\.(\d+)/.exec(llVersion(L) ?? ''); return m ? `1.${m[1]}.${m[2]}.1` : '1.26.51.1'; })();
  const engines = fs.readdirSync(path.join(L.BDS, 'plugins')).filter((d) => d.startsWith('legacy-script-engine-')).map((d) => { try { return `${d} ${readJson(path.join(L.BDS, 'plugins', d, 'manifest.json')).version}`; } catch { return d; } });
  fs.writeFileSync(path.join(L.BDS, 'VERSION'), `${bds}\nlevilamina ${llVersion(L)}\n${engines.join('\n')}\n`);
}
function llVersion(L) { try { return readJson(path.join(L.BDS, 'plugins', 'LeviLamina', 'manifest.json')).version; } catch { return null; } }
async function installEngine(L, e) {
  if (exists(engineDir(L, e))) return;
  if (process.env.LAB_LL_SERVER) L.die(`this mod needs LegacyScriptEngine (${e}): install it into LAB_LL_SERVER (lip install ${ENGINE_PKG(e)})`);
  L.__lip = await lipExe(L);
  lip(L, ['install', ENGINE_PKG(e)], L.BDS);
  if (!exists(engineDir(L, e))) L.die(`lip finished but ${L.rel(engineDir(L, e))} is missing`);
  stampVersion(L);
}

// ---------------------------------------------------------------- building a script mod
function lseSdk(L) {
  const dir = path.join(L.CACHE, 'lse-sdk'), types = path.join(dir, 'node_modules', '@levimc-lse', 'types');
  if (exists(types)) return dir;
  const fail = path.join(dir, 'failed');
  if (exists(fail) && Date.now() - fs.statSync(fail).mtimeMs < 3600e3) return null;
  fs.mkdirSync(dir, { recursive: true });
  if (!exists(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', '@levimc-lse/types', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN });
  if (r.status !== 0 || !exists(types)) { fs.writeFileSync(fail, ''); return null; }
  return dir;
}
function writeTsconfig(L, sdk) {
  const nm = path.relative(L.ADDON, path.join(sdk, 'node_modules')).split(path.sep).join('/');
  const want = JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022'], strict: true, noEmit: true, skipLibCheck: true, allowJs: true, checkJs: false, typeRoots: [nm], types: ['@levimc-lse/types'] }, include: ['src'] }, null, 2) + '\n';
  const f = path.join(L.ADDON, 'tsconfig.json');
  if (!exists(f) || fs.readFileSync(f, 'utf8') !== want) fs.writeFileSync(f, want);
}
async function buildLse(L, m, { release = false, types = true } = {}) {
  const errs = [], warns = [], hints = [];
  if (!m.name || !/^[\w-]+$/.test(m.name)) errs.push('manifest.json: "name" (letters, digits, _ -) is the mod folder name');
  if (!m.entry || !/\.js$/.test(m.entry)) errs.push('manifest.json: "entry" must be the built file, e.g. "' + (m.name ?? 'mod') + '.js"');
  if (!m.src) errs.push('src/main.ts (or main.js) missing');
  if (m.engine && !(m.manifest.dependencies ?? []).some((d) => d.name === `legacy-script-engine-${m.engine}`)) warns.push(`manifest.json: add {"name": "legacy-script-engine-${m.engine}"} to dependencies (LeviLamina loads the engine first)`);
  if (errs.length) return { errs, warns, hints };
  let tl;
  let offTs = null;
  try { tl = L.tl(); } catch (e) {
    // no network: bundle with the TypeScript already on this machine (types unchecked); verify where the network is open
    offTs = L.B.localTs(L.CACHE);
    if (!offTs) { errs.push('build tools unavailable (npm): ' + String(e.message).split('\n')[0] + '; no TypeScript on this machine either: verify where the network is open (node lab.mjs verify)'); return { errs, warns, hints }; }
    warns.push('offline build (no network): LSE types unchecked; verify where the network is open (node lab.mjs verify)');
  }
  if (offTs) {
    const out = outDir(L), outfile = path.join(out, m.entry);
    const r = L.B.offlineBundle({ ts: offTs, entries: [...(release ? [] : [HELPER]), m.src], rel: (f) => L.rel(f) });
    if (r.errs.length) { errs.push(...r.errs); return { errs, warns, hints }; }
    fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(outfile, r.code);
    if (!release) fs.writeFileSync(outfile + '.map', JSON.stringify({ ...r.map, sources: r.map.sources.map((s) => path.relative(path.dirname(outfile), s).split(path.sep).join('/')) }));
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ ...m.manifest }, null, 2) + '\n');
    const assets = path.join(L.ADDON, 'assets');
    if (exists(assets)) fs.cpSync(assets, out, { recursive: true });
    useMap(L, outfile, release);
    return { errs, warns, hints };
  }
  if (types && m.src.endsWith('.ts') && process.env.LAB_TYPES !== '0') {
    const sdk = lseSdk(L);
    if (!sdk) warns.push('type check skipped: npm could not install @levimc-lse/types (offline?)');
    else { writeTsconfig(L, sdk); for (const l of L.B.typecheck({ tl, addon: L.ADDON, cache: L.CACHE, js: false })) errs.push(l); }
    if (errs.length) return { errs, warns, hints };
  }
  const out = outDir(L), outfile = path.join(out, m.entry);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const node = m.engine === 'nodejs';
  const imp = (f) => `import ${JSON.stringify(f.split(path.sep).join('/'))};`;
  try {
    const r = await tl.esbuild.build({
      stdin: { contents: (release ? '' : imp(HELPER) + '\n') + imp(m.src), resolveDir: L.ADDON, sourcefile: '__lab_entry.js', loader: 'js' },
      bundle: true, outfile, format: node ? 'cjs' : 'iife', platform: node ? 'node' : 'neutral', target: node ? 'node20' : 'es2022',
      mainFields: ['module', 'main'], sourcemap: release ? false : 'external', sourcesContent: false, logLevel: 'silent', charset: 'utf8',
      external: node ? ['node:*'] : [], legalComments: 'none',
      // lab builds: the main file's top-level names readable from `lse` lines (getters on globalThis.__labTop; release builds leave it out)
      plugins: release ? [] : [{ name: 'lab-top', setup(bld) { bld.onLoad({ filter: /\.[cm]?[jt]s$/ }, (a) => {
        if (path.resolve(a.path) !== path.resolve(L.ADDON, m.src)) return null;
        const src = fs.readFileSync(a.path, 'utf8'), decl = [...src.matchAll(/^(?:export\s+)?(const|let|var|function\*?|async\s+function|class)\s+([A-Za-z_$][\w$]*)/gm)], names = [...new Set(decl.map((x) => x[2]))], mutable = new Set(decl.filter((x) => x[1] === 'let' || x[1] === 'var').map((x) => x[2]));
        const tail = names.length ? `\n;(() => { const t = ((globalThis as any).__labTop ??= {}); ${names.map((n) => `try { Object.defineProperty(t, ${JSON.stringify(n)}, { get: () => ${n},${mutable.has(n) ? ` set: (v: any) => { ${n} = v; },` : ''} configurable: true }); } catch {}`).join(' ')} })();\n` : '';
        return { contents: src + tail, loader: /\.ts$/.test(a.path) ? 'ts' : 'js' };
      }); } }],
    });
    for (const w of r.warnings) warns.push(`${w.location ? `${L.rel(path.resolve(L.ADDON, w.location.file))}:${w.location.line} ` : ''}${w.text}`);
  } catch (e) {
    for (const x of e.errors ?? [{ text: e.message }]) errs.push(`${x.location ? `${L.rel(path.resolve(L.ADDON, x.location.file))}:${x.location.line} ` : ''}${x.text}${/Could not resolve "(node:)?(fs|path|os|child_process|http)"/.test(x.text) && !node ? ' (QuickJS mods have no Node APIs: use LSE File/network/data, or "type": "lse-nodejs")' : ''}`);
    return { errs, warns, hints };
  }
  const man = { ...m.manifest };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
  const assets = path.join(L.ADDON, 'assets');
  if (exists(assets)) fs.cpSync(assets, out, { recursive: true });
  useMap(L, outfile, release);
  if (!release) for (const [re, msg] of [[/\bwhile\s*\(\s*true\s*\)/, 'while(true) blocks the server thread: setInterval/setTimeout']])
    walk(path.dirname(m.src), (f) => /\.[jt]s$/.test(f)).forEach((f) => fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) warns.push(`${L.rel(f)}:${i + 1} ${msg}`); }));
  return { errs, warns, hints };
}
// native: xmake (Windows) or an already built bin/<Mod>/
function buildNative(L, m) {
  const errs = [], warns = [], hints = [];
  if (!m.name) { errs.push('xmake.lua: no target("<ModName>")'); return { errs, warns, hints }; }
  if (spawnSync('xmake', ['--version']).status === 0 && (WIN || process.env.LAB_XMAKE_CROSS)) {
    const env = { ...process.env, XMAKE_ROOT: 'y' };
    let r = spawnSync('xmake', ['f', '-y', '-m', 'release', '--target_type=server'], { cwd: L.ADDON, encoding: 'utf8', env, maxBuffer: 64e6 });
    if (r.status === 0) r = spawnSync('xmake', ['-y'], { cwd: L.ADDON, encoding: 'utf8', env, maxBuffer: 64e6 });
    if (r.status !== 0) {
      const text = (r.stdout || '') + (r.stderr || '');
      const es = [...text.matchAll(/^(.+?)\((\d+)(?:,\d+)?\):\s*(?:fatal )?error\s*(\w*):\s*(.*)$|^(.+?):(\d+):\d+:\s*error:\s*(.*)$/gm)].slice(0, 15)
        .map((x) => `${L.rel(path.resolve(L.ADDON, x[1] ?? x[5]))}:${x[2] ?? x[6]} ${x[3] ? x[3] + ' ' : ''}${x[4] ?? x[7]}`);
      errs.push(...(es.length ? es : ['xmake build failed:\n' + text.trim().split('\n').slice(-12).join('\n')]));
    }
  } else if (exists(path.join(m.bin, 'manifest.json'))) warns.push(`native mod not rebuilt (${WIN ? 'no xmake' : 'native mods build on Windows'}): testing the existing ${L.rel(m.bin)}`);
  else errs.push(`native mods build with xmake + MSVC on Windows (then bin/${m.name}/ is tested here, on Linux too). Script mods need neither: node lab.mjs new <name>`);
  if (!errs.length && !exists(path.join(m.bin, 'manifest.json'))) errs.push(`built, but ${L.rel(m.bin)}/manifest.json is missing`);
  return { errs, warns, hints };
}

// ---------------------------------------------------------------- talking to the helper (console `labjs <base64 json>`)
async function lse(L, eng, req, waitMs = 30000) {
  if (!eng.srv || eng.srv.exited) return false;
  if (!L.LOG.slice(eng.bootMark ?? 0).some((l) => l.includes('LAB_LSE_READY'))) { L.LOG.push('[0-0-0 0:0:0 ERROR] lse: the lab helper is not running (the mod script failed to load, or LegacyScriptEngine is missing: errors above)'); return true; }
  const b64 = Buffer.from(JSON.stringify(req)).toString('base64'), parts = b64.match(/.{1,4000}/g) ?? [''];
  const done = eng.srv.wait(/LAB_LSE_DONE/, waitMs);
  parts.forEach((p, i) => eng.srv.send(`${i < parts.length - 1 ? 'labjsp' : 'labjs'} ${p}`));
  if (!(await done)) L.LOG.push(`[0-0-0 0:0:0 ERROR] lse: no answer in ${waitMs / 1000}s`);
  await L.sleep(40);
  return true;
}
const hasBpScripts = (L) => walk(path.join(L.BP, 'scripts'), (f) => /\.[cm]?js$/.test(f)).length > 0;
const deployedName = (L) => { const m = unitMeta(L.ADDON); return m?.kind === 'native' ? m.name : m?.name; };
function copyMod(L, inst, wipe) {
  const m = unitMeta(L.ADDON), pdir = path.join(inst.dir, 'plugins');
  const mark = path.join(inst.dir, 'lab_deployed.json');
  if (exists(mark)) for (const d of JSON.parse(fs.readFileSync(mark, 'utf8'))) if (wipe || d === 'lab_lse') fs.rmSync(path.join(pdir, d), { recursive: true, force: true });
  // a fresh run: the databases other mods made last time go too (LegacyMoney's economy.db would carry balances over)
  if (wipe) for (const d of fs.readdirSync(pdir, { withFileTypes: true })) if (d.isDirectory()) for (const f of fs.readdirSync(path.join(pdir, d.name))) if (/\.(db|sqlite3?)(-wal|-shm|-journal)?$/i.test(f) && !exists(path.join(L.BDS, 'plugins', d.name, f))) fs.rmSync(path.join(pdir, d.name, f), { force: true });
  const placed = [];
  const src = m?.kind === 'native' ? m.bin : m?.kind === 'lse' ? outDir(L) : null;
  if (src && exists(src)) { fs.cpSync(src, path.join(pdir, m.name), { recursive: true, force: true }); placed.push(m.name); }
  if (m?.kind !== 'lse') {   // native mod / bp only: the helper runs alone
    const h = path.join(pdir, 'lab_lse');
    fs.mkdirSync(h, { recursive: true });
    fs.copyFileSync(HELPER, path.join(h, 'lab_lse.js'));
    fs.writeFileSync(path.join(h, 'manifest.json'), JSON.stringify({ name: 'lab_lse', entry: 'lab_lse.js', type: 'lse-quickjs', version: '0.0.0', dependencies: [{ name: 'legacy-script-engine-quickjs' }] }, null, 2));
    placed.push('lab_lse');
  }
  fs.writeFileSync(mark, JSON.stringify(placed));
  return m;
}

// ---------------------------------------------------------------- API lookup in @levimc-lse/types (.d.ts)
function lseApi(L, q) {
  const sdk = lseSdk(L) ?? L.die('api: npm could not install @levimc-lse/types (offline?)');
  const files = walk(path.join(sdk, 'node_modules', '@levimc-lse', 'types'), (f) => f.endsWith('.d.ts'));
  const idx = new Map();   // name -> [{head, members: [{name, sig, doc}]}]
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const re = /(?:\/\*\*([\s\S]*?)\*\/\s*)?(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|namespace|enum)\s+([\w$]+)[^{]*\{/g;
    let m;
    while ((m = re.exec(t))) {
      let depth = 1, i = re.lastIndex;
      while (i < t.length && depth) { if (t[i] === '{') depth++; else if (t[i] === '}') depth--; i++; }
      const body = t.slice(re.lastIndex, i - 1), members = [];
      // statements one by one (LSE's .d.ts has no semicolons): a /** doc */ belongs to the next statement; a signature
      // continues while its ( ) { } are open
      let doc = '', st = '', open = 0;
      const docOf = (d) => d.replace(/^\s*\*\s?/gm, '').split('\n').map((s) => s.trim()).find((s) => s && !s.startsWith('@')) ?? '';
      const isEnum = m[2] === 'enum';
      const take = (code) => {
        const ev = isEnum && /^\s*([\w$]+)\s*(=\s*[^,]+)?,?\s*$/.exec(code);
        if (ev) { members.push({ name: ev[1], sig: ev[1] + (ev[2] ? ' ' + ev[2].trim() : ''), doc }); doc = ''; return; }
        const x = /^\s*(?:static\s+|readonly\s+|function\s+|const\s+|let\s+|export\s+|declare\s+)*([\w$]+)\??\s*(\([\s\S]*\)\s*(?::\s*[\s\S]+)?|:\s*[\s\S]+)$/.exec(code.replace(/;\s*$/, ''));
        if (x && !/^(if|return|new)$/.test(x[1])) members.push({ name: x[1], sig: `${x[1]}${x[2].replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/,?\s\)/g, ')').trim()}`, doc });
        doc = '';
      };
      for (const seg of body.split(/(\/\*[\s\S]*?\*\/)/)) {
        if (seg.startsWith('/*')) { if (!open) doc = docOf(seg.slice(2, -2).replace(/^\*/, '')); continue; }
        for (const line of seg.split('\n')) {
          const l = line.replace(/\/\/.*$/, '');
          if (!l.trim() && !open) continue;
          st += (st ? ' ' : '') + l.trim();
          for (const ch of l) { if (ch === '(' || ch === '{' || ch === '[' || ch === '<') open++; else if (ch === ')' || ch === '}' || ch === ']' || (ch === '>' && !/=$/.test(st.slice(0, st.lastIndexOf('>'))))) open = Math.max(0, open - 1); }
          if (!open && st) { take(st); st = ''; }
        }
      }
      const ext = /\bextends\s+([\w$]+)/.exec(m[0])?.[1];
      const e = { head: `${m[2]} ${m[3]}${ext ? ' extends ' + ext : ''}  // ${path.basename(f)}`, doc: (m[1] ?? '').replace(/^\s*\*\s?/gm, '').trim().split('\n')[0] ?? '', members, ext };
      idx.set(m[3], [...(idx.get(m[3]) ?? []), e]);
      re.lastIndex = m.index + m[0].length;
    }
  }
  if (q.startsWith('?')) {
    const w = q.slice(1).toLowerCase(), hits = new Set();
    for (const [n, es] of idx) { if (n.toLowerCase().includes(w)) hits.add(n); for (const e of es) for (const mb of e.members) { if (mb.name.toLowerCase().includes(w)) hits.add(`${n}.${mb.name}`); const ev = /'(on\w+)'/.exec(mb.sig)?.[1]; if (ev && ev.toLowerCase().includes(w)) hits.add(ev); } }
    L.out(hits.size ? [...hits].slice(0, 60).join(' ') : 'none');
    return hits.size > 0;
  }
  // an event name (mc.listen('onDestroyBlock', ...)): the listen overload that takes it
  if (/^on[A-Z]\w*$/.test(q) && !idx.has(q)) {
    const hits = [...idx.values()].flat().flatMap((e) => e.members.filter((mb) => mb.sig.includes(`'${q}'`)).map((mb) => `  mc.${mb.sig}${mb.doc ? `  // ${mb.doc.slice(0, 100)}` : ''}`));
    if (hits.length) { L.out(hits.join('\n')); return true; }
  }
  const [name, member] = q.split('.');
  let es = idx.get(name);
  // members inherited from the base class (class File extends file {})
  if (es) for (let k = 0; k < 3; k++) { const b = es.find((e) => e.ext && idx.has(e.ext)); if (!b) break; const base = idx.get(b.ext); b.ext = null; es = [...es, ...base.map((x) => ({ ...x, head: `  // from ${x.head}` }))]; }
  if (!es) { L.out(`none: ${name}. similar: ${[...idx.keys()].filter((k) => k.toLowerCase().includes(name.toLowerCase())).slice(0, 15).join(' ') || '-'}`); return false; }
  const lines = [];
  for (const e of es) {
    const ms = member ? e.members.filter((mb) => mb.name === member) : e.members;
    if (member && !ms.length) continue;
    lines.push(e.head + (e.doc && !member ? `  — ${e.doc}` : ''), ...ms.slice(0, member ? 20 : 120).map((mb) => `  ${mb.sig}${mb.doc ? `  // ${mb.doc.slice(0, 100)}` : ''}`));
  }
  if (!lines.length) { L.out(`none: ${q}. members: ${[...new Set(es.flatMap((e) => e.members.map((mb) => mb.name)))].join(' ')}`); return false; }
  L.out(lines.join('\n'));
  return true;
}

// ---------------------------------------------------------------- new
function addPacks(L, dir, name, title, rp) {
  const eng = L.bdsVersion().split('.').slice(0, 3).map(Number);
  const m = { format_version: 2, header: { name: title, description: title, uuid: L.randomUUID(), version: [1, 0, 0], min_engine_version: eng }, modules: [{ type: 'data', uuid: L.randomUUID(), version: [1, 0, 0] }], dependencies: [] };
  if (rp) { const r = { format_version: 2, header: { name: title + ' RP', description: title, uuid: L.randomUUID(), version: [1, 0, 0], min_engine_version: eng }, modules: [{ type: 'resources', uuid: L.randomUUID(), version: [1, 0, 0] }] }; L.writeJson(path.join(dir, 'rp', 'manifest.json'), r); m.dependencies.push({ uuid: r.header.uuid, version: r.header.version }); L.packIcon(path.join(dir, 'rp', 'pack_icon.png'), name + 'rp'); }
  L.writeJson(path.join(dir, 'bp', 'manifest.json'), m);
  L.packIcon(path.join(dir, 'bp', 'pack_icon.png'), name);
}
function scaffold(L, args) {
  const desc0 = args.find((a) => a.startsWith('desc='))?.slice(5).trim() || null;   // desc="what server owners read in mod lists"
  const [name, title0, ...req] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--engine' && !a.startsWith('desc='));
  if (!/^[a-z][a-z0-9_]*$/.test(name ?? '')) L.die('usage: node lab.mjs new <name: a-z0-9_> ["Title"] ["<request>"] [desc="<what it does>"] [--native] [--js] [--engine quickjs|nodejs] [--bp] [--no-rp]');
  const title = title0 ?? name, dir = path.join(L.ADDONS, name), desc = desc0 ?? title;
  if (exists(dir)) L.die(`mods/${name} exists (node lab.mjs use ${name})`);
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  const Cls = pascal(name), esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (args.includes('--native')) {
    put('xmake.lua', `add_rules("mode.debug", "mode.release")\n\nadd_repositories("levimc-repo https://github.com/LiteLDev/xmake-repo.git")\n\nadd_requires("levilamina ${LL_VERSION.split('.').slice(0, 2).join('.')}.*", {configs = {target_type = get_config("target_type")}})\nadd_requires("levibuildscript")\n\nif not has_config("vs_runtime") then\n    set_runtimes("MD")\nend\n\noption("target_type")\n    set_default("server")\n    set_showmenu(true)\n    set_values("server", "client")\noption_end()\n\ntarget("${Cls}")\n    add_rules("@levibuildscript/linkrule")\n    add_rules("@levibuildscript/modpacker")\n    add_cxflags("/EHa", "/utf-8", "/W4", "/w44265", "/w44289", "/w44296", "/w45263", "/w44738", "/w45204")\n    add_defines("NOMINMAX", "UNICODE")\n    add_packages("levilamina")\n    set_exceptions("none")\n    set_kind("shared")\n    set_languages("c++20")\n    set_symbols("debug")\n    add_headerfiles("src/**.h")\n    add_files("src/**.cpp")\n    add_includedirs("src")\n`);
    put('manifest.json', JSON.stringify({ name: '${modName}', entry: '${modFile}', version: '0.1.0', type: 'native' }, null, 4) + '\n');
    put(`src/mod/${Cls}.h`, `#pragma once\n\n#include "ll/api/mod/NativeMod.h"\n\nnamespace ${name} {\n\nclass ${Cls} {\npublic:\n    static ${Cls}& getInstance();\n\n    ${Cls}() : mSelf(*ll::mod::NativeMod::current()) {}\n\n    [[nodiscard]] ll::mod::NativeMod& getSelf() const { return mSelf; }\n\n    bool load();\n    bool enable();\n    bool disable();\n\nprivate:\n    ll::mod::NativeMod& mSelf;\n};\n\n} // namespace ${name}\n`);
    put(`src/mod/${Cls}.cpp`, `#include "mod/${Cls}.h"\n\n#include "ll/api/command/CommandHandle.h"\n#include "ll/api/command/CommandRegistrar.h"\n#include "ll/api/mod/RegisterHelper.h"\n#include "mc/server/commands/CommandOrigin.h"\n#include "mc/server/commands/CommandOutput.h"\n#include "mc/server/commands/CommandPermissionLevel.h"\n\nnamespace ${name} {\n\n${Cls}& ${Cls}::getInstance() {\n    static ${Cls} instance;\n    return instance;\n}\n\nbool ${Cls}::load() {\n    getSelf().getLogger().debug("Loading...");\n    return true;\n}\n\nbool ${Cls}::enable() {\n    auto& cmd = ll::command::CommandRegistrar::getInstance(false)\n                    .getOrCreateCommand("${name}", "${title}", CommandPermissionLevel::Any);\n    cmd.overload().execute([](CommandOrigin const&, CommandOutput& output) { output.success("${title} works"); });\n    getSelf().getLogger().info("${name} enabled");\n    return true;\n}\n\nbool ${Cls}::disable() {\n    getSelf().getLogger().debug("Disabling...");\n    return true;\n}\n\n} // namespace ${name}\n\nLL_REGISTER_MOD(${name}::${Cls}, ${name}::${Cls}::getInstance());\n`);
    put('.gitignore', 'build/\n.xmake/\nbin/\n.vs/\n');
  } else {
    const engine = args[args.indexOf('--engine') + 1] && args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'quickjs';
    const js = args.includes('--js');
    put('manifest.json', JSON.stringify({ name, entry: `${name}.js`, type: `lse-${engine}`, version: '0.1.0', description: desc, dependencies: [{ name: `legacy-script-engine-${engine}` }] }, null, 4) + '\n');
    put(`src/main.${js ? 'js' : 'ts'}`, `// LegacyScriptEngine (${engine}) mod. Globals: mc ll logger File data network ... (node lab.mjs api mc.listen)\n// Bundled into ${name}.js by the lab; imports of other files in src/ and npm packages (lib add) work.\n\nconst cmd = mc.newCommand('${name}', '${title}', PermType.Any);\ncmd.overload([]);\ncmd.setCallback((_cmd, _origin, output) => {\n    output.success('${title} works');\n});\ncmd.setup();\n\nmc.listen('onJoin', (pl) => {\n    pl.tell(\`Welcome, \${pl.realName}\`);\n});\n\nlogger.info('${name} loaded');\n`);
    put('.gitignore', 'node_modules/\ntsconfig.json\n');
  }
  put('tests.txt', `# command, then expectations: = exact line | ~ regex | ! absent | !~ absent regex; '## title' = section\n## loads\nll list\n~ ${args.includes('--native') ? Cls : name}\n## the command answers a player\n@A join\n@A cmd ${name}\n~ ^@A .*${esc} works\n`);
  put('TASK.md', L.TASK_MD(title, req.join(' ')));
  if (args.includes('--bp')) addPacks(L, dir, name, title, !args.includes('--no-rp'));
  L.useAddon(name, true);
  L.out(`OK ll/mods/${name}/: ${args.includes('--native') ? `src/mod/${Cls}.cpp (native C++, xmake)` : `src/main.${args.includes('--js') ? 'js' : 'ts'} (LegacyScriptEngine: a template with /${name} and a join greeting: rewrite it whole)`}${args.includes('--bp') ? ' + bp' : ''}; now the current mod`);
}

// ---------------------------------------------------------------- the flavor
export default {
  name: 'll', title: 'LeviLamina lab', unitDir: 'mods', unitWord: 'mod', branchPrefix: 'mod',
  isUnit: (d) => exists(path.join(d, 'xmake.lua')) || exists(path.join(d, 'bp', 'manifest.json')) || (() => { try { return !!readJson(path.join(d, 'manifest.json')).type; } catch { return false; } })(),
  sapiBuild: false, matrix: false,
  cacheDirs: ['lip', 'build', 'lse-sdk'],
  noise: /LAB_LSE_(READY|DONE)|lab_lse|Unknown command: labjs/,
  showWarn: /mod|plugin|LeviLamina|legacy-script-engine|lse/i,
  pseudo: /^(lse|sapi|bots|lag|watch)\b/,
  // LeviLamina's CrashLogger writes a symbolized native stack (logs/crash/trace_*.log): its frames go under the crash line
  crashReport(L, inst) {
    const dir = path.join(inst.dir, 'logs', 'crash');
    if (!exists(dir)) return [];
    const f = fs.readdirSync(dir).filter((x) => /\.log$/i.test(x)).map((x) => path.join(dir, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!f) return [];
    const ls = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const frames = ls.filter((x) => /^(#?\d+[:\s]|at |0x[0-9a-f]+|\S+\.(dll|exe)!|\[\d+\])/i.test(x) || /![\w:~<>]+/.test(x));
    const mine = frames.filter((x) => new RegExp(deployedName(L) || '^$', 'i').test(x));
    return [`crash report ${path.basename(f)}${mine.length ? ` (${mine.length} frame(s) in ${deployedName(L)})` : ''}:`, ...(mine.length ? mine : frames.length ? frames : ls).slice(0, 12).map((x) => '  ' + x.slice(0, 200))];
  },
  // ("[CrashLogger] CrashLogger enabled successfully" is a normal start: only its reports count)
  crashRe: /^CrashReporter Key:|Raw Seh Exception|has crashed|\[CrashLogger\] (?!CrashLogger enabled).*(seh|exception|crash)/i,
  stopWaitMs: 25000,
  hints: [
    [/C\+\+ Exception: std::bad_function_call/, 'fix: an LSE native API failed inside (seen: HttpServer.listen under Wine with LSE 0.22.1; the port is bound, LSE throws after it). Serve HTTP from Endstone instead, or run the server on Windows'],
    [/c0000135|0xc0000135|vcruntime|msvcp140(?!>)|The specified module could not be found/i, 'fix: the Visual C++ runtime is missing: (Wine) WINEPREFIX=<cache>/wine winetricks -q vcrun2022; (Windows) install vc_redist.x64'],
    [/Raw Seh Exception|0xC0000005|Access violation/i, 'fix: a native crash inside the call named above: check that the object (player/entity) is still valid and the arguments'],
    [/bad optional_ref access|optional_ref/i, 'fix: an object that no longer exists (player left, entity removed): check .isValid() / look it up again'],
    [/Fail in (\w+)/, 'fix: an LSE call failed: node lab.mjs api <name> for its arguments'],
    [/is not defined|not a function/, 'fix: not an LSE global in this version: node lab.mjs api ?<word>'],
    [/Failed to load (mod|plugin)|failed to load/i, 'fix: see the lines above; manifest.json name/entry/type, or node lab.mjs check'],
  ],
  usage: 'usage: node lab.mjs new <n> [Title] [--native] [--js] [--engine quickjs|nodejs] [--bp] | use <n> | up [-k] | do <cmd..> | reload | down | run [cmd..] [-w ms] [-k] [-v] | test [file] | check | build | api <Name|Name.member|?word|sapi ..> | lse <code> (in run/do) | pack | lib add|remove <npm pkg> | server [--update] | help [topic] | (bds-lab tools: doc sample proto render png add ui mode ...)   (-a <mod> picks the mod)',

  // macOS (and LAB_RUNTIME=docker): LeviLamina is a Windows program; the lab image carries Wine (x86-64) and winetricks
  dockerfile: `RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends wine wine64 wine32:i386 \\
  winetricks cabextract xvfb xauth && rm -rf /var/lib/apt/lists/*\n`,
  selftest: `## the mod loads
ll list
~ labselftest
## lse
lse 6*7
= 42
## LSE events
events on onChat
@A chat ev-ll
~ EV onChat
events off
## simulated players
bots 3
~ BOTS 3 online
bots off
~ BOTS 0 online
## watch
lse $.v = 1
watch $.v
~ W \\$\\.v = 1
watch off
## lag
lag 30 10
wait 1000
~ lag done
`,
  serverExe: () => 'bedrock_server_mod.exe',
  alive: ['lse 6*7', '42'],   // qa: the mod's script runs again after /reload and restart
  slowServer: () => !WIN && !process.env.LAB_LL_LAUNCH,
  // Wine on a kernel without IPv6: BDS's NetherNet listener needs a real dual-stack socket (raknet players are fine)
  netherNetSkip: () => { if (WIN || process.env.LAB_LL_LAUNCH) return null; try { if (fs.readFileSync('/proc/net/if_inet6', 'utf8').trim()) return null; } catch { /* none */ } return 'LeviLamina under Wine on a kernel without IPv6 opens no NetherNet listener (RakNet players are unaffected; NetherNet works on Windows or with IPv6)'; },   // Wine: the engine waits for each player action to be handled
  needsSetup(L) {
    const m = unitMeta(L.ADDON);
    return !!(m?.engine && !exists(engineDir(L, m.engine))) || !exists(engineDir(L, 'quickjs'));
  },
  async ensureServer(L) {
    await ensureGoodWine(L);
    const exe = path.join(L.BDS, 'bedrock_server_mod.exe');
    if (!exists(exe) || !exists(path.join(L.BDS, 'VERSION'))) {
      const given = process.env.LAB_LL_SERVER;
      fs.rmSync(L.BDS, { recursive: true, force: true });
      fs.mkdirSync(L.BDS, { recursive: true });
      if (given) {
        L.out(`setup: LeviLamina server from ${given}`);
        if (fs.statSync(given).isDirectory()) fs.cpSync(given, L.BDS, { recursive: true });
        else L.unzip(fs.readFileSync(given), L.BDS);
        const inner = walk(L.BDS, (f) => /bedrock_server_mod\.exe$/i.test(f))[0];
        if (inner && path.dirname(inner) !== L.BDS) { const tmp = L.BDS + '.tmp'; fs.renameSync(path.dirname(inner), tmp); fs.rmSync(L.BDS, { recursive: true, force: true }); fs.renameSync(tmp, L.BDS); }
        for (const d of ['worlds', 'logs']) fs.rmSync(path.join(L.BDS, d), { recursive: true, force: true });
      } else {
        needWine(L);
        L.__lip = await lipExe(L);
        L.out(`setup: installing LeviLamina ${LL_VERSION} + BDS through lip (first time only, a few minutes)...`);
        const bad = lip(L, ['install', `github.com/LiteLDev/LeviLamina@${LL_VERSION}`], L.BDS, L.RT.kind === 'docker');
        if (bad) { L.out('W ' + bad); await officialImage(L); }
      }
      if (!exists(exe)) L.die(`no bedrock_server_mod.exe in ${L.rel(L.BDS)} after installing LeviLamina`);
      stampVersion(L);
      for (const d of ['run', 'world', 'types', 'beta.json']) fs.rmSync(path.join(L.CACHE, d), { recursive: true, force: true });
    }
    await installEngine(L, 'quickjs');   // the lab's helper runs on it
    const m = unitMeta(L.ADDON);
    if (m?.engine && m.engine !== 'quickjs') await installEngine(L, m.engine);
  },
  launch(L, inst) {
    if (process.env.LAB_LL_LAUNCH) { const [cmd, ...args] = process.env.LAB_LL_LAUNCH.split(' '); return { cmd, args: [...args, inst.dir], env: {} }; }   // tests: a fake server
    if (WIN) return { cmd: path.join(inst.dir, 'bedrock_server_mod.exe'), args: [], env: {} };
    process.env.LAB_CMD_WAIT_MS ??= '6000';   // under Wine a player's command is answered in seconds, not ticks
    process.env.LAB_SYNC_MS ??= '4000';
    return { cmd: needWine(L), args: [process.env.LAB_LL_EXE || 'bedrock_server_mod.exe'], env: wineEnv(L) };
  },
  loggerKind(name, L) {
    if (name === 'Server') return 'server';
    if (name === 'lab_lse') return 'script';
    return name === deployedName(L) ? 'script' : 'keep';
  },
  deploy(L, inst, eng) { copyMod(L, inst, !eng.keep && !eng.deployedOnce); eng.deployedOnce = true; },   // (a `restart` keeps the mod's data, like the world)
  async afterReady(L, eng) {
    const seen = () => L.LOG.slice(eng.bootMark ?? 0).some((l) => l.includes('LAB_LSE_READY'));
    for (let t = 0; t < 200 && !seen() && !eng.srv.exited; t++) await L.sleep(50);
    if (!seen()) L.LOG.push(`[0-0-0 0:0:0 ERROR] the mod's script did not start (LegacyScriptEngine error above, or the mod failed to load)`);
    return true;
  },
  async hotReload(L, eng) {
    const m = unitMeta(L.ADDON), n0 = L.LOG.length;
    const quiet = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms && !L.LOG.slice(n0).some((l) => re.test(l)) && !eng.srv.exited) await L.sleep(50); };
    eng.srv.send(`ll unload ${m.name}`);
    await quiet(/unload|disabl/i, 5000);
    copyMod(L, eng.inst, false);
    const n1 = L.LOG.length;
    eng.bootMark = n1;
    eng.srv.send(`ll load ${m.name}`);
    const want = m.kind === 'lse' ? /LAB_LSE_READY/ : /enabled|loaded/i;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !L.LOG.slice(n1).some((l) => want.test(l) || /ERROR\]/.test(l)) && !eng.srv.exited) await L.sleep(50);
    if (!L.LOG.slice(n1).some((l) => want.test(l))) { L.LOG.push('[0-0-0 0:0:0 BOT] ll load did not come back: restarting (world kept)'); await eng.restart(true); return; }
    if (hasBpScripts(L)) { eng.srv.send('reload'); await eng.srv.wait(/LAB_JS_READY/, 30000); }
    await L.sleep(200);
    L.LOG.splice(n0, 0, `[0-0-0 0:0:0 BOT] reloaded ${m.name} (ll unload/load; players stay)`);
  },
  async exec(L, eng, w, rest, c) {
    const on = rest[0] !== 'off', names = rest.slice(rest[0] === 'on' || rest[0] === 'off' ? 1 : 0).join(' ').split(/[\s,]+/).filter(Boolean);
    switch (w) {
      case 'lse': return lse(L, eng, { op: 'eval', code: c.slice(4).replace(/\\n/g, '\n') });
      case 'events': return lse(L, eng, { op: 'events', on, names });
      case 'states': return lse(L, eng, { op: 'states', on, keys: names });
      case 'perf': return lse(L, eng, { op: 'perf', ms: Number(rest[0]) || 3000 }, (Number(rest[0]) || 3000) + 10000);
      case 'bots': return lse(L, eng, rest[0] === 'off' ? { op: 'bots', off: true } : { op: 'bots', n: Number(rest[0]) || 1, walk: rest.includes('walk'), pos: rest.length >= 4 && rest.slice(1, 4).every((x) => /^-?\d+$/.test(x)) ? rest.slice(1, 4).map(Number) : null });
      case 'lag': return lse(L, eng, { op: 'lag', ms: Number(rest[0]) || 100, ticks: Number(rest[1]) || 40 });
      case 'watch': return lse(L, eng, rest[0] === 'off' ? { op: 'watch', off: true } : { op: 'watch', expr: c.slice(6) });
      case 'trace': case 'cov': case 'prof':
        if (hasBpScripts(L) && !/^src\//.test(rest[0] ?? '')) return undefined;   // bp/scripts: the Script API debugger
        L.LOG.push(`[0-0-0 0:0:0 BOT] ${w}: LegacyScriptEngine has no debugger. Use lse <expr> at the point of interest, logger.info in the mod, events on / states on; native mods: attach a debugger to bedrock_server_mod.exe (Windows)`);
        return true;
      default: return undefined;
    }
  },
  async preflight(L, opts) {
    const m = unitMeta(L.ADDON);
    if (!m) return { errs: [], warns: [], hints: [] };
    if (m.kind === 'bad') return { errs: [m.err], warns: [], hints: [] };
    if (m.kind === 'native') return buildNative(L, m);
    if (m.kind === 'lse') return buildLse(L, m, { types: opts.types !== false });
    return { errs: [`manifest.json type "${m.type}": the lab builds lse-* script mods and native (xmake) mods`], warns: [], hints: [] };
  },
  unitVersion: (L) => unitMeta(L.ADDON)?.version ?? '0.1.0',
  commands: {
    new: (L, a) => scaffold(L, a),
    async api(L, a) {
      if (!a.length) L.die('usage: node lab.mjs api <Name|Name.member|?word> ... (LegacyScriptEngine types)   |   api sapi <q> (the Script API, for bp/scripts)');
      if (a[0] === 'sapi') return L.sapi(a.slice(1));
      let ok = true;
      for (const q of a) ok = lseApi(L, q) && ok;
      return ok;
    },
    async pack(L, a) {
      if (!(await L.preflight())) return false;
      const m = unitMeta(L.ADDON), entries = [];
      let dir = null;
      if (m?.kind === 'lse') { const r = await buildLse(L, m, { release: true, types: false }); if (r.errs.length) { L.out(r.errs.map((e) => 'E ' + e).join('\n')); return false; } dir = outDir(L); }
      if (m?.kind === 'native') dir = m.bin;
      if (dir) for (const f of walk(dir)) entries.push({ name: `${m.name}/${path.relative(dir, f).split(path.sep).join('/')}`, data: fs.readFileSync(f) });
      let file = null;
      if (entries.length) {
        file = path.join(L.ROOT, 'dist', `${m.name}-${m.version}.zip`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, L.zip(entries));
        L.out(`OK ${L.rel(file)} (unzip into the server's plugins/ folder)`);
      }
      if (exists(path.join(L.BP, 'manifest.json'))) await L.pack(a);
      return file ?? exists(path.join(L.BP, 'manifest.json'));
    },
    async lib(L, a) {
      const [op, ...pk] = a;
      if (!['add', 'remove'].includes(op) || !pk.length) L.die('usage: node lab.mjs lib add|remove <npm package> ...   (bundled into the mod; QuickJS: no Node APIs)');
      const pj = path.join(L.ADDON, 'package.json');
      if (!exists(pj)) fs.writeFileSync(pj, JSON.stringify({ private: true, dependencies: {} }, null, 2) + '\n');
      const r = spawnSync(WIN ? 'npm.cmd' : 'npm', [op === 'add' ? 'i' : 'rm', ...pk, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: L.ADDON, encoding: 'utf8', shell: WIN });
      if (r.status !== 0) L.die(`npm failed:\n${r.stderr.trim().split('\n').slice(-6).join('\n')}`);
      L.out(`OK ${op === 'add' ? 'added' : 'removed'} ${pk.join(' ')} (package.json; bundled by build)`);
      return true;
    },
    async server(L, a) {
      if (a.includes('--update')) { fs.rmSync(L.BDS, { recursive: true, force: true }); fs.rmSync(path.join(L.CACHE, 'run'), { recursive: true, force: true }); }
      await L.setup();
      L.out(`OK ${fs.readFileSync(path.join(L.BDS, 'VERSION'), 'utf8').trim().split('\n').join(' | ')}${WIN ? '' : ` | Wine ${L.RT.run(wineBin(L) ?? 'wine', ['--version']).stdout?.trim() || '?'}`} | server side: ${L.RT.describe()}`);
      return true;
    },
    bds: (L, a) => L.F.commands.server(L, a),
  },
};
