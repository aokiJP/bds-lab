'use strict';
// 実機 BDS にプレイヤーとしてつなぐ（Xbox 認証なし・offline）。
// bedrock-protocol をそのまま使うが、RakNet だけは自前実装に差し替える
// （同梱の JS 実装は RakNet protocol 10 固定で、1.26 系の実機は 11 を要求するため）。
const crypto = require('node:crypto');
const nodePath = require('node:path');
const { RakClient } = require('./raknet-client.cjs');

// 探す順: 梱包した vendor/node_modules → 手元の node_modules → カレント
const ROOT = nodePath.join(__dirname, '..', '..');
const SEARCH = [nodePath.join(ROOT, 'vendor'), ROOT, process.cwd(), nodePath.join(process.cwd(), 'node_modules'), __dirname];
/** bedrock-protocol は較正のときだけ使う任意の依存。入っていなければ理由を日本語で伝える。 */
function dep(name) {
  try { return require(require.resolve(name, { paths: SEARCH })); }
  catch { throw new Error(`実機にプレイヤーをつなぐには ${name} が要ります: npm run pack（vendor/ に梱包）か npm i -D bedrock-protocol`); }
}
function depPath(name) { return require.resolve(name, { paths: SEARCH }); }

function injectRaknet() {
  const rakPath = depPath('bedrock-protocol/src/rak');
  class Adapter extends RakClient {
    constructor(options) { super({ host: options.host, port: options.port }); }
    async ping(timeout = 3000) {
      super.ping();
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ping timed out')), timeout);
        this.once('pong', (s) => { clearTimeout(t); resolve(s); });
      });
    }
  }
  require.cache[rakPath] = {
    id: rakPath, filename: rakPath, loaded: true,
    exports: () => ({ RakClient: Adapter, RakServer: class {}, RakTimeout: Error }),
  };
}

/** 実機が受け付けるプロトコル版を、握手だけで突き止める。
 *  play_status=1（クライアントが古い）/ 2（サーバーが古い）を手がかりに二分探索する。 */
function probeProtocol(host, port, pv, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const varint = (n) => { const o = []; while (n >= 0x80) { o.push((n & 0x7f) | 0x80); n >>>= 7; } o.push(n); return Buffer.from(o); };
    const num = Buffer.alloc(4); num.writeInt32BE(pv);
    const body = Buffer.concat([Buffer.from([0xc1, 0x01]), num]);          // request_network_settings
    const batch = Buffer.concat([Buffer.from([0xfe]), varint(body.length), body]);
    const c = new RakClient({ host, port });
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { c.close(); } catch {} resolve(v); };
    c.on('error', () => fin('error'));
    c.onEncapsulated = (buf) => {
      let o = 1, len = 0, sh = 0, x;
      do { x = buf[o++]; len |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
      let id = 0; sh = 0;
      do { x = buf[o++]; id |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
      if (id === 2) return fin(buf.readInt32BE(o) === 1 ? 'client-old' : 'server-old');
      if (id === 143) return fin('ok');
      fin(`other:${id}`);
    };
    c.connect().then(() => setTimeout(() => c.sendReliable(batch), 200)).catch(() => fin('error'));
    setTimeout(() => fin('timeout'), timeoutMs);
  });
}

async function detectProtocol({ host = '127.0.0.1', port = 19132, hint = 2169, max = 4000 } = {}) {
  const seen = new Map();
  const ask = async (pv) => {
    if (seen.has(pv)) return seen.get(pv);
    const r = await probeProtocol(host, port, pv);
    seen.set(pv, r);
    return r;
  };
  if (await ask(hint) === 'ok') return hint;
  // 近いところを総当たりしてから、外れていれば二分探索に移る
  for (let d = 1; d <= 8; d++) {
    for (const pv of [hint + d, hint - d]) {
      if (pv < 1) continue;
      if (await ask(pv) === 'ok') return pv;
    }
  }
  let lo = hint, hi = max;
  if (seen.get(hint) === 'server-old') { hi = hint; lo = 1; }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await ask(mid);
    if (r === 'ok') return mid;
    if (r === 'client-old') lo = mid; else if (r === 'server-old') hi = mid; else break;
  }
  for (const pv of [hi, lo, hi + 1, lo - 1]) if (pv > 0 && await ask(pv) === 'ok') return pv;
  throw new Error('実機が受け付けるプロトコル版を見つけられませんでした');
}

