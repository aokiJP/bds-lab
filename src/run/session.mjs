import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bds, readProperties, findFreePorts } from '../../tools/bds/server.mjs';
import { upWithExperiments } from '../../tools/bds/experiments.mjs';
import crypto from 'node:crypto';
import { readAddon, asPack, asResourcePack } from '../verify/addon.mjs';
import { bundle } from '../util/bundle.mjs';
import { Bridge } from '../verify/bridge.mjs';
import { dependencies as deps } from '../util/modules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const AGENT_UUID = 'b7d2e5a1-3c44-4f90-8a12-6e5b9c7d0f01';

/**
 * 生成済みの世界の置き場。BDS の実体と実験機能の組み合わせごとに分ける。
 * 版を入れ替えれば鍵が変わるので、古い世界が使い回されることはない。
 */
function worldCache(bdsDir, experiments) {
  const exe = ['bedrock_server', 'bedrock_server.exe'].map((n) => path.join(bdsDir, n)).find((p) => fs.existsSync(p));
  const stamp = exe ? `${fs.statSync(exe).size}` : 'unknown';
  const key = crypto.createHash('sha1').update(`${stamp}|FLAT|1|${[...experiments].sort().join(',')}`).digest('hex').slice(0, 12);
  return path.join(ROOT, '.bds-lab', 'world-cache', key);
}

