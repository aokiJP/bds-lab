// LAN: nethernet-connect (common/nethernet-connect) inside the lab. Only peers on this machine, the same LAN, or the user's own
// Tailscale devices are ever contacted (discovery, signaling, ICE, RakNet: all behind its guard).
//   1) LAB_TRANSPORT=lan: the lab's BDS runs NetherNet with LAN visibility; real players join it the way a local world is
//      joined (UDP 7551 discovery + LAN signaling), not by BDS's own HTTP signaling
//   2) node lab.mjs lan ...: a local world (a PC/phone/console with "Visible to LAN players") or a server on this network:
//      list, run a test file with real players (client-side expectations only: it is not the lab's server), accounts,
//      snapshot/restore (things on this machine), web (the own-network dashboard)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NC_DIR = path.join(HERE, 'nethernet-connect');
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// nethernet-connect + its own bedrock-protocol with real Xbox sign-in (the lab's copy stubs prismarine-auth: offline only)
let loaded = null;
export async function ncLoad(CACHE) {
  if (loaded) return loaded;
  if (!fs.existsSync(path.join(NC_DIR, 'dist', 'src', 'index.js'))) throw new Error('common/nethernet-connect is missing (from the nethernet-connect project: node scripts/vendor.mjs <this lab>)');
  const dir = path.join(CACHE, 'nc');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'bedrock-protocol'))) {
    fs.mkdirSync(dir, { recursive: true });
    const deps = JSON.parse(fs.readFileSync(path.join(NC_DIR, 'package.json'), 'utf8')).dependencies;
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: deps }));
    // --ignore-scripts: raknet-native's native build is optional (the lab's own RakNet client is used)
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN, env: { ...process.env, npm_config_allow_git: 'all' } });
    if (r.status !== 0) throw new Error('npm install for nethernet-connect failed:\n' + (r.stderr || r.stdout).slice(-800));
  }
  const req = createRequire(path.join(dir, 'package.json'));
  const nc = await import(pathToFileURL(path.join(NC_DIR, 'dist', 'src', 'index.js')).href);
  nc.useBedrockProtocol(req);
  loaded = { nc, req, dir };
  return loaded;
}

// ---- 1) LAB_TRANSPORT=lan: the lab's BDS, found by LAN discovery on this machine only
let labEndpoint = null;
export async function labJoin(CACHE, { name }) {
  const { nc, req, dir } = await ncLoad(CACHE);
  const config = nc.normalizeConfig({
    auth: { offline: true, username: name, profilesFolder: path.join(dir, 'auth') },
    lanPolicy: { scope: 'same-host', tailscale: { mode: 'off' } },
    session: { observe: 'off' },
    requireManualConfirmation: false,
  });
  const guard = new nc.LanGuard(new nc.LanScope(config.lanPolicy), {});
  if (!labEndpoint) {
    for (let k = 0; k < 5 && !labEndpoint; k++) {
      const worlds = await nc.discoverLanWorlds(guard, config.targets, { host: '127.0.0.1', timeoutMs: 2500, offline: true });
      const w = worlds.find((x) => x.decision.allowed && x.levelName === 'lab') ?? worlds.find((x) => x.decision.allowed);
      if (w) labEndpoint = nc.endpointFromWorld(w);
    }
    if (!labEndpoint) throw new Error('transport=lan: the lab server did not answer LAN discovery on UDP 7551 (enable-lan-visibility; another program on 7551?)');
  }
  return { nc, req, config, guard, endpoint: labEndpoint, transport: 'lan' };
}
export function labJoinReset() { labEndpoint = null; }

// ---- 2) node lab.mjs lan ...
function configFor(nc, dir, o) {
  const file = o.config ?? (fs.existsSync(path.join(process.cwd(), 'lan.json')) ? path.join(process.cwd(), 'lan.json') : null);
  const base = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const c = nc.normalizeConfig({
    ...base,
    auth: { profilesFolder: path.join(dir, 'auth'), ...(base.auth ?? {}), ...(o.offline ? { offline: true, username: o.name ?? 'LabBot' } : {}) },
    restore: { store: path.join(dir, 'snapshots'), ...(base.restore ?? {}) },
    requireManualConfirmation: false,
  });
  for (const w of c.warnings) console.log('lan config: ' + w);
  return c;
}

