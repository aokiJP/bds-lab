// discord: the person's own bot (DISCORD_BOT_TOKEN) talking to them alone (DISCORD_USER_ID) in its DM — the lab's way to a
// phone with no node and no terminal: the CI device's screen with a controller of buttons (app hold: every press answered
// with the screen after it), and a form whose values become the repository's secrets (app secrets ask: secrets.yml).
// No library: Discord's REST API through fetch (FormData for a picture) and its gateway through Node 22's WebSocket.
// Only the DM with that one person counts: a message or a press from anyone else, or from a server (a guild), is not seen.
export const API = 'https://discord.com/api/v10';
// (DISCORD_API_URL: another place for the API — the lab's tests point it at a fake one, as GITHUB_API_URL)
const apiBase = () => process.env.DISCORD_API_URL || API;
// the gateway's DIRECT_MESSAGES: the DM's messages come with their text (a DM needs no MESSAGE_CONTENT); presses always come
export const INTENTS = 1 << 12;
export const LIMIT = 2000;   // a message's text, at most

/** what the lab needs to talk to the person (pure): { token, userId } or { missing: [names] } */
export function config(env = process.env) {
  const token = String(env.DISCORD_BOT_TOKEN ?? '').trim(), userId = String(env.DISCORD_USER_ID ?? '').trim();
  const missing = [...(token ? [] : ['DISCORD_BOT_TOKEN']), ...(/^\d{15,22}$/.test(userId) ? [] : ['DISCORD_USER_ID'])];
  return missing.length ? { missing } : { token, userId };
}

// ---- messages: buttons, rows, forms (pure) ----
export const button = (label, id, style = 2, disabled = false) => ({ type: 2, style, label: String(label).slice(0, 80), custom_id: String(id).slice(0, 100), ...(disabled ? { disabled: true } : {}) });
export const row = (...buttons) => ({ type: 1, components: buttons.slice(0, 5) });
/** a form (modal): fields [{ id, label, long?, required?, placeholder?, max? }] (up to 5) */
export function modal(id, title, fields) {
  return {
    custom_id: String(id).slice(0, 100), title: String(title).slice(0, 45),
    components: fields.slice(0, 5).map((f) => row({ type: 4, custom_id: String(f.id).slice(0, 100), label: String(f.label).slice(0, 45), style: f.long ? 2 : 1, required: f.required ?? true, max_length: f.max ?? 4000, ...(f.placeholder ? { placeholder: String(f.placeholder).slice(0, 100) } : {}) })),
  };
}
/** a submitted form's values (pure): { <field id>: value } */
export function modalValues(d) {
  const out = {};
  for (const r of d?.data?.components ?? []) for (const c of r.components ?? (r.component ? [r.component] : [])) if (c?.custom_id !== undefined) out[c.custom_id] = String(c.value ?? '');
  return out;
}
/** who sent an event (pure): the user's id of a message or a press; null for a server's (a guild's) — never ours */
export function senderOf(d) {
  if (!d || d.guild_id) return null;
  return d.author?.id ?? d.user?.id ?? d.member?.user?.id ?? null;
}
/** a message from the person themselves in the DM (pure): not a bot's, not from a server */
export const fromPerson = (d, userId) => Boolean(d) && senderOf(d) === String(userId) && !d.author?.bot;
/** text in a code block within a message's limit (pure): the end kept, the front said to be left out */
export function codeBlock(text, room = LIMIT - 40) {
  let t = String(text ?? '').replace(/```/g, "'''");
  if (t.length > room) t = `…（前を省略）\n${t.slice(t.length - room + 12)}`;
  return `\`\`\`\n${t || ' '}\n\`\`\``;
}

// what Discord's error codes mean for the person (the fix is theirs: a setting, a server, a token)
const HINTS = {
  token: 'ボットのトークン（DISCORD_BOT_TOKEN）が違うか、作り直されています',
  50007: '（ボットが DM を送れません: ボットと同じサーバーに入っていて、そのサーバーの「メンバーからの DM を許可」がオンか、DISCORD_USER_ID が自分の ID かを確かめてください）',
  10013: '（そのユーザーがいません: DISCORD_USER_ID が自分の Discord のユーザー ID〔数字〕かを確かめてください）',
  10062: '（その押した合図は古すぎます: 15 分を過ぎた）',
};
// the gateway's close codes that no reconnect can fix
export const FATAL = { 4004: HINTS.token, 4010: 'shard が違います', 4011: 'shard が要ります', 4012: 'API の版が違います', 4013: 'intents が違います', 4014: '使えない intents です（DIRECT_MESSAGES だけで足ります）' };

// ---- REST ----
/** Discord's REST API with the bot's token → call(method, path, body?, files?) (files: [{ name, data: Buffer, type }]).
 *  A rate limit (429) is waited out and tried again (3 times) */
export function rest({ token, base = apiBase(), fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return async function call(method, p, body, files = []) {
    for (let attempt = 0; ; attempt++) {
      let init;
      if (files.length) {
        const fd = new FormData();
        fd.append('payload_json', JSON.stringify({ ...(body ?? {}), attachments: files.map((f, i) => ({ id: i, filename: f.name })) }));
        files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.data], { type: f.type ?? 'application/octet-stream' }), f.name));
        init = { method, headers: { authorization: `Bot ${token}`, 'user-agent': 'DiscordBot (https://github.com/aokijp/bds-lab, 1) bds-lab' }, body: fd };
      } else init = { method, headers: { authorization: `Bot ${token}`, 'content-type': 'application/json', 'user-agent': 'DiscordBot (https://github.com/aokijp/bds-lab, 1) bds-lab' }, body: body === undefined ? undefined : JSON.stringify(body) };
      const r = await fetchImpl(`${base}${p}`, { ...init, signal: AbortSignal.timeout(60_000) });
      if (r.status === 429 && attempt < 3) { let wait = 1; try { wait = Number((await r.json()).retry_after) || 1; } catch { /* a plain 429 */ } await sleep(Math.min(wait, 30) * 1000); continue; }
      if (!r.ok) {
        const text = await r.text();
        let code = null; try { code = JSON.parse(text).code ?? null; } catch { /* not JSON */ }
        throw Object.assign(new Error(`Discord ${method} ${p.replace(/\/[\w-]{60,}/g, '/…')}: ${r.status} ${text.slice(0, 200)}${HINTS[code] ?? (r.status === 401 ? `（${HINTS.token}）` : '')}`), { status: r.status, code });
      }
      return r.status === 204 ? null : r.json();
    }
  };
}

