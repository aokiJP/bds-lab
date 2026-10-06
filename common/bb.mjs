// node lab.mjs bb ...: bedrock-binary (bds-lab/bedrock-binary) on this lab's own BDS: what the server binary itself holds and
// no document says — packet ids (read from each packet class's getId() in the code: the MinecraftPacketIds enum's order is not
// the ids), enums (damage causes, actor types, disconnect reasons ...), commands Mojang's docs leave out,
// WSS events, script modules — read in ~5 s from the BDS the lab already has (no download; a Windows lab fetches the Linux build
// of the same version once), cached per version in <lab>/.lab/bb/. The hidden commands are then tried on a real BDS here
// (`bb commands`): which ones this server really has. After a Minecraft update `upkeep` says what changed (`bb diff --short`).
import './netenv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = process.env.LAB_BB_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BB = path.join(TOP, 'bedrock-binary'), CLI = path.join(BB, 'src', 'cli.js');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const kind = () => (process.env.LAB_KIND || read(path.join(TOP, '.lab-kind'))?.trim() || 'bds').replace(/[^a-z]/g, '') || 'bds';
const CACHE = () => path.join(TOP, kind(), '.lab', 'bb');
const BDS = () => path.join(TOP, kind(), '.lab', 'bds');
const cmpv = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const isElf = (f) => { try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.toString('latin1') === '\x7fELF'; } catch { return false; } };
export const profileFile = (ver, dir = CACHE()) => path.join(dir, `release-${ver}.json`);
const bbImport = (rel) => import(pathToFileURL(path.join(BB, 'src', rel)).href);