function parseOpts(rest) {
  const o = { pos: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i], v = () => { const x = rest[++i]; if (x === undefined) throw new Error(`${a}: value missing`); return x; };
    if (a === '--host') o.host = v();
    else if (a === '--world') o.world = v();
    else if (a === '--id') o.id = v();
    else if (a === '--account') o.account = v();
    else if (a === '--name') o.name = v();
    else if (a === '--config') o.config = path.resolve(v());
    else if (a === '--timeout') o.timeout = Number(v());
    else if (a === '--snapshot') o.snapshot = v();
    else if (a === '--port') o.port = Number(v());
    else if (a === '--offline') o.offline = true;
    else if (a === '--observe') o.observe = true;
    else if (a === '--no-observe') o.observe = false;
    else if (a === '--no-chat') o.chat = false;
    else if (a === '--force') o.force = true;
    else if (a.startsWith('--')) throw new Error(`lan: unknown option ${a}`);
    else o.pos.push(a);
  }
  return o;
}

const rx = (src) => { const m = /^\(\?i\)/.exec(src); return new RegExp(m ? src.slice(4) : src, m ? 'i' : ''); };

function describe(e) {
  const where = e.via === 'this-host' ? 'this machine' : e.via === 'tailscale' ? `Tailscale ${e.device}` : 'LAN';
  const how = ['lan', 'http', 'raknet'].filter((t) => e[t]).map((t) => (t === e.preferred ? t + '*' : t)).join('/');
  return `${e.decision.allowed ? 'ok ' : 'NO '} ${e.kind} "${e.kind === 'world' ? e.levelName : e.motd}" ${e.address} (${where}) ${e.playerCount}/${e.playersMax} v${e.gameVersion ?? e.protocol ?? '?'} via ${how} id=${e.id}${e.decision.allowed ? '' : ' — ' + e.decision.reason}`;
}

async function pick(nc, config, guard, o, out) {
  const all = await nc.discoverEndpoints(guard, config, { timeoutMs: o.timeout || config.botBehavior.discoveryTimeoutMs, host: o.host });
  all.forEach((e) => out(describe(e)));
  let c = all.filter((e) => e.decision.allowed);
  if (o.id) c = c.filter((e) => e.id === o.id);
  if (o.world) c = c.filter((e) => e.levelName === o.world || e.motd === o.world);
  if (!c.length) throw new Error('lan: nothing to join on this network (host: "Visible to LAN players" on? same LAN / own Tailscale device?)');
  if (c.length > 1) throw new Error(`lan: ${c.length} candidates, choose one with --world <name> or --id <id>`);
  return c[0];
}