function agentPack() {
  return {
    name: 'bds-lab-agent',
    uuid: AGENT_UUID,
    files: {
      'manifest.json': JSON.stringify({
        format_version: 2,
        header: { name: 'bds-lab agent', description: '仕様書からの命令を実機で実行する', uuid: AGENT_UUID, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
        capabilities: ['script_eval'],
        modules: [{ type: 'script', language: 'javascript', uuid: 'b7d2e5a1-3c44-4f90-8a12-6e5b9c7d0f02', version: [1, 0, 0], entry: 'scripts/agent.js' }],
        dependencies: deps({ beta: true, ui: false, gametest: true }),
      }, null, 2),
      'scripts/agent.js': fs.readFileSync(path.join(HERE, '..', 'verify', 'agent.js'), 'utf8'),
    },
  };
}

export class LabSession {
  static async open({ bdsDir, addonDir, say = () => {}, timeoutMs = 240000, allowShell = false }) {
    const s = new LabSession();
    s.say = say;
    s.addonDir = addonDir;
    s.addon = readAddon(addonDir);
    s.waiters = [];
    s.tick = 0;
    s.scriptErrors = [];
    s.log = [];

    const props = readProperties(bdsDir);
    const base = Number.parseInt(props['server-port'] ?? '', 10);
    const free = await findFreePorts((Number.isFinite(base) ? base : 19132) + 60);
    if (!free) throw new Error('空いている UDP ポートが見つかりませんでした。ほかの BDS やゲームを止めてから、もう一度');
    s.bds = new Bds({ dir: bdsDir, level: 'bds-lab', port: free.port, portV6: free.portV6, quiet: true });
    const rp = asResourcePack(s.addon);
    const packs = { packs: [asPack(s.addon), agentPack()], resourcePacks: rp ? [rp] : [] };
    s.bds.prepare({ ...packs, properties: { gamemode: 'creative', 'player-idle-timeout': 0 } });
    if (rp) say(`  リソースパックも入れます: ${rp.name}`);

    const logFile = path.join(ROOT, '.bds-lab', 'server.log');
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.writeFileSync(logFile, ''); } catch { /* 書けなくても続ける */ }

    let armed = false;
    s.bridge = new Bridge({ ROOT, addonDir, send: (c) => s.bds.send(c), say, allowShell: Boolean(allowShell) });
    s.bds.onLine((raw) => {
      const line = s.bridge.resolve(s.bridge.clean(raw));
      if (s.bridge.handle(line)) return;
      try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* 同上 */ }
      if (!armed) return;
      const t = /\[Scripting\] LABTICK (\d+)/.exec(line);
      if (t) { s.tick = Number(t[1]); s.pump(); return; }
      const m = /\[Scripting\] (.*)$/.exec(line);
      if (!m) return;
      const text = m[1].trim();
      s.log.push(text);
      if (s.log.length > 4000) s.log.splice(0, 1000);
      if (/ERROR\] \[Scripting\]/.test(line)) s.scriptErrors.push(text);
      s.pump(text);
    });

    // Ctrl+C・kill で止められたら、実機も必ず落とす（孤児の BDS を残さない）
    const bail = (sig) => {
      if (s._stopping) return;
      s._stopping = true;
      say('');
      say('止めています…');
      s.close().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
    };
    s._onInt = () => bail('SIGINT');
    s._onTerm = () => bail('SIGTERM');
    process.on('SIGINT', s._onInt);
    process.on('SIGTERM', s._onTerm);
    const t0 = Date.now();
    const experiments = s.addon.lab?.experiments ?? ['gametest'];
    const cacheDir = worldCache(bdsDir, experiments);
    say(fs.existsSync(path.join(cacheDir, 'level.dat'))
      ? '実機を起動しています…'
      : '実機を起動しています（はじめだけ世界を作るので 2 回起動します。1 分ほど）…');
    const up = await upWithExperiments(s.bds, experiments, { timeoutMs, packs, cacheDir, say, onSecondBoot: () => { armed = true; } });
    s.bds.send('tickingarea add 0 0 0 63 0 63 lab');
    s.bds.send('gamerule sendcommandfeedback false');
    s.bds.send('gamerule dodaylightcycle false');
    s.version = (s.bds.lines.find((l) => /Version: [\d.]+/.test(l)) ?? '').match(/Version: ([\d.]+)/)?.[1] ?? null;
    s.loadId = await s.awaitAgent(90000);
    s.bootMs = Date.now() - t0;
    say(`実機 ${s.version ?? '?'} が上がりました（${(s.bootMs / 1000).toFixed(1)} 秒・起動 ${up.boots} 回）`);
    return s;
  }

  /**
   * 検証係が応答するまで待つ。1 行のログを待ち受けるのではなく、こちらから何度も呼びかける。
   * 起動の合図を取り逃しても、あとから必ず捕まえられる。
   */
  async awaitAgent(timeoutMs = 90000, { differentFrom = null } = {}) {
    const until = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < until) {
      try {
        const r = await this.do('ping', {}, { timeoutMs: 3000 });
        if (r?.loadId && (!differentFrom || r.loadId !== differentFrom)) return r.loadId;
        last = r?.loadId ?? null;
      } catch { /* まだ返らない。呼びかけ続ける */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`検証係が応答しません${last ? '（前の読み込みのままです）' : ''}。実機が出した理由:\n${this.diagnose()}`);
  }

  // 起動に失敗したとき、実機が何を言ったかをそのまま見せる
  diagnose() {
    const lines = this.bds.lines ?? [];
    const hits = lines
      .filter((l) => /\[Scripting\]|Error|error|failed|Failed|pack|Pack/.test(l))
      .filter((l) => !/LABTICK/.test(l))
      .slice(-12);
    const pretty = hits.map((l) => `  ${l.replace(/^\[[^\]]*\]\s*/, '').trim()}`).join('\n');
    const hint = /module|dependency|version/i.test(hits.join(' '))
      ? '\n  モジュールの版が実機に無い可能性があります。addons/<名前>/manifest.json の dependencies を確かめてください'
      : '';
    return `${pretty || '  （出力がありません）'}${hint}\n  全文: .bds-lab/server.log`;
  }

  pump(text) {
    for (const w of [...this.waiters]) {
      if (w.kind === 'tick' && this.tick >= w.until) { this.done(w, this.tick); continue; }
      if (w.kind === 'line' && text && w.re.test(text)) this.done(w, text);
    }
  }

  done(w, value) {
    this.waiters = this.waiters.filter((x) => x !== w);
    clearTimeout(w.timer);
    w.resolve(value);
  }

  waitFor(re, ms = 15000) {
    return new Promise((resolve, reject) => {
      const w = { kind: 'line', re, resolve };
      w.timer = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error(`実機からの ${re} が来ませんでした`)); }, ms);
      this.waiters.push(w);
    });
  }

  ticks(n) {
    return new Promise((resolve) => {
      const w = { kind: 'tick', until: this.tick + n, resolve };
      w.timer = setTimeout(() => this.done(w, this.tick), n * 50 + 8000);
      this.waiters.push(w);
    });
  }

  async do(op, args = {}, { timeoutMs = 12000 } = {}) {
    const id = String(++LabSession.seq);
    const waiting = this.waitFor(new RegExp(`^LAB ${id} (ok|err) `), timeoutMs);
    this.bds.send(`scriptevent lab:do ${JSON.stringify({ id, op, args })}`);
    const line = await waiting;
    const m = new RegExp(`^LAB ${id} (ok|err) ([\\s\\S]*)$`).exec(line);
    if (m[1] === 'err') throw new Error(`実機が断りました（${op}）: ${m[2]}`);
    try { return JSON.parse(m[2]); } catch { return m[2]; }
  }

  command(cmd) { this.bds.send(cmd.replace(/^\//, '')); }

  since() { const at = this.log.length; return () => this.log.slice(at); }

  // 読み込み直後からのログ。起動時に 1 度だけ出る行（loaded など）はここで見る
  sinceLoad() { const at = this.loadMark ?? 0; return this.log.slice(at); }

  async evalSupported() {
    if (this._eval !== undefined) return this._eval;
    const r = await this.do('evalSupported').catch(() => ({ ok: false }));
    this._eval = r.ok === true;
    if (!this._eval && r.reason) this.evalReason = r.reason;
    return this._eval;
  }

  async evalUpdate({ chunk = 700 } = {}) {
    this.loadMark = this.log.length;
    this.addon = readAddon(this.addonDir);
    const b = bundle({ files: this.addon.files, entry: this.addon.entry });
    if (b.error) return { ok: false, reason: b.error };
    const t0 = Date.now();
    this.scriptErrors = [];
    await this.do('despawn').catch(() => {});
    await this.do('srcBegin');
    for (let i = 0; i < b.source.length; i += chunk) {
      this.bds.send(`scriptevent lab:do ${JSON.stringify({ id: `c${i}`, op: 'srcChunk', args: { text: b.source.slice(i, i + chunk) } })}`);
    }
    const r = await this.do('evalLoad', {}, { timeoutMs: 30000 });
    return { ok: true, how: 'eval', ms: Date.now() - t0, ...r };
  }

  async apply({ how = 'auto' } = {}) {
    if (how !== 'reload' && await this.evalSupported()) {
      const r = await this.evalUpdate().catch((e) => ({ ok: false, reason: String(e.message ?? e) }));
      if (r.ok) return r;
      this.say(`  eval で入れ替えられないので入れ直します: ${r.reason}`);
    } else if (how === 'eval') {
      throw new Error(`この実機は eval を許しません（${this.evalReason ?? '理由不明'}）`);
    }
    await this.do('evalUnload').catch(() => {});
    return { ...(await this.update()), how: 'reload' };
  }

  async update() {
    this.loadMark = this.log.length;
    this.addon = readAddon(this.addonDir);
    const dest = path.join(this.bds.worldDir, 'behavior_packs', this.addon.name);
    fs.rmSync(dest, { recursive: true, force: true });
    for (const [rel, body] of Object.entries(this.addon.files)) {
      const p = path.join(dest, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
    const rp = asResourcePack(this.addon);
    if (rp) this.bds.writePacks({ resourcePacks: [rp] });
    this.scriptErrors = [];
    const t0 = Date.now();
    await this.do('despawn').catch(() => {});
    const before = this.loadId;
    this.command('reload');
    this.loadId = await this.awaitAgent(40000, { differentFrom: before });
    return { ms: Date.now() - t0 };
  }

  /** 同じ実機に、本物のクライアントで入る。入力はクライアント、値は検証係が読む */
  async connectReal({ name = 'Cam', timeoutMs = 60000 } = {}) {
    if (this.bot) return this.bot;
    const { createRealPlayer } = await import('../../tools/live/realplayer.mjs');
    this.bot = await createRealPlayer({ port: this.bds.port, name, world: { origin: { x: 0, y: -59, z: 0 }, blocks: [] }, timeoutMs });
    this.botName = name;
    await this.bot.ticks(20);
    const r = await this.do('attach', { name });
    if (!r?.attached) throw new Error(`実機が ${name} を見つけられません（居るのは ${(r?.players ?? []).join(' / ') || 'なし'}）`);
    return this.bot;
  }

  async disconnectReal() {
    if (!this.bot) return;
    // realplayer が出すのは close()。ここを間違えると RakNet の接続と 50ms の周期処理が残り、
    // コマンドが終わっても node が居座る
    try { (this.bot.close ?? this.bot.disconnect)?.call(this.bot); } catch { /* 片付けだけ */ }
    this.bot = null;
    await this.do('detach', {}, { timeoutMs: 3000 }).catch(() => {});
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._onInt) process.off('SIGINT', this._onInt);
    if (this._onTerm) process.off('SIGTERM', this._onTerm);
    if (this.bot) await this.disconnectReal().catch(() => {});
    await this.bds.stop({ timeoutMs: 10000 }).catch(() => {});
  }
}
LabSession.seq = 0;
