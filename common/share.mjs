// node lab.mjs share: bds-lab itself as a release anyone can be given — the engine, docs, tests, workflows and the lab's own
// samples (common/data/samples.json: what `help ideas` and the app lab point at), and nothing that is yours:
//   out   your addons / plugins / mods, caches and servers (.lab, vendor BDS: Mojang's, not ours to hand out), results (runs,
//         dist), logins and secrets (.env, .env.local, tokens), patch/handoff leftovers, the autopilot's scratch
//   reset the autopilot's memory (an empty ledger, the default policy, a fresh backlog and lessons), the bench rows' local paths
//   checked a secret scan of every shipped file (API keys, tokens, webhooks, private keys, every value in your .env) — one hit
//         and nothing is written; then the zip is unpacked into a fresh folder and the lab's own checks run there (docs,
//         dev, kit, make, ci, auto, share): a release that does not work alone is not kept
// dist/bds-lab-v<version>.zip (+ .sha256): a person unzips it, or a lab already set up takes it with `node lab.mjs update <zip>`
// (which keeps that person's units, caches, secrets and autopilot memory).
//   --bump patch|minor|major|none (default patch; the first release is VERSION as it is, else 1.0.0)   --out <dir>
//   --release   a GitHub Release lab-v<version> with the zip (gh; LAB_CI_DRY=1 prints it)   --no-verify   --dry (list only)
// Notes: CHANGES.md gets the version's lines: commits since the last lab-v tag (git) and the autopilot's engine changes since
// the last share (auto/ledger.jsonl). LAB_SHARE_ROOT: another folder (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_POLICY } from './auto-guard.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOP = () => process.env.LAB_SHARE_ROOT || REPO;
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const today = () => new Date().toISOString().slice(0, 10);
// never shipped: caches, results, secrets, per-machine state, leftovers of patch / handoff / ci / the autopilot
// (extras.json: the extras zip's list of what was put back in this lab: this lab's own, never shipped)
export const SKIP = (r) => /(^|\/)(\.git|node_modules|\.lab|\.lab-node|\.lab-node\.tmp|\.lab-tools|runs|__pycache__|build|\.xmake|\.logs|\.pytest_cache)(\/|$)/.test(r)
  || (/(^|\/)dist(\/|$)/.test(r) && !/^common\/[^/]+\/dist(\/|$)/.test(r))   // (vendored code keeps its dist/: common/nethernet-connect/dist is what `lan` runs)
  || /^(carry|auto\/\.work|training)(\/|$)/.test(r) || r === 'extras.json' || /^auto\/(borrowed-seen\.jsonl|hosts\.json|host-ledger\.jsonl)$/.test(r) || r === 'host-result' || r.startsWith('host-result/') || /^ts\/(?!examples(\/|$))./.test(r) || /^bedrock-binary\/(profiles|reports|work|site)(\/|$)/.test(r) || /^bds\/addons\/[^/]+\/source\/(?!LICENSE|README)./.test(r)   // (a utility's upstream source: its bp/rp are what runs; license and readme kept)
  || /^(bds\/addons|end\/plugins|ll\/mods)\/[^/]+\/lab\.mjs$/.test(r) || /^sandbox-be\/(node_modules|vendor|bedrock-server|worlds|\.tools)(\/|$)/.test(r) || /^auto\/(\.lease\.json|\.lock|\.scheduled\.log|STOP)$/.test(r)
  || (/^bds\/vendor\/./.test(r) && r !== 'bds/vendor/bds-version.txt')
  || /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(r) || /(^|\/)(github\.token|\.DS_Store|Thumbs\.db)$/.test(r)
  || /^(\.lab-kind|\.lab-base\.json|\.lab-patch\.txt|\.lab-run\.(txt|json)|verify-result\.txt|\.lab-ci-comment\.md|\.lab-cache-for|bds-lab-cache\.tgz)$/.test(r)
  || /^bds\/docs\/(coverage|verbs)\/(last-run\.txt|\.spec-run\.txt|tsconfig\.json)$/.test(r) || /(^|\/)tsconfig\.json$/.test(r) && /^(bds\/addons|ll\/mods)\//.test(r)
  || /\.(tgz|mcaddon|mcpack|whl|apk|apks|xapk|pyc|update-\d+)$/i.test(r) || /\.update-\d+$/.test(r);