// a test file against a world/server that is not the lab's: `@Name join [k=v]`, `@Name <verb> ...`, `wait <ms>`, `## section`,
// expectations `~ regex` / `!~ regex` / `= line` over what the real players print (no server log: server commands are refused)
export async function lanRun(CACHE, rest, out) {
  const o = parseOpts(rest);
  const file = o.pos[0];
  if (!file || !fs.existsSync(file)) throw new Error('lan run <tests.txt> [--world <name>|--id <id>|--host <ip>] [--account <name>|--offline --name <n>] [--observe|--no-observe] [--snapshot <world dir|world name|bds dir>]');
  const { nc, req, dir } = await ncLoad(CACHE);
  const config = configFor(nc, dir, o);
  const ts = await nc.loadTailscale(config.lanPolicy.tailscale);
  const guard = new nc.LanGuard(new nc.LanScope(config.lanPolicy, undefined, ts), { onDeny: (s, d) => out(`guard: ${s}: ${d}`) }, { trustedHostKeys: config.targets.trustedHostKeys });
  const ep = await pick(nc, config, guard, o, out);
  const { version } = nc.resolveVersion(config.botBehavior.version, ep.protocol, ep.gameVersion);
  config.botBehavior.version = version;
  const observe = o.observe ?? (ep.kind === 'world');
  out(`lan: ${ep.kind} "${ep.kind === 'world' ? ep.levelName : ep.motd}" ${ep.address} via ${ep.preferred} | ${config.auth.offline ? 'offline' : 'account ' + (o.account ?? config.auth.account ?? '(first registered)')} | ${observe ? 'observe (changes nothing)' : 'normal'}`);

  let snap = null;
  if (o.snapshot) snap = snapshotOf(nc, config, o.snapshot, out);

  const steps = [];
  let sec = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('## ')) { sec = { title: l.slice(3), from: steps.length }; return; }
    if (!l || l.startsWith('#')) return;
    const m = /^(!~|[=~])\s?(.*)$/.exec(l);
    if (m) { if (!steps.length) throw new Error(`${file}:${i + 1}: expectation before any command`); steps.at(-1).exp.push({ op: m[1], v: m[2], line: i + 1 }); }
    else steps.push({ cmd: l, exp: [], sec, out: [] });
  });

  const lines = [];
  const emit = (l) => { lines.push(l); if (process.env.LAB_DEBUG) out('  ' + l); };
  const bots = new Map();
  const { createRealPlayer } = createRequire(import.meta.url)('./realplayer.cjs');
  for (const st of steps) {
    const n0 = lines.length;
    const m = /^@(\S+)\s+(\S+)\s*(.*)$/.exec(st.cmd);
    try {
      if (m && m[2] === 'join') {
        const jo = Object.fromEntries(m[3].split(/\s+/).filter(Boolean).map((x) => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }));
        const account = jo.account ?? o.account; delete jo.account;
        const obs = jo.observe !== undefined ? jo.observe !== 'off' : observe; delete jo.observe;
        const chat = jo.chat !== undefined ? jo.chat !== 'off' : o.chat !== false; delete jo.chat;
        const cfg = { ...config, auth: { ...config.auth, ...(config.auth.offline ? { username: m[1] } : {}) } };
        const bot = await createRealPlayer({
          req, host: ep.address, port: ep.raknet?.port ?? ep.http?.port ?? 19132, name: m[1], version, emit,
          blockAt: async () => null, itemTags: async () => ({}), packNames: {}, opts: jo, transport: 'lan',
          lan: { nc, config: cfg, guard, endpoint: ep, transport: ep.preferred, account, observe: obs, allowChat: chat },
        });
        bots.set(m[1], bot);
      } else if (m) {
        const b = bots.get(m[1]);
        if (!b) throw new Error(`not joined (use: @${m[1]} join)`);
        await b.act(m[2], m[3] ? m[3].split(/\s+/) : []);
        if (m[2] === 'leave') bots.delete(m[1]);
      } else if (/^wait\s+\d+$/.test(st.cmd)) await sleep(Number(st.cmd.split(/\s+/)[1]));
      else throw new Error(`lan run: "${st.cmd}" is a server command; this world is not the lab's server (only @Name ... and wait)`);
    } catch (e) { lines.push(`ERROR ${st.cmd}: ${e.message}`); }
    await sleep(300);
    st.out = lines.slice(n0);
  }
  for (const b of bots.values()) try { b.close(); } catch { /* gone */ }

  let pass = 0, total = 0;
  steps.forEach((st, k) => {
    const from = st.sec ? st.sec.from : k;
    const seen = steps.slice(from, k + 1).flatMap((x) => x.out);
    for (const e of st.exp) {
      total++;
      const ok = e.op === '~' ? seen.some((l) => rx(e.v).test(l)) : e.op === '!~' ? !seen.some((l) => rx(e.v).test(l)) : seen.includes(e.v);
      if (ok) pass++;
      out(`${ok ? '✔' : '✘'} ${file}:${e.line} ${e.op} ${e.v}${ok ? '' : '\n  after: ' + st.cmd + '\n  saw: ' + (st.out.slice(-6).join(' | ') || '(nothing)')}`);
    }
  });
  if (snap) out(`lan: snapshot ${snap.id} was taken before the run. To put it back (close the world / stop the server first): node lab.mjs lan restore ${snap.id}`);
  out(total && pass === total ? `PASS ${pass}/${total}` : `FAIL ${pass}/${total}`);
  return total > 0 && pass === total;
}

