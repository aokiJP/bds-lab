#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import { launchBds, diagnose, bdsKind, ensureContainerRuntime, chooseRuntime, HINT_ROSETTA } from './launch.mjs';

export { hasIpv6, buildIpv6Shim } from './launch.mjs';

export function setProperties(dir, props) {
  const file = path.join(dir, 'server.properties');
  if (!fs.existsSync(file)) {
    const exe = ['bedrock_server', 'bedrock_server.exe'].some((n) => fs.existsSync(path.join(dir, n)));
    if (!exe) throw new Error(`${dir} に server.properties がありません（BDS を展開したフォルダを指定してください）`);
    fs.writeFileSync(file, ''); // 公式の zip では必ず入っているが、消えていても止まらないようにする
  }
  let p = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(props)) {
    const re = new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    p = re.test(p) ? p.replace(re, `${k}=${v}`) : `${p.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, p);
}

export function readProperties(dir) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(dir, 'server.properties'), 'utf8').split(/\r?\n/)) {
      const m = /^([^#=\s][^=]*)=(.*)$/.exec(line);
      if (m) out[m[1].trim()] = m[2].trim();
    }
  } catch { /* 無ければ空 */ }
  return out;
}

export const REQUIRED_PROPERTIES = {
  'online-mode': 'false',
  'transport': 'raknet',
  'allow-list': 'false',
  'content-log-console-output-enabled': 'true',
};

export const SUGGESTED_PROPERTIES = {
  'allow-cheats': 'true',
  'player-idle-timeout': '0',
  'default-player-permission-level': 'operator',
};

/**
 * 検証のためだけに上げる実機を、できるだけ速く・軽くする設定。
 * 見える範囲と動く範囲を削ると、起動時の地形生成と毎 tick の仕事がそのぶん減る。
 * 検証は原点そばの tickingarea の中で完結するので、削っても結果は変わらない。
 */
export const FAST_PROPERTIES = {
  'view-distance': '6',
  'tick-distance': '4',
  'max-players': '8',
  'difficulty': 'peaceful',
  'server-name': 'bds-lab',
  'texturepack-required': 'false',
  'compression-threshold': '1',
  'player-movement-score-threshold': '0',
  'chat-restriction': 'Disabled',
  'disable-custom-skin-validation': 'true',
  'emit-server-telemetry': 'false',
};

export function ensureRunnable(dir, { port, portV6, suggest = true } = {}) {
  const now = readProperties(dir);
  const want = { ...REQUIRED_PROPERTIES };
  if (suggest) for (const [k, v] of Object.entries(SUGGESTED_PROPERTIES)) if (now[k] === undefined || now[k] === '') want[k] = v;
  if (port) { want['server-port'] = String(port); want['server-portv6'] = String(portV6 ?? Number(port) + 1); }
  const changed = Object.entries(want).filter(([k, v]) => now[k] !== v);
  if (changed.length) setProperties(dir, Object.fromEntries(changed));
  return changed.map(([k, v]) => `${k}=${v}`);
}

export function udpFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    s.once('error', () => { try { s.close(); } catch { /* 閉じ済み */ } resolve(false); });
    s.once('listening', () => s.close(() => resolve(true)));
    try { s.bind(port, host); } catch { resolve(false); }
  });
}

export async function findFreePorts(port, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const p = port + i * 2;
    if (p > 65534) break;
    if (await udpFree(p) && await udpFree(p + 1)) return { port: p, portV6: p + 1 };
  }
  return null;
}

export const FAILURES = [
  {
    code: 'online-mode',
    re: /Could not connect to Minecraft services/i,
    why: 'online-mode=true のままで、Minecraft のサービスにつなげませんでした',
    repairLabel: 'server.properties の online-mode=false',
    hint: 'server.properties の online-mode を false にしてください（実機のサインインを待たずに起動します）',
    repair: (bds) => { setProperties(bds.dir, { 'online-mode': 'false' }); return true; },
  },
  {
    code: 'port',
    re: /(address already in use|port is already allocated|Failed to bind|bind: address|Address already in use)/i,
    why: 'ポートが使われています',
    repairLabel: '空いているポートに変える',
    hint: 'ポートが使用中です。別の BDS やゲームを止めるか、--port で変えてください',
    repair: async (bds) => {
      const free = await findFreePorts(bds.port + 2);
      if (!free) return false;
      bds.port = free.port;
      bds.portV6 = free.portV6;
      setProperties(bds.dir, { 'server-port': String(free.port), 'server-portv6': String(free.portV6) });
      return true;
    },
  },
  {
    code: 'ipv6',
    re: /(sysctl|disable_ipv6|IPv6 .*(bind|failed))/i,
    why: 'この環境ではコンテナの IPv6 の設定が通りません',
    hint: 'このコンテナ環境は IPv6 の sysctl を受け付けません。SANDBOX_BE_CONTAINER_IPV6=0 を付けて試してください',
    repairLabel: 'SANDBOX_BE_CONTAINER_IPV6=0（IPv6 を諦めて IPv4 だけで待ち受ける）',
    repair: (bds) => { process.env.SANDBOX_BE_CONTAINER_IPV6 = '0'; setProperties(bds.dir, { 'server-portv6': String(bds.portV6) }); return true; },
  },
  {
    code: 'rosetta',
    re: /(exec format error|rosetta error|qemu: uncaught target signal|Illegal instruction)/i,
    why: 'x86_64 のコンテナを動かせていません（Apple Silicon の Rosetta が要ります）',
    hint: HINT_ROSETTA,
    runtime: 'container',
    repair: null,
  },
  {
    code: 'mount',
    re: /(No such file or directory|cannot execute|not found)/i,
    why: 'コンテナから BDS のフォルダが見えていません',
    hint: 'Colima はホームフォルダの下しか共有しません。BDS をホームの下に置くか、colima の mounts に足してください',
    runtime: 'container',
    repair: null,
  },
];

// [Scripting] の行はアドオン側の例外。起動の失敗として扱わない（仕様書と報告が拾う）
const isScriptLine = (l) => /\[Scripting\]|Plugin \[/.test(l);

export function explainFailure(lines, runtime) {
  const f = FAILURES.find((x) => (!x.runtime || x.runtime === runtime) && lines.some((l) => !isScriptLine(l) && x.re.test(l)));
  return f?.hint ?? null;
}

export function classifyLine(line) {
  if (isScriptLine(line)) return null;
  return FAILURES.find((f) => f.re.test(line)) ?? null;
}

export class Bds {
  constructor({ dir, port = 19132, portV6 = 19133, level = 'sandbox-calibration', quiet = true, lan = false }) {
    this.dir = path.resolve(dir);
    this.port = port;
    this.portV6 = portV6;
    this.level = level;
    this.quiet = quiet;
    this.lan = lan;
    this.lines = [];
    this.listeners = new Set();
    this.child = null;
    this.handle = null;
  }

  get worldDir() { return path.join(this.dir, 'worlds', this.level); }

  /** 生成済みの世界を種として置く（作り直しの 1 回ぶんの起動を丸ごと省く） */
  seedWorld(from) {
    if (!from || !fs.existsSync(path.join(from, 'level.dat'))) return false;
    fs.mkdirSync(path.dirname(this.worldDir), { recursive: true });
    fs.cpSync(from, this.worldDir, { recursive: true });
    return true;
  }

  /** いまの世界を、パックを除いて種として保存する（次回の起動に使う） */
  snapshotWorld(to) {
    if (!fs.existsSync(path.join(this.worldDir, 'level.dat'))) return false;
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(this.worldDir, to, {
      recursive: true,
      filter: (src) => !/[\\/](behavior_packs|resource_packs)([\\/]|$)|world_(behavior|resource)_packs\.json$/.test(src),
    });
    return true;
  }

  prepare({ packs = [], resourcePacks = [], properties = {}, keepWorld = false } = {}) {
    const defaults = {
      ...REQUIRED_PROPERTIES,
      ...SUGGESTED_PROPERTIES,
      ...FAST_PROPERTIES,
      'level-name': this.level,
      'level-type': 'FLAT',
      'level-seed': '1',
      'gamemode': 'survival',
      'difficulty': 'normal',
      'enable-lan-visibility': 'false',
      'server-port': String(this.port),
      'server-portv6': String(this.portV6),
      'server-name': 'sandbox-be calibration',
    };
    setProperties(this.dir, Object.fromEntries(Object.entries({ ...defaults, ...properties }).map(([k, v]) => [k, String(v)])));

    if (!keepWorld) fs.rmSync(this.worldDir, { recursive: true, force: true });
    this.writePacks({ packs, resourcePacks });
    return this;
  }

  /** ワールドにパックを置き直す。behavior と resource の両方を見る */
  writePacks({ packs = [], resourcePacks = [] } = {}) {
    const put = (kind, list, file) => {
      if (!list.length) return;
      const ids = [];
      for (const pack of list) {
        const dest = path.join(this.worldDir, kind, pack.name);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        for (const [rel, body] of Object.entries(pack.files)) {
          fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
          fs.writeFileSync(path.join(dest, rel), body);
        }
        ids.push({ pack_id: pack.uuid, version: pack.version ?? [1, 0, 0] });
      }
      fs.mkdirSync(this.worldDir, { recursive: true });
      fs.writeFileSync(path.join(this.worldDir, file), JSON.stringify(ids));
    };
    put('behavior_packs', packs, 'world_behavior_packs.json');
    // リソースパックを置かないと、RP に依存している BP は実機に読み込まれない
    put('resource_packs', resourcePacks, 'world_resource_packs.json');
    return this;
  }

  start({ timeoutMs = 120000 } = {}) {
    this.handle = launchBds({ dir: this.dir, ports: [this.port, this.portV6], lan: this.lan });
    this.child = this.handle.child;
    let buf = '';
    const feed = (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        this.lines.push(line);
        if (!this.quiet) process.stdout.write(`${line}\n`);
        for (const cb of this.listeners) cb(line);
      }
    };
    this.child.stdout.on('data', feed);
    this.child.stderr.on('data', feed);
    this.child.stdin.on('error', () => {}); // 落ちた後に書いても例外にしない
    const exited = new Promise((_, reject) => {
      this.child.on('error', (e) => reject(new Error(`BDS を起動できませんでした（${this.handle.describe}）: ${e.message}`)));
      this.child.on('close', (code) => {
        const tail = this.lines.slice(-8);
        const hint = explainFailure(tail, this.handle.runtime);
        reject(new Error(`BDS が終了しました（code ${code}, ${this.handle.describe}）: ${tail.slice(-5).join(' / ')}${hint ? `\n→ ${hint}` : ''}`));
      });
    });
    exited.catch(() => {}); // 起動後に止めたときの close を未処理にしない

    const failed = new Promise((_, reject) => {
      const off = this.onLine((line) => {
        const f = classifyLine(line);
        if (!f) return;
        off();
        const e = new Error(`BDS が起動できませんでした: ${f.why}\n  ${line.trim()}`);
        e.failure = f;
        reject(e);
      });
      this.child.on('close', off);
    });
    failed.catch(() => {});

    return Promise.race([this.waitFor(/Server started\./, timeoutMs), exited, failed]);
  }

  async up({ timeoutMs = 180000, attempts = 4, say = () => {} } = {}) {
    const tried = new Set();
    for (let i = 1; ; i++) {
      try {
        return await this.start({ timeoutMs });
      } catch (e) {
        await this.stop({ timeoutMs: 5000 }).catch(() => {});
        const f = e.failure;
        if (!f?.repair || i >= attempts || tried.has(f.code)) throw e;
        tried.add(f.code);
        say(`${f.why} → ${f.repairLabel} に直して、もう一度起動します`);
        if (!(await f.repair(this))) throw e;
        this.lines = [];
      }
    }
  }

  onLine(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  waitFor(re, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const hit = this.lines.find((l) => re.test(l));
      if (hit) return resolve(hit);
      const off = this.onLine((line) => { if (re.test(line)) { clearTimeout(timer); off(); resolve(line); } });
      const timer = setTimeout(() => { off(); reject(new Error(`実機の出力を待ちましたが来ませんでした: ${re}`)); }, timeoutMs);
    });
  }

  send(cmd) { if (this.child?.stdin.writable) this.child.stdin.write(`${cmd}\n`); }

  async stop({ timeoutMs = 30000 } = {}) {
    if (!this.child) return;
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const done = new Promise((resolve) => this.child.on('close', resolve));
      this.send('stop');
      const killer = setTimeout(() => this.handle.kill(), timeoutMs);
      await done;
      clearTimeout(killer);
    }
    this.child = null;
  }
}