/** プレイヤーとして参加し、コマンド・チャット・フォーム応答を扱えるようにする */
async function joinAsPlayer({
  host = '127.0.0.1', port = 19132, username = 'Steve',
  version,
  protocolVersion, spawnTimeoutMs = 60000, onText,
} = {}) {
  injectRaknet();
  const bp = dep('bedrock-protocol');
  version = version ?? dep('bedrock-protocol/src/options').CURRENT_VERSION;
  const hint = dep(`minecraft-data/minecraft-data/data/bedrock/${version}/version.json`).version;
  const pv = protocolVersion ?? await detectProtocol({ host, port, hint });
  // 版のずれを黙って進めない。
  // 実機のほうが新しいと、ログインだけ通って「参加した」ように見えるのに、
  // 入力（player_auth_input）や持ち物の操作は古い並びで組まれるのでサーバーに無視される。
  // 掘る・置く・歩くが「効かない」ときの原因はほぼこれなので、ここで止めて理由を出す。
  if (pv !== hint) {
    const how = pv > hint
      ? `実機のほうが新しい版です。手元の定義（minecraft-data）が追いつくまでは、この組み合わせでプレイヤーの操作は検証できません。\n` +
        `  直し方のどれか:\n` +
        `    1. 実機を ${version}（protocol ${hint}）に合わせる  — node tools/bds/get.mjs --zip <その版の zip>\n` +
        `    2. minecraft-data / bedrock-protocol を上げる       — npm i -D bedrock-protocol@latest\n` +
        `    3. 操作を伴わない検証だけ進める                     — calibrate（--bds）は影響を受けません`
      : `手元の定義のほうが新しい版です。実機を上げるか、bedrock-protocol の版を実機に合わせてください。`;
    const err = new Error(`プロトコルの版が食い違っています: 実機 ${pv} / 手元の定義 ${hint}（${version}）\n${how}`);
    err.code = 'PROTOCOL_MISMATCH';
    err.real = pv;
    err.local = hint;
    throw err;
  }
  const client = bp.createClient({ host, port, username, offline: true, skipPing: true, version, followPort: false, conLog: null });
  client.options.protocolVersion = pv;

  const pending = new Map();
  const forms = [];
  let formAnswer = null;
  client.on('error', () => {});                 // 版差による 1 パケットの解析失敗で落とさない
  client.on('command_output', (packet) => {
    const p = pending.get(packet.origin?.uuid);
    if (p) { pending.delete(packet.origin.uuid); p(packet); }
  });
  client.on('text', (packet) => onText?.(packet));
  client.on('modal_form_request', (packet) => {
    forms.push({ id: packet.form_id, data: JSON.parse(packet.data) });
    const answer = formAnswer ? formAnswer(JSON.parse(packet.data)) : null;
    // この版のパケット定義では、使わない側のフィールドも必ず埋める必要がある
    client.queue('modal_form_response', {
      form_id: packet.form_id,
      has_response_data: answer !== null,
      data: `${JSON.stringify(answer)}\n`,
      has_cancel_reason: answer === null,
      cancel_reason: 'closed',
    });
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('プレイヤーが湧きませんでした（spawn が来ません）')), spawnTimeoutMs);
    client.once('spawn', () => { clearTimeout(t); resolve(); });
  });

  return {
    client,
    protocolVersion: pv,
    forms,
    /** フォームへの答え方を決める。null を返すと「閉じた」扱い */
    answerForms(fn) { formAnswer = fn; },
    /** コマンドを流して、実機の command_output をそのまま受け取る */
    runCommand(command, timeoutMs = 5000) {
      const uuid = crypto.randomUUID();
      return new Promise((resolve) => {
        const t = setTimeout(() => { pending.delete(uuid); resolve(null); }, timeoutMs);
        pending.set(uuid, (packet) => { clearTimeout(t); resolve(packet); });
        client.queue('command_request', {
          command: command.startsWith('/') ? command : `/${command}`,
          origin: { type: 'player', uuid, request_id: '', player_entity_id: 0n },
          internal: false,
          version: 'latest',
        });
      });
    },
    chat(message) {
      client.queue('text', {
        type: 'chat', needs_translation: false, source_name: username, xuid: '', platform_chat_id: '', filtered_message: '', message,
      });
    },
    close() { try { client.close(); } catch {} },
  };
}

module.exports = { joinAsPlayer, detectProtocol, probeProtocol, injectRaknet };