function snapshotOf(nc, config, what, out) {
  const store = new nc.SnapshotStore(config.restore.store);
  let kind, dir;
  if (fs.existsSync(path.join(what, 'server.properties'))) [kind, dir] = ['bds', what];
  else if (fs.existsSync(path.join(what, 'level.dat'))) [kind, dir] = ['world', what];
  else {
    const t = config.restore.targets.find((x) => x.name === what);
    if (t) [kind, dir] = [t.kind, t.path];
    else {
      const found = nc.findWorldFolders(what);
      if (found.length !== 1) throw new Error(found.length ? `several worlds named "${what}": ${found.join(' / ')}` : `no world named "${what}" on this machine (a folder path works too)`);
      [kind, dir] = ['world', found[0]];
    }
  }
  const m = store.take(kind, dir, what);
  out(`lan: snapshot ${m.id} (${kind} ${m.source}, ${m.files.length} files)`);
  return m;
}

export async function lanCmd(CACHE, rest, out) {
  const [sub, ...more] = rest;
  const { nc, dir } = await ncLoad(CACHE);
  const o = parseOpts(more);
  const config = configFor(nc, dir, o);
  if (sub === 'run') return lanRun(CACHE, more, out);
  if (sub === 'list' || !sub) {
    const ts = await nc.loadTailscale(config.lanPolicy.tailscale);
    const scope = new nc.LanScope(config.lanPolicy, undefined, ts);
    scope.describe().forEach((l) => out('scope: ' + l.trim()));
    const guard = new nc.LanGuard(scope, { onDeny: (s, d) => out(`guard: ${s}: ${d}`) }, { trustedHostKeys: config.targets.trustedHostKeys });
    const all = await nc.discoverEndpoints(guard, config, { timeoutMs: o.timeout || config.botBehavior.discoveryTimeoutMs, host: o.host });
    all.forEach((e) => out(describe(e)));
    if (!all.length) out('none (host: "Visible to LAN players" on? same LAN / own Tailscale device?)');
    return true;
  }
  if (sub === 'account') {
    const store = new nc.AccountStore(config.auth.profilesFolder);
    const [what, name] = o.pos;
    if (!what || what === 'list') { const l = store.list(); l.forEach((a) => out(`${a.name} ${a.gamertag ?? '-'} xuid=${a.xuid ?? '-'}`)); if (!l.length) out('no accounts (node lab.mjs lan account add <name>)'); return true; }
    if (what === 'add' && name) {
      // the browser opens on the code page with the code (and MS_EMAIL / MS_PASSWORD from .env) filled in: common/auth.mjs
      let auto = null;
      try {
        const a = await store.add(name, (c) => {
          out(`sign in: open ${c.verification_uri} and enter ${c.user_code} (the bot's Microsoft account)`);
          if (process.env.LAB_NO_AUTOFILL !== '1') import('./auth.mjs').then((m) => m.autoMicrosoft({ uri: c.verification_uri, code: c.user_code, out })).then((h) => { auto = h; }).catch((e) => out(`W autofill: ${e.message}`));
        });
        out(`OK account ${a.name}`);
      } finally { await auto?.close(); }
      return true;
    }
    if (what === 'remove' && name) { out(store.remove(name) ? `OK removed ${name}` : `${name}: not registered`); return true; }
    throw new Error('lan account list | add <name> | remove <name>');
  }
  if (sub === 'snapshot') { if (!o.pos[0]) throw new Error('lan snapshot <world dir | world name | bds dir | restore.targets name>'); snapshotOf(nc, config, o.pos[0], out); return true; }
  if (sub === 'snapshots') { const s = new nc.SnapshotStore(config.restore.store).list(); s.forEach((m) => out(`${m.id} ${m.kind} ${m.label} ${m.files.length} files ${m.source}`)); if (!s.length) out('none'); return true; }
  if (sub === 'restore') {
    if (!o.pos[0]) throw new Error('lan restore <id> [--force]');
    const r = await new nc.SnapshotStore(config.restore.store).restore(o.pos[0], { force: !!o.force });
    out(`OK restored ${r.restored} files (the state before: ${r.backup.id})`);
    return true;
  }
  if (sub === 'web') {
    const h = await nc.startWeb(config, { port: o.port });
    h.urls.forEach((u) => out('web: ' + u));
    out('web: Ctrl+C to stop');
    await new Promise((r) => process.once('SIGINT', r));
    await h.close();
    return true;
  }
  throw new Error('lan list | run <tests.txt> | account list|add|remove | snapshot <what> | snapshots | restore <id> | web');
}