// ---- the bot: its DM with the person, the gateway's events ----
/** → { dm(), send(), edit(), respond(), followUp(), editReply(), listen(onEvent), close() }.
 *  log: where the connection's troubles are said (never a token) */
export function bot({ token, userId, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, log = () => {}, sleep } = {}) {
  const call = rest({ token, fetchImpl, sleep });
  let channel = null, appId = null, ws = null, closed = false, hb = null, first = null;
  const self = {
    call,
    /** the DM's channel with the person (made once) */
    async dm() { channel ??= (await call('POST', '/users/@me/channels', { recipient_id: String(userId) })).id; return channel; },
    /** a message to the person: { content, components, files } → the message */
    async send({ content = '', components, files = [] } = {}) { return call('POST', `/channels/${await self.dm()}/messages`, { content: String(content).slice(0, LIMIT), ...(components ? { components } : {}), allowed_mentions: { parse: [] } }, files); },
    /** a message of the bot's changed (files: its pictures replaced) */
    async edit(messageId, { content, components, files = [] } = {}) { return call('PATCH', `/channels/${await self.dm()}/messages/${messageId}`, { ...(content !== undefined ? { content: String(content).slice(0, LIMIT) } : {}), ...(components ? { components } : {}) }, files); },
    /** the answer to a press or a form, within its 3 seconds: type 4 a new message, 5 / 6 later (deferred), 7 the message
     *  changed, 9 a form (data: modal()) */
    respond: (it, type, data) => call('POST', `/interactions/${it.id}/${it.token}/callback`, { type, ...(data ? { data } : {}) }),
    /** the message a press was on, changed after a deferred answer (type 6): text, buttons, a new picture */
    editReply: (it, { content, components, files = [] } = {}) => call('PATCH', `/webhooks/${appId ?? it.application_id}/${it.token}/messages/@original`, { ...(content !== undefined ? { content: String(content).slice(0, LIMIT) } : {}), ...(components ? { components } : {}) }, files),
    /** the gateway: onEvent(type, data) for every event of the person's DM (messages from them, their presses and forms);
     *  connected again by itself when Discord closes it, until close() */
    async listen(onEvent) {
      if (!WebSocketImpl) throw new Error('WebSocket がありません（Node 22 以上で）');
      const { url } = await call('GET', '/gateway/bot');
      let seq = null, everReady = false, fails = 0;
      // (the first connection: listen() returns at its READY, or throws when it closes before — a refused token, a
      //  gateway that does not answer; later ones are made again by themselves, waiting longer after each failure)
      const open = () => new Promise((resolve, reject) => {
        ws = new WebSocketImpl(`${url}/?v=10&encoding=json`);
        let acked = true, ready = false;
        const sendOp = (op, d) => { try { ws.send(JSON.stringify({ op, d })); } catch { /* closing */ } };
        const beat = () => { if (!acked) { log('Discord: 心拍の返事がありません: つなぎ直します'); try { ws.close(4000); } catch { /* closed */ } return; } acked = false; sendOp(1, seq); };
        ws.onmessage = (ev) => {
          let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
          if (m.s !== null && m.s !== undefined) seq = m.s;
          if (m.op === 10) {
            // (the first heartbeat after a random part of the interval, as Discord asks; then every interval)
            const iv = Number(m.d?.heartbeat_interval) || 41_250;
            clearInterval(hb); clearTimeout(first);
            first = setTimeout(() => { if (closed) return; beat(); hb = setInterval(beat, iv); }, Math.floor(iv * Math.random()));
            sendOp(2, { token, intents: INTENTS, properties: { os: 'linux', browser: 'bds-lab', device: 'bds-lab' } });
          } else if (m.op === 11) acked = true;
          else if (m.op === 1) sendOp(1, seq);
          else if (m.op === 7 || m.op === 9) { try { ws.close(4000); } catch { /* closed */ } }
          else if (m.op === 0) {
            if (m.t === 'READY') { appId = m.d?.application?.id ?? appId; ready = everReady = true; fails = 0; resolve(); return; }
            if (m.t === 'MESSAGE_CREATE' && !fromPerson(m.d, userId)) return;
            if (m.t === 'INTERACTION_CREATE' && senderOf(m.d) !== String(userId)) return;
            if (m.t === 'MESSAGE_CREATE' || m.t === 'INTERACTION_CREATE') Promise.resolve(onEvent(m.t, m.d)).catch((e) => log(`Discord: ${e.message}`));
          }
        };
        ws.onclose = (ev) => {
          clearInterval(hb); clearTimeout(first); hb = null;
          const fatal = FATAL[ev?.code];
          if (fatal) { closed = true; const e = new Error(`Discord の gateway が閉じました（${ev.code}）: ${fatal}`); log(e.message); if (!everReady) reject(e); else resolve(); return; }
          if (!everReady && !ready) { reject(new Error(`Discord の gateway につながりません（${ev?.code ?? '?'}）`)); return; }
          if (!closed) {
            const wait = Math.min(60_000, 3000 * 2 ** Math.min(fails++, 5));
            log(`Discord: 切れました（${ev?.code ?? '?'}）: ${Math.round(wait / 1000)} 秒後につなぎ直します`);
            setTimeout(() => { if (!closed) open().catch((e) => log(`Discord: ${e.message}`)); }, wait);
          }
          resolve();
        };
        ws.onerror = () => { /* onclose follows */ };
      });
      await open();
      return self;
    },
    close() { closed = true; clearInterval(hb); clearTimeout(first); try { ws?.close(1000); } catch { /* closed */ } },
    get appId() { return appId; },
  };
  return self;
}