const EXEC = /(\.(sh|command)$|^tests\/fake\/app\/(adb|browser\.mjs)$)/;

export function samples(top = TOP()) {
  // the samples and the utility addons: both are part of bds-lab (the utility ones go into every live server too); and every
  // unit a verified skill rule names as its evidence (unit:bds/addons/x: the recipes bds-recipes points at): a release without
  // them would hand out skills that point at nothing
  const r = { bds: [], end: [], ll: [] };
  try { const j = JSON.parse(fs.readFileSync(path.join(top, 'common', 'data', 'samples.json'), 'utf8')), u = j.utility ?? {}; for (const k of Object.keys(r)) r[k].push(...(j[k] ?? []), ...(u[k] ?? [])); } catch { /* none */ }
  try { for (const x of JSON.parse(fs.readFileSync(path.join(top, 'skills', 'knowledge.json'), 'utf8')).rules ?? []) { const m = x.status === 'verified' && x.evidence?.kind === 'unit' && /^(bds|end|ll)\/(?:addons|plugins|mods)\/([^/]+)$/.exec(String(x.evidence.ref ?? '')); if (m && !r[m[1]].includes(m[2])) r[m[1]].push(m[2]); } } catch { /* none */ }
  return r;
}
// [rel, Buffer, mode][] of what ships, plus what was left out (counted) and the units dropped
export function collect(top = TOP()) {
  const S = samples(top), files = [], dropped = new Set(); let skipped = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = path.relative(top, p).split(path.sep).join('/');
      if (SKIP(r + (e.isDirectory() ? '/' : '')) || SKIP(r)) { skipped++; continue; }
      const u = /^(bds|end|ll)\/(addons|plugins|mods)\/([^/]+)/.exec(r);
      if (u && UNITS[u[1]] === u[2] && !e.name.startsWith('.') && !S[u[1]].includes(u[3])) { dropped.add(`${u[1]}/${u[3]}`); continue; }
      if (e.isSymbolicLink()) { skipped++; continue; }
      if (e.isDirectory()) walk(p); else if (e.isFile()) files.push([r, fs.readFileSync(p), fs.statSync(p).mode & 0o777]);
    }
  };
  walk(top);
  // a borrowed unit (someone else's addon: colony harvest / borrow) never ships, even named a sample by mistake: its mark, or
  // its name (borrowed_…) or the original kept in it (.borrowed/) — a unit still being judged has no full mark yet
  const unitOf = (r) => /^((bds|end|ll)\/(addons|plugins|mods)\/[^/]+)\//.exec(r)?.[1];
  const lent = [...new Set(files.filter(([r, b]) => (/^(bds|end|ll)\/(addons|plugins|mods)\/[^/]+\/imported\.json$/.test(r) && (() => { try { return Boolean(JSON.parse(b.toString('utf8')).borrowed); } catch { return false; } })())
    || /^(bds\/addons|end\/plugins|ll\/mods)\/(borrowed_[^/]*|[^/]+\/\.borrowed)\//.test(r)).map(([r]) => unitOf(r)))];
  if (lent.length) throw new Error(`借りたアドオンは配りません: ${lent.join(', ')}（samples.json から外す）`);
  return { files, dropped: [...dropped].sort(), skipped };
}
// what is yours inside files that ship: the autopilot's memory and the bench rows' local paths
export async function resetMemory(files) {
  const put = (rel, text) => { const i = files.findIndex((f) => f[0] === rel); const row = [rel, Buffer.from(text), 0o644]; if (i >= 0) files[i] = row; else files.push(row); };
  // only the knobs a person turns first; everything else follows common/auto-guard.mjs DEFAULT_POLICY (so new defaults reach them)
  put('auto/policy.json', '{\n "merge": "auto",\n "dailyTokens": 3000000,\n "taskTokens": 400000\n}\n');
  put('auto/ledger.jsonl', '');
  put('auto/LESSONS.md', '# Lessons (the autopilot writes these from its own failures; every make reads them)\n');
  put('auto/BACKLOG.md', '# Backlog (the AI writes this; a person may add `- [ ] <request>` lines too)\n# `- [ ] <addon request>` → make it (playtested) · `- [ ] lab: <change>` → the AI changes bds-lab itself (gated, reviewed)\n# [x] done · [~] given up after 4 failures · [-] dropped by the AI when it replanned\n');
  const rk = files.find((f) => f[0] === 'bds/bench/ranking.json');
  if (rk) { try { const rows = JSON.parse(rk[1].toString('utf8')); put('bds/bench/ranking.json', JSON.stringify(rows.map(({ logs, ...x }) => x), null, 1) + '\n'); } catch { put('bds/bench/ranking.json', '[]\n'); } }
}

// a small zip writer (deflate; unix modes kept so lab.sh and verify.command stay runnable)
export function zip(entries, prefix = 'bds-lab/') {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const parts = [], cen = []; let off = 0;
  for (const [rel, data, mode = 0o644] of entries) {
    const n = Buffer.from(prefix + rel), z = zlib.deflateRawSync(data, { level: 9 }), c = crc(data), h = Buffer.alloc(30);
    // 1980-01-01 00:00 for every file: the same tree gives the same zip, byte for byte (its sha256 means something)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(c, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const ce = Buffer.alloc(46); ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE((3 << 8) | 20, 4); ce.writeUInt16LE(20, 6); ce.writeUInt16LE(0x800, 8); ce.writeUInt16LE(8, 10); ce.writeUInt16LE(0x21, 14); ce.writeUInt32LE(c, 16); ce.writeUInt32LE(z.length, 20); ce.writeUInt32LE(data.length, 24); ce.writeUInt16LE(n.length, 28); ce.writeUInt32LE(((0o100000 | (EXEC.test(rel) ? 0o755 : mode & 0o755 || 0o644)) << 16) >>> 0, 38); ce.writeUInt32LE(off, 42);
    parts.push(h, n, z); cen.push(ce, n); off += 30 + n.length + z.length;
  }
  const cd = Buffer.concat(cen), end = Buffer.alloc(22), cnt = entries.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cnt, 8); end.writeUInt16LE(cnt, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const bump = (v, how) => { const [a, b, c] = v.split('.').map(Number); return how === 'major' ? `${a + 1}.0.0` : how === 'minor' ? `${a}.${b + 1}.0` : how === 'none' ? v : `${a}.${b}.${c + 1}`; };
const git = (top, args) => spawnSync('git', args, { cwd: top, encoding: 'utf8' });
function notes(top, prev) {
  const lines = [];
  if (git(top, ['rev-parse', '--is-inside-work-tree']).stdout?.trim() === 'true') {
    const tag = prev && git(top, ['rev-parse', '-q', '--verify', `refs/tags/lab-v${prev}`]).status === 0 ? `lab-v${prev}` : null;
    const log = git(top, ['log', '--no-merges', '--format=%s', ...(tag ? [`${tag}..HEAD`] : ['-n', '30']), '--', '.', ':!bds/addons', ':!end/plugins', ':!ll/mods', ':!auto/ledger.jsonl']);
    for (const s of (log.stdout ?? '').split('\n').filter(Boolean)) if (!/^auto\(\w+\): failed, ledger only|^auto\((invent|reflect)\)/.test(s)) lines.push(s);
  }
  try {
    const rows = fs.readFileSync(path.join(top, 'auto', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const since = rows.map((r) => r.kind).lastIndexOf('share');
    for (const r of rows.slice(since + 1)) if (r.kind === 'lab' && r.ok && !lines.some((l) => l.includes(r.title.slice(0, 40)))) lines.push(`${r.title.replace(/^the lab itself: /, '')}（自動操縦）`);
  } catch { /* no autopilot memory */ }
  return [...new Set(lines)].slice(0, 40);
}
function unpack(file, dir) {
  const { ZipReader } = globalThis.__zipReader;
  const z = new ZipReader(file);
  try {
    for (const e of z.entries) {
      if (e.name.endsWith('/')) continue;
      const rel = e.name.replace(/^bds-lab\//, ''), f = path.join(dir, rel);
      if (!path.resolve(f).startsWith(path.resolve(dir) + path.sep)) throw new Error(`bad path ${e.name}`);
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, z.read(e.name));
      if (EXEC.test(rel) && process.platform !== 'win32') fs.chmodSync(f, 0o755);
    }
  } finally { z.close(); }
}
// what this release ships (sha256, 12 hex digits) and what earlier ones shipped that it no longer does: `update` deletes those —
// an unedited copy only, never a unit, a cache or a secret (common/update.mjs). The list of gone files carries over from the
// previous release's common/data/shipped.json, each with the release that dropped it (an update from that one on skips it)
export const SHIPPED = 'common/data/shipped.json';
export const sha12 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
export function shipped(top, files, ver) {
  let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(top, SHIPPED), 'utf8')); } catch { /* the first release with one */ }
  const now = Object.fromEntries(files.filter(([r]) => r !== SHIPPED).map(([r, b]) => [r, sha12(b)]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const gone = {};
  for (const [r, g] of Object.entries(prev?.gone ?? {})) if (!(r in now)) gone[r] = { since: g.since, sha: [...g.sha] };
  for (const [r, h] of Object.entries(prev?.files ?? {})) if (!(r in now)) { const g = (gone[r] ??= { since: ver, sha: [] }); if (!g.sha.includes(h)) g.sha.push(h); }
  return { about: 'What this release of bds-lab ships (sha256, the first 12 hex digits) and what earlier releases shipped that it no longer does. node lab.mjs update deletes those, an unedited copy only and never a unit, a cache or a secret (common/update.mjs). Written by node lab.mjs share.', version: ver, files: now, gone: Object.fromEntries(Object.entries(gone).sort((a, b) => (a[0] < b[0] ? -1 : 1))) };
}
// the release, unpacked alone: the lab's own offline checks must pass in it (no units of yours, no caches, no network)
export const VERIFY = DEFAULT_POLICY.gate;   // the zip's own check = the autopilot's gate (one list, common/auto-guard.mjs)
function verify(file, out) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-share-'));
  try {
    unpack(file, dir);
    const bad = [];
    const S = samples(dir);
    for (const [k, d] of Object.entries(UNITS)) { let have = []; try { have = fs.readdirSync(path.join(dir, k, d)).filter((n) => !n.startsWith('.')); } catch { /* none */ } for (const n of have) if (!S[k].includes(n)) bad.push(`a unit that is not a sample: ${k}/${n}`); for (const n of S[k]) if (!have.includes(n)) bad.push(`a sample is missing: ${k}/${n}`); }
    // side by side like the gate (common/run-tests.mjs: the release's own, else this lab's)
    const list = VERIFY.filter((t) => fs.existsSync(path.join(dir, t)));
    const r = spawnSync(process.execPath, [[dir, REPO].map((d) => path.join(d, 'common', 'run-tests.mjs')).find((f) => fs.existsSync(f)), '--json', '--cwd', dir, '--timeout', '600000', ...list], { cwd: dir, encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_DOTENV: 'off', LAB_NETENV: 'off', FORCE_COLOR: '0', LAB_SHARE_IN_VERIFY: '1' } });
    let rows = null; try { rows = JSON.parse(r.stdout); } catch { /* the runner itself failed */ }
    const log = file + '.verify.log';
    // the text goes to a child through stdin (not argv: E2BIG), which blanks every line the secret scan hits (a line past 20000
    // characters is scanned in overlapping windows: findIn only looks at the first 20000); own = .env values + secret-named env values
    const scrub = (text) => {
      const sc = spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';
        import { findIn, ownSecrets } from ${JSON.stringify(pathToFileURL(path.join(REPO, 'common', 'secret-scan.mjs')).href)};
        const t = fs.readFileSync(0, 'utf8'), own = ownSecrets(process.argv[1]);
        for (const [k, v] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET|PASS|PASSWORD|EMAIL|AUTH|COOKIE/i.test(k) && String(v).length >= 6) own.push(String(v));
        const lines = t.split('\\n'), W = 20000, S = 15000, scan = [], from = [];
        lines.forEach((l, i) => { if (l.length <= W) { scan.push(l); from.push(i); } else for (let o = 0; o < l.length; o += S) { scan.push(l.slice(o, o + W)); from.push(i); } });
        const hit = new Set(findIn(scan.join('\\n'), own).filter((h) => !h.warn).map((h) => from[h.line - 1]));
        process.stdout.write(lines.map((l, i) => hit.has(i) ? '***' : l).join('\\n'));`, TOP()], { input: text, encoding: 'utf8', maxBuffer: 256e6 });
      return sc.status === 0 && sc.stdout ? sc.stdout : '*** (the output was not written: the secret scan did not run)\n';
    };
    if (!Array.isArray(rows)) {
      bad.push(`the test runner in the release: ${(r.stderr || r.stdout || '').trim().split('\n').at(-1) || 'exit ' + r.status}`); rows = [];
      fs.rmSync(log, { force: true });
      const tail = (t) => String(t ?? '').split('\n').slice(-300).join('\n');
      fs.writeFileSync(log, scrub(`=== the test runner: stderr ===\n${tail(r.stderr)}\n\n=== the test runner: stdout ===\n${tail(r.stdout)}\n`));
      out(`  the test runner's output: ${log}`);
    }
    for (const x of rows) {
      out(`  ${x.ok ? '✔' : '✘'} ${x.t}${x.ok ? '' : ': ' + (x.lines.filter((l) => /^(✘|FAIL )/.test(l)).slice(0, 2).join(' | ') || x.lines.at(-1))}`);
      if (!x.ok) bad.push(x.t);
    }
    // the failed tests' whole output next to the zip (<zip>.verify.log), so a failure can be looked into after the fact; all
    // passed: none (an earlier one is removed). Read through the secret scan first: a hit line becomes ***
    const failed = rows.filter((x) => !x.ok);
    if (failed.length) {
      fs.rmSync(log, { force: true });
      const text = failed.map((x) => `=== ${x.t} ===\n${(x.lines ?? []).join('\n')}\n`).join('\n');
      fs.writeFileSync(log, scrub(text));
      out(`  the failed tests' output: ${log}`);
    } else if (!bad.some((x) => x.startsWith('the test runner'))) fs.rmSync(log, { force: true });
    const st = spawnSync(process.execPath, ['lab.mjs', 'help'], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, LAB_DOTENV: 'off', LAB_NETENV: 'off' } });
    if (!/topics:/.test(st.stdout ?? '')) bad.push(`node lab.mjs help in the release: ${(st.stdout + st.stderr).trim().split('\n').at(-1)}`);
    return bad;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function shareCmd(args, out = console.log) {
  const top = TOP(), a = [...args], flag = (k, d) => { const i = a.indexOf(k); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
  const how = flag('--bump', 'patch'), outDir = path.resolve(flag('--out', path.join(top, 'dist')));
  if (!['patch', 'minor', 'major', 'none'].includes(how)) { out('usage: node lab.mjs share [--bump patch|minor|major|none] [--out <dir>] [--release] [--no-verify] [--dry]'); return false; }
  const unknown = a.filter((x) => !['--dry', '--release', '--no-verify'].includes(x));
  if (unknown.length) { out(`ERR share: unknown ${unknown.join(' ')}\nusage: node lab.mjs share [--bump patch|minor|major|none] [--out <dir>] [--release] [--no-verify] [--dry]`); return false; }
  const dry = a.includes('--dry'), release = a.includes('--release'), noVerify = a.includes('--no-verify');
  globalThis.__zipReader = await import(pathToFileURL(path.join(REPO, 'bedrock-binary', 'src', 'apk', 'zip.js')).href);
  const vf = path.join(top, 'VERSION'), prev = fs.existsSync(vf) ? fs.readFileSync(vf, 'utf8').trim() : null;
  const ver = prev ? bump(prev, how) : '1.0.0';
  const { files, dropped, skipped } = collect(top);
  await resetMemory(files);
  // the scan, before anything is written
  const { scan } = await import(pathToFileURL(path.join(REPO, 'common', 'secret-scan.mjs')).href);
  const hits = scan(files.map(([r, b]) => [r, b]), top), stop = hits.filter((h) => !h.warn);
  for (const h of hits.slice(0, 20)) out(`${h.warn ? 'W' : 'E'} ${h.rel}:${h.line}: ${h.what}`);
  if (stop.length) { out(`FAIL share: ${stop.length} secret(s) in files that would ship (above; the value is never printed). Remove them (a leaked key: make a new one where it was issued), then share again`); return false; }
  if (!files.some(([r]) => r === 'common/nethernet-connect/dist/src/index.js')) out('W common/nethernet-connect/dist is not here: `lan` will not run in this release (vendor it from the nethernet-connect project first: node scripts/vendor.mjs <this lab>)');
  out(`share v${ver}: ${files.length} files (the lab + ${Object.values(samples(top)).flat().length} samples); left out ${dropped.length} unit(s) of yours${dropped.length ? ` (${dropped.slice(0, 6).join(' ')}${dropped.length > 6 ? ' …' : ''})` : ''} and ${skipped} cache/secret/result entries`);
  if (dry) { for (const [r] of files.sort((x, y) => (x[0] < y[0] ? -1 : 1))) out('  ' + r); return true; }
  // VERSION and the notes travel in the zip; in the folder they change only once the release is good
  const n = notes(top, prev), cf = path.join(top, 'CHANGES.md');
  const cl = fs.existsSync(cf) ? fs.readFileSync(cf, 'utf8') : '# bds-lab の変更\n';
  const head = cl.split('\n')[0], rest = cl.split('\n').slice(1).join('\n').replace(/^\n+/, '');
  const changes = new RegExp(`^## v${ver.replace(/\./g, '\\.')} `, 'm').test(cl) ? cl : `${head}\n\n## v${ver} (${today()})\n${(n.length ? n : ['（変更の記録なし）']).map((l) => `- ${l}`).join('\n')}\n${rest ? '\n' + rest : ''}`;
  const put = (rel, text) => { const i = files.findIndex((f) => f[0] === rel); const row = [rel, Buffer.from(text), 0o644]; if (i >= 0) files[i] = row; else files.push(row); };
  put('VERSION', ver + '\n'); put('CHANGES.md', changes);
  const ship = shipped(top, files, ver);
  put(SHIPPED, JSON.stringify(ship, null, 0).replace(/,"/g, ',\n"') + '\n');
  files.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const buf = zip(files), name = `bds-lab-v${ver}.zip`, file = path.join(outDir, name), sum = crypto.createHash('sha256').update(buf).digest('hex');
  fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(file, buf);
  if (noVerify) fs.rmSync(file + '.verify.log', { force: true });   // (an earlier run's failures are not this zip's)
  if (!noVerify) {
    out('verify: the release unpacked alone, its own checks:');
    const bad = verify(file, out);
    if (bad.length) { fs.rmSync(file, { force: true }); out(`FAIL share: the release does not work alone (${bad.join('; ')}): not kept`); return false; }
  }
  fs.writeFileSync(file + '.sha256', `${sum}  ${name}\n`);
  fs.writeFileSync(vf, ver + '\n'); fs.writeFileSync(cf, changes); fs.mkdirSync(path.dirname(path.join(top, SHIPPED)), { recursive: true }); fs.writeFileSync(path.join(top, SHIPPED), files.find(([r]) => r === SHIPPED)[1]);
  try { fs.appendFileSync(path.join(top, 'auto', 'ledger.jsonl'), JSON.stringify({ id: `share:v${ver}`, at: new Date().toISOString(), kind: 'share', title: `bds-lab v${ver}`, ok: true, tokens: 0, sec: 0, via: 'none', note: `${files.length} files, sha256 ${sum.slice(0, 12)}` }) + '\n'); } catch { /* no autopilot here */ }
  out(`OK ${path.relative(top, file) || file} (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${sum.slice(0, 16)}…). Give it as is; a set-up lab takes it with: node lab.mjs update ${name}`);
  if (release) {
    const body = `bds-lab v${ver}\n\n${n.map((l) => `- ${l}`).join('\n') || '（変更の記録なし）'}\n\n使い方: 展開して \`node lab.mjs start\`。すでに使っている bds-lab は \`node lab.mjs update ${name}\`（自分のアドオン・キャッシュ・鍵・自動操縦の記録は残ります）。\nsha256: ${sum}`;
    const cmd = ['release', 'create', `lab-v${ver}`, file, file + '.sha256', '--title', `bds-lab v${ver}`, '--notes', body];
    if (process.env.LAB_CI_DRY) out(`DRY gh ${cmd.slice(0, 3).join(' ')} ${name}`);
    else {
      const r = spawnSync('gh', cmd, { cwd: top, encoding: 'utf8' });
      if (r.status !== 0) { out(`W share: the GitHub Release failed (${(r.stderr || r.stdout || '').trim().split('\n').at(-1) || 'gh not found'}); the zip is kept`); return true; }
      out(`OK GitHub Release lab-v${ver}`);
      git(top, ['tag', '-f', `lab-v${ver}`]);   // the next release's notes start here
      if (git(top, ['remote']).stdout?.trim()) git(top, ['push', '-q', '-f', 'origin', `refs/tags/lab-v${ver}`]);
    }
  }
  return true;
}