// ---------- the binary and its profile ----------
// the Linux bedrock_server of this version: the lab's own, else (a Windows lab: bedrock_server.exe is not ELF) fetched once
async function linuxBinary(ver, out) {
  const own = path.join(BDS(), 'bedrock_server');
  if (isElf(own)) return { bin: own, lang: path.join(BDS(), 'resource_packs', 'vanilla', 'texts', 'en_US.lang') };
  const dir = path.join(CACHE(), 'work', ver), bin = path.join(dir, 'bedrock_server');
  if (isElf(bin)) return { bin, lang: path.join(dir, 'en_US.lang') };
  out(`… this lab's BDS is not the Linux build: fetching the Linux BDS ${ver} once (only bedrock_server and en_US.lang are kept)`);
  let buf = null;
  for (const root of ['https://www.minecraft.net/bedrockdedicatedserver', 'https://minecraft.azureedge.net']) {
    try { const r = await fetch(`${root}/bin-linux/bedrock-server-${ver}.zip`, { headers: { Referer: 'https://www.minecraft.net/' } }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length > 10e6) { buf = b; break; } } } catch { /* next */ }   // (a small "OK" is a page, not the server)
  }
  if (!buf) throw new Error(`could not download the Linux BDS ${ver} (blocked network?): put its zip's bedrock_server at ${bin}`);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, 'bds.zip'); fs.writeFileSync(zipPath, buf);
  const { ZipReader } = await bbImport('apk/zip.js'), zip = new ZipReader(zipPath);
  try {
    const e = zip.entries.find((x) => /(^|\/)bedrock_server$/.test(x.name)), l = zip.entries.find((x) => /resource_packs\/vanilla\/texts\/en_US\.lang$/.test(x.name));
    if (!e) throw new Error('no bedrock_server in the Linux BDS zip');
    fs.writeFileSync(bin, zip.read(e), { mode: 0o755 }); if (l) fs.writeFileSync(path.join(dir, 'en_US.lang'), zip.read(l));
  } finally { zip.close(); fs.rmSync(zipPath, { force: true }); }
  return { bin, lang: path.join(dir, 'en_US.lang') };
}
export function bdsVersion() { return read(path.join(BDS(), 'VERSION'))?.trim() || null; }
// the profile of this lab's BDS (made the first time: ~5 s)
export async function ensureProfile(out = () => {}) {
  const ver = bdsVersion();
  if (!ver) throw new Error('no BDS in this lab yet: node lab.mjs setup');
  const f = profileFile(ver);
  // a profile from an older bedrock-binary has no packet ids (it numbered packets by the enum's order: wrong after 133): read again,
  // and if that cannot be done here, keep using it (everything but the packet ids is still right)
  let stale = false;
  if (fs.existsSync(f)) { try { if (load(f).packets) return { ver, file: f, made: false }; stale = true; } catch { /* unreadable: read again */ } }
  try {
    const { bin, lang } = await linuxBinary(ver, out);
    fs.mkdirSync(CACHE(), { recursive: true });
    const t0 = Date.now(), tmp = `${f}.new`;
    const r = spawnSync(process.execPath, [CLI, 'scan', bin, '--version', ver, '--channel', 'release', ...(fs.existsSync(lang) ? ['--lang', lang] : []), '--out', tmp], { cwd: BB, encoding: 'utf8', timeout: 900000, maxBuffer: 64e6 });
    if (bin.startsWith(path.join(CACHE(), 'work'))) { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); try { fs.rmdirSync(path.join(CACHE(), 'work')); } catch { /* another version's still there */ } }   // (a fetched Linux build: the profile is all that is needed)
    if (r.status !== 0 || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error(`bedrock-binary scan failed: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').slice(-3).join(' | ')}`); }
    fs.renameSync(tmp, f);
    return { ver, file: f, made: true, ms: Date.now() - t0 };
  } catch (e) {
    if (!stale) throw e;
    out(`W could not read the BDS ${ver} binary again (${e.message.split('\n')[0]}): using the profile read before, which has no packet ids`);
    return { ver, file: f, made: false, stale: true };
  }
}
// Mojang's protocol docs (as `proto` fetched them: <lab>/.lab/proto/<ver>/MinecraftPacketIds.json) carry ids for the packets they
// list: a second opinion on the ids read from the code, without any network. null when they are not here
export function docsCheck(p, protoRoot = path.join(TOP, kind(), '.lab', 'proto')) {
  if (!p.packets?.basis || !fs.existsSync(protoRoot)) return null;
  const dirs = fs.readdirSync(protoRoot).filter((d) => fs.existsSync(path.join(protoRoot, d, 'MinecraftPacketIds.json'))).sort(cmpv);
  const dir = dirs.find((d) => p.version === d || p.version?.startsWith(`${d}.`)) ?? dirs.at(-1);
  if (!dir) return null;
  let j; try { j = load(path.join(protoRoot, dir, 'MinecraftPacketIds.json')); } catch { return null; }
  const names = j.enum ?? [], vals = j['x-enum-binary-value'] ?? [];
  if (!names.length || names.length !== vals.length) return null;
  const norm = (x) => x.replace(/Packet$/, '').toLowerCase(), doc = new Map(names.map((n, i) => [norm(n), vals[i]]));
  let same = 0; const differ = [];
  for (const x of p.packets.list) {
    const v = doc.get(norm(x.name ?? x.class)) ?? doc.get(norm(x.class));
    if (v === undefined) continue;
    if (v === x.id) same++; else differ.push(`${x.class.replace(/Packet$/, '')} ${x.id}≠${v}`);
  }
  return { same, differ, from: `${j['x-minecraft-version'] ?? dir}` };
}
// the newest profile before `ver`: this lab's cache, then bedrock-binary's own history (profiles/)
export function previousProfile(ver) {
  const all = [CACHE(), path.join(BB, 'profiles')].flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).map((n) => /^release-([\d.]+)\.json$/.exec(n)).filter(Boolean).map((m) => ({ ver: m[1], file: path.join(d, m[0]) })) : []));
  return all.filter((x) => cmpv(x.ver, ver) < 0).sort((a, b) => cmpv(b.ver, a.ver))[0] ?? null;
}
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ---------- one line per kind of change (upkeep, bb diff --short) ----------
export async function shortDiff(fromFile, toFile) {
  const { diffProfiles } = await bbImport('report/diff.js');
  const a = load(fromFile), b = load(toFile), d = diffProfiles(a, b);
  // packets: by the ids each class's getId() returns (both profiles new enough); else by name only — never by the enum's order
  let newPk, gonePk, moved = 0, idsKnown = Boolean(d.packets);
  let renamedPk = [];
  if (d.packets) { newPk = d.packets.added.map((p) => p.class.replace(/Packet$/, '')); gonePk = d.packets.removed.map((p) => p.class.replace(/Packet$/, '')); moved = d.packets.renumbered.length; renamedPk = (d.packets.renamed ?? []).map((r) => `${r.from.replace(/Packet$/, '')}→${r.to.replace(/Packet$/, '')}`); }
  else { const pk = (p) => p.enums.find((e) => e.name === 'MinecraftPacketIds')?.values ?? []; const pa = pk(a), pb = pk(b); newPk = pb.filter((v) => !pa.includes(v)); gonePk = pa.filter((v) => !pb.includes(v)); }
  const ca = new Set(a.commands.map((c) => c.name)), cb = new Set(b.commands.map((c) => c.name));
  const newCmd = [...cb].filter((c) => !ca.has(c)), goneCmd = [...ca].filter((c) => !cb.has(c));
  // enums: only those whose type name is confirmed (cereal / symbols / dictionary) on both sides — a name guessed from the shape
  // of a registration function changes between builds (a preview loses most cereal names) and would be counted as gone + new
  const named = (p) => { const m = new Map(p.enums.map((e) => [e.name, e.source])); return (n) => Boolean(m.get(n)) && m.get(n) !== 'shape'; };
  const na = named(a), nb = named(b);
  const changed = d.enums.changed.filter((c) => c.name !== 'MinecraftPacketIds' && na(c.name) && nb(c.name));   // (packets: said above)
  const shifted = changed.filter((c) => c.renumbered.length && c.ordered).map((c) => c.short ?? c.name);
  const added = d.enums.added.filter((e) => nb(e.name)), removed = d.enums.removed.filter((e) => na(e.name));
  const parts = [
    newPk.length || gonePk.length || moved || renamedPk.length ? `packets ${newPk.length ? `+${newPk.length} (${newPk.slice(0, 4).join(' ')}${newPk.length > 4 ? ' …' : ''})` : ''}${gonePk.length ? ` -${gonePk.length} (${gonePk.slice(0, 3).join(' ')}${gonePk.length > 3 ? ' …' : ''})` : ''}${moved ? ` · ${moved} renumbered` : ''}${renamedPk.length ? ` · renamed ${renamedPk.slice(0, 3).join(' ')}${renamedPk.length > 3 ? ' …' : ''}` : ''}${idsKnown ? '' : ' (names only: an older profile has no ids)'}`.replace(/^packets\s+/, 'packets ') : '',
    newCmd.length || goneCmd.length ? `commands ${newCmd.length ? `+${newCmd.join(' ')}` : ''}${goneCmd.length ? ` -${goneCmd.join(' ')}` : ''}`.trim() : '',
    shifted.length ? `ids shifted in ${shifted.slice(0, 4).join(', ')}${shifted.length > 4 ? ' …' : ''}` : '',
    added.length || removed.length ? `enums +${added.length} -${removed.length}` : '',
    changed.length - shifted.length > 0 ? `${changed.length - shifted.length} enum(s) with new values` : '',
  ].filter(Boolean);
  return `binary ${a.version} → ${b.version}: ${parts.join(' · ') || 'no change'}`;
}

// ---------- the hidden commands, tried on a real BDS here ----------
const COMMANDS = (ver) => path.join(CACHE(), `release-${ver}.commands.json`);
export function classify(lines, names) {   // `run` output → name: works | args | absent
  const res = {};
  let cur = null;
  for (const l of lines) {
    const m = /^> (\S+)\s*$/.exec(l);
    if (m && names.includes(m[1])) { cur = m[1]; res[cur] ??= 'works'; continue; }
    if (!cur) continue;
    if (/^E Unknown command: /.test(l)) res[cur] = 'absent';
    else if (/^E Syntax error: Unexpected "": at /.test(l)) res[cur] = 'args';
  }
  for (const n of names) res[n] ??= 'works';   // (printed nothing: it ran)
  return res;
}
async function measure(ver, names, out) {
  const f = COMMANDS(ver);
  try { const j = JSON.parse(read(f)); if (names.every((n) => j[n])) return j; } catch { /* first time */ }
  out(`… trying the ${names.length} hidden commands on a fresh BDS ${ver} (once, ~20 s): which ones this server has`);
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), kind(), 'run', ...names], { cwd: TOP, encoding: 'utf8', timeout: 600000, maxBuffer: 64e6, env: { ...process.env, FORCE_COLOR: '0', LAB_NOTRACE: '1' } });
  const lines = `${r.stdout ?? ''}`.split('\n');
  if (!lines.some((l) => l.startsWith('> '))) { out(`W could not run a BDS here to try them: ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-2).join(' | ')}`); return null; }
  const res = classify(lines, names);
  fs.mkdirSync(CACHE(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(res));
  return res;
}
const langMap = () => { const m = new Map(); for (const l of (read(path.join(BDS(), 'resource_packs', 'vanilla', 'texts', 'en_US.lang')) ?? '').split('\n')) { const i = l.indexOf('='); if (i > 0) m.set(l.slice(0, i).trim(), l.slice(i + 1).replace(/\s*#.*$/, '').trim()); } return m; };
// for `doc /<command>`: what the binary and the try said about a command Mojang's docs do not have (cached only, no scan)
export function hiddenCommand(name, cacheDir = CACHE(), bdsDir = BDS()) {
  const ver = read(path.join(bdsDir, 'VERSION'))?.trim(); if (!ver) return null;
  let p; try { p = load(path.join(cacheDir, `release-${ver}.json`)); } catch { return null; }
  const c = p.commands.find((x) => x.name === name); if (!c) return null;
  let st = null; try { st = JSON.parse(read(path.join(cacheDir, `release-${ver}.commands.json`)))?.[name] ?? null; } catch { /* not tried */ }
  const lang = read(path.join(bdsDir, 'resource_packs', 'vanilla', 'texts', 'en_US.lang')) ?? '';
  const text = c.descriptionKey ? new RegExp(`^${c.descriptionKey.replace(/[.]/g, '\\.')}=(.*)$`, 'm').exec(lang)?.[1]?.replace(/\s*#.*$/, '').trim() : null;
  return { name, inDocs: c.inOfficialMetadata, key: c.descriptionKey, text, status: st, ver, says: st ? STATUS[st] : 'not tried here yet: node lab.mjs bb commands' };
}
export const STATUS = { works: 'this BDS has it (runs with no arguments)', args: 'this BDS has it (it needs arguments)', absent: 'not registered on this BDS (Education, the client or a later build)' };

const USAGE = `node lab.mjs bb [...]   bedrock-binary on this lab's BDS (help bb)
  bb                      summary: packets, enums, commands, WSS events, script modules; what changed since the last version
  bb packets [name|id]    packet ids of this BDS (from getId())   bb enum [name]   an enum's values with their ids (no name: the list)
  bb commands             commands the docs leave out, tried on this BDS (has it / needs arguments / not here)
  bb strings <word> [--dead]   identifiers in the binary     bb diff [--short] [<from.json> <to.json>]   two versions
  bb site                 the searchable page + metadata JSON      bb apk   the Android client (app/.lab/apk, from: app apk fetch)
  bb <its own command>    bedrock-binary's other commands (doctor, scan, report, names, sources, track ...: bb list)`;

export async function bbCmd(args, out = console.log) {
  if (!fs.existsSync(CLI)) { out('E bedrock-binary/ is not here (put the bedrock-binary folder at bds-lab/bedrock-binary)'); return false; }
  const a = [...args], flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const quiet = flag('--quiet'), short = flag('--short');
  const sub = a[0], rest = a.slice(1);
  if ((sub === 'help' || sub === '--help') && !rest.length) { out(USAGE); return true; }
  if (sub === 'list') return (() => { const r = spawnSync(process.execPath, [CLI, 'help'], { cwd: BB, encoding: 'utf8' }); out(`${r.stdout ?? ''}`.trimEnd()); return true; })();
  // bedrock-binary runs in its own folder: a path the person gave (relative to where they are) is made absolute first
  const abs = (x) => (typeof x === 'string' && !x.startsWith('-') && fs.existsSync(x) ? path.resolve(x) : x);
  const pass = (argv) => { const r = spawnSync(process.execPath, [CLI, ...argv.map(abs)], { cwd: BB, encoding: 'utf8', timeout: 900000, maxBuffer: 256e6 }); const t = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(); if (t) out(t); return r.status === 0; };
  if (sub && !['packets', 'enum', 'commands', 'strings', 'diff', 'site'].includes(sub) && sub !== 'apk') return pass(a);   // bedrock-binary's own commands
  if (sub === 'apk') {
    const dir = path.resolve(rest[0] ?? path.join(TOP, 'app', '.lab', 'apk'));
    if (!fs.existsSync(dir)) { out(`E no APK at ${path.relative(TOP, dir)}: node lab.mjs app apk fetch (or bb apk <folder of the APK files>)`); return false; }
    return pass(['apk', dir, '--scan', ...rest.slice(1), '--profiles', CACHE()]);
  }
  let pr;
  try { pr = await ensureProfile(out); } catch (e) { out(`E ${e.message}`); return false; }
  const p = load(pr.file);
  if (quiet && !sub) { out(`OK bb ${pr.ver}${pr.made ? ` (made in ${Math.round(pr.ms / 100) / 10} s)` : ''}`); return true; }
  if (sub === 'enum') return pass(['enum', pr.file, ...rest]);
  if (sub === 'strings') return pass(['strings', pr.file, ...rest]);
  if (sub === 'site') { const dir = path.join(CACHE(), 'site'); const ok = pass(['docs', pr.file, '--out', dir]); if (ok) out(`OK open ${path.join(dir, 'index.html')}`); return ok; }
  if (sub === 'packets') {
    const pk = p.packets;
    if (!pk?.basis) { out(`E no packet ids: ${pk?.reason ?? 'the profile was read by an older bedrock-binary and this BDS binary is not here to read again'} (bedrock-binary/src/analysis/packets.js)`); return false; }
    const q = rest[0]?.toLowerCase(), num = q && /^(\d+|0x[\da-f]+)$/.test(q) ? Number(q) : null, word = q?.replace(/packet$/, '');
    const label = (x) => `${x.id} (0x${x.id.toString(16)}) ${x.class.replace(/Packet$/, '')}${x.name && x.name.replace(/Packet$/, '') !== x.class.replace(/Packet$/, '') ? ` [enum ${x.name}]` : ''}`;
    const hit = pk.list.filter((x) => !q || (num !== null ? x.id === num : x.class.toLowerCase().includes(word) || x.name?.toLowerCase().includes(word)));
    const gone = (pk.noClass ?? []).filter((x) => q && (num !== null ? x.id === num : x.name.toLowerCase().includes(word)));
    if (hit.length) out(hit.map(label).join(' · '));
    for (const x of gone) out(`${x.id !== null ? `${x.id} (0x${x.id.toString(16)}) ` : ''}${x.name}: in MinecraftPacketIds, but no packet class in this BDS (removed, reserved or another build's)`);
    if (!hit.length && !gone.length) out(`none: ${rest[0]}`);
    out(`(${pk.list.length} packets in BDS ${pr.ver}; ids read from each class's getId() in the code; node lab.mjs proto <Packet> for its fields)`);
    return hit.length + gone.length > 0;
  }
  if (sub === 'diff') {
    let [fa, fb] = rest.filter((x) => x.endsWith('.json'));
    if (!fa) { const prev = previousProfile(pr.ver); if (!prev) { out(`no profile older than ${pr.ver} to compare with (the next Minecraft update makes one)`); return true; } fa = prev.file; fb = pr.file; }
    if (short) { out(await shortDiff(fa, fb)); return true; }
    return pass(['diff', fa, fb]);
  }
  if (sub === 'commands') {
    const hidden = p.commands.filter((c) => !c.inOfficialMetadata).map((c) => c.name).sort();
    const st = flag('--no-try') ? null : await measure(pr.ver, hidden, out);
    const text = langMap(), desc = (n) => { const c = p.commands.find((x) => x.name === n); const t = c?.descriptionKey && text.get(c.descriptionKey); return t ? `${n} (${t})` : n; };
    const by = (s) => hidden.filter((n) => st?.[n] === s);
    out(`${hidden.length} commands in the BDS ${pr.ver} binary that Mojang's command docs leave out${st ? '' : ' (not tried: --no-try)'}:`);
    if (st) {
      if (by('works').length) out(`  this BDS runs: ${by('works').map(desc).join(' · ')}`);
      if (by('args').length) out(`  this BDS has, with arguments: ${by('args').map(desc).join(' · ')}`);
      if (by('absent').length) out(`  not on this BDS (Education, the client, other builds): ${by('absent').join(' ')}`);
    } else out(`  ${hidden.map(desc).join(' · ')}`);
    out('(their arguments are not in the binary in a readable form: try them in node lab.mjs run, or ts "run(\'<command> ...\')")');
    return true;
  }
  // the summary
  const f = p.facts ?? {}, w = p.wss ?? {}, named = p.enums.filter((e) => e.source && e.source !== 'shape').length;
  const hidden = p.commands.filter((c) => !c.inOfficialMetadata).map((c) => c.name);
  const beta = (() => { try { return JSON.parse(read(path.join(TOP, kind(), '.lab', 'beta.json'))); } catch { return {}; } })();
  const dc = docsCheck(p);
  out(`BDS ${pr.ver} binary${pr.made ? ` (read in ${Math.round(pr.ms / 100) / 10} s)` : ''}: ${p.packets?.basis ? `${p.packets.list.length} packets (ids from getId()${dc && !dc.differ.length ? `; the ${dc.same} in Mojang's protocol docs agree` : ''})` : 'packet ids unreadable'} · ${p.enums.length} enums (${named} with their real type name) · ${p.commands.length} commands (${hidden.length} not in Mojang's docs) · WSS ${w.summary?.eventTypeValues ?? '?'} event types`);
  if (dc?.differ.length) out(`W packet ids that differ from Mojang's protocol docs (${dc.from}): ${dc.differ.slice(0, 6).join(', ')}${dc.differ.length > 6 ? ' …' : ''}`);
  out(`script modules it knows: ${(f.scriptModules ?? []).filter((m) => m.referenced).map((m) => m.name.replace('@minecraft/', '') + (beta[m.name.replace('@minecraft/', '')] ? ` ${beta[m.name.replace('@minecraft/', '')]}` : '')).join(' ')} (versions: this lab's measured ones; the binary does not carry them)`);
  const prev = previousProfile(pr.ver);
  if (prev) out(await shortDiff(prev.file, pr.file));
  out('next: bb packets <name> · bb enum <name> · bb commands · bb strings <word> · bb diff · bb site');
  return true;
}
