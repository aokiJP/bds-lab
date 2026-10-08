// the game played as a person plays it, and Discord as the phone's way in — without a device or a network:
// the controller's new words (lab-pad.c --dry: the input events it would give the kernel), the game verbs (lib/play.mjs)
// in app.txt and in live, the Discord client against a fake gateway and REST, the controller of buttons, and the form that
// sets the repository's secrets (lib/secretform.mjs: values hidden first, never said, only the person's form taken).
// node tests/play-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const P = await imp('app/lib/play.mjs'), S = await imp('app/lib/scenario.mjs'), LV = await imp('app/lib/live.mjs'), DC = await imp('app/lib/discord.mjs'), SF = await imp('app/lib/secretform.mjs'), D = await imp('app/lib/android.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-offline-'));

await t('lab-pad --dry: sticks and triggers set and left, a button held down and let go, center lets everything go; bad words said, not done', () => {
  if (!(['x64', 'arm64'].includes(process.arch) && process.platform === 'linux')) { console.log('     (not Linux x86_64 / arm64: not built here)'); return; }
  const bin = D.padBinary(path.join(tmp, 'lab'));
  if (typeof bin !== 'string') { console.log(`     (${bin.error}: not run)`); return; }
  const out = path.join(tmp, 'ev.bin');
  const r = spawnSync(bin, ['--dry', out, 'LY=-100', '+A', 'wait5', '-A', 'LY=0', 'RT=100', 'RT=0', 'LT=50', 'RX=-25', '+UP', '-UP', 'center', 'LX=200', 'LT=-1', 'bogus', '+Z'], { encoding: 'utf8' });
  ok(r.status === 0 && /out of range LX=200/.test(r.stdout) && /out of range LT=-1/.test(r.stdout) && /unknown bogus/.test(r.stdout) && /unknown \+Z/.test(r.stdout), r.stdout);
  const b = fs.readFileSync(out), ev = [];
  for (let o = 0; o + 24 <= b.length; o += 24) { const type = b.readUInt16LE(o + 16), code = b.readUInt16LE(o + 18), value = b.readInt32LE(o + 20); if (type) ev.push(`${type}:${code.toString(16)}:${value}`); }
  // (EV_ABS 3: ABS_Y 1, ABS_RZ 5, ABS_Z 2, ABS_RX 3, ABS_HAT0Y 0x11; EV_KEY 1: BTN_A 0x130)
  eq(ev.slice(0, 9), ['3:1:-32767', '1:130:1', '1:130:0', '3:1:0', '3:5:1023', '3:5:0', '3:2:511', '3:3:-8191', '3:11:-1'], 'the words in order');
  eq(ev[9], '3:11:0', 'the D-pad up again');
  const center = ev.slice(10);
  ok(center.length === 8 + 11 && center.every((e) => /:0$/.test(e)) && center.includes('1:13e:0') && center.includes('3:10:0'), 'center: 6 axes, 2 hats, 11 buttons at rest: ' + center.join(' '));
  const u = spawnSync(bin, [], { encoding: 'utf8' });
  ok(u.status === 2 && /usage: lab-pad <fifo>/.test(u.stdout), 'still says how to use it: ' + u.stdout);
});

await t('the controller\'s words: which set a state, how long a batch takes (pure)', () => {
  for (const w of ['+A', '-RB', '+UP', 'LX=-100', 'RY=55', 'LT=100', 'RT=0', 'center']) ok(D.PAD_SET.test(w), w);
  for (const w of ['A', 'wait500', 'hold800', 'LT=-5', 'LX=1000', '+Q', 'CENTER', 'LZ=1']) ok(!D.PAD_SET.test(w), w);
  eq(D.padBatchMs(['LY=-100', 'wait2000', 'LY=0']), 2000);
  eq(D.padBatchMs(['A', 'DOWN', 'A']), 2100, 'a press is held 500 ms and let go 200 ms');
  eq(D.padBatchMs(['hold1000', 'A', 'wait500', 'center']), 1700);
});

await t('game verbs: each one\'s controller words, keys or chat, and how it is written wrong (pure)', () => {
  const g = (l) => P.gameLine(l);
  eq(g('walk forward 2').pad, 'LY=-100 wait2000 LY=0'); eq(g('walk back').pad, 'LY=100 wait1000 LY=0'); eq(g('walk 左 0.5').pad, 'LX=-100 wait500 LX=0');
  eq(g('walk forward right 1.5').pad, 'LY=-100 LX=100 wait1500 LY=0 LX=0', 'two directions: diagonal');
  ok(g('walk forward back').error && g('walk').error && g('walk 2').error && g('walk forward 1 2').error && g('walk up').error, 'wrong walks');
  eq(g('walk forward 0.1').pad, 'LY=-100 wait300 LY=0', 'never shorter than a frame of the CI device can see');
  eq(g('walk forward 999').pad, 'LY=-100 wait60000 LY=0', 'at most a minute');
  eq(g('sprint').pad, 'LY=-100 wait150 +L3 wait300 -L3 wait1550 LY=0');
  eq(g('jump').pad, 'A'); eq(g('jump forward 2').pad, 'LY=-100 +A wait2000 -A LY=0'); ok(g('jump up').error, 'jump up');
  eq(g('look right').pad, 'RX=100 wait300 RX=0'); eq(g('look up 600 50').pad, 'RY=-50 wait600 RY=0'); eq(g('look 下 200').pad, 'RY=100 wait200 RY=0');
  ok(g('look').error && g('look forward').error && g('look left 0').error && g('look left 100 0').error, 'wrong looks');
  eq(g('sneak').pad, 'R3'); eq(g('sneak 2').pad, 'R3 wait2000 R3');
  eq(g('attack').pad, 'RT=100 wait600 RT=0'); eq(g('mine').pad, 'RT=100 wait2000 RT=0'); eq(g('use 1').pad, 'LT=100 wait1000 LT=0'); eq(g('place').pad, 'LT=100 wait600 LT=0');
  eq(g('slot 3').keys, ['3']); eq(g('slot next').pad, 'RB'); eq(g('slot prev').pad, 'LB'); ok(g('slot 0').error && g('slot 10').error && g('slot').error, 'wrong slots');
  eq(g('inventory').pad, 'Y'); eq(g('drop').keys, ['Q']); eq(g('drop 3').keys, ['Q', 'Q', 'Q']); ok(g('drop 0').error, 'drop 0');
  eq(g('cmd give @s diamond 3').chat, '/give @s diamond 3'); eq(g('cmd /time set day').chat, '/time set day'); ok(g('cmd').error, 'cmd alone');
  eq(g('perspective').keys, ['F5']); eq(g('pause').pad, 'START'); eq(g('release').pad, 'center');
  eq(g('stick L 0 -100 1000').pad, 'LX=0 LY=-100 wait1000 LX=0 LY=0'); ok(g('stick L 0 -101').error && g('stick X 0 0').error && g('stick R 0.5 0').error, 'wrong sticks');
  eq(g('screen'), null, 'not a game verb');
  for (const v of P.GAME_VERBS) ok(P.GAME_HELP.some((l) => l.includes(v)), `${v} in the help`);
});

await t('app.txt: the game verbs are steps (written wrong: the line says how), run through the controller and the keyboard', async () => {
  const r = S.parseScenario('walk forward 2\nlook right 500\ncmd give @s diamond 3\nslot 9\nattack\nwalk sideways\nmine 2 3\nrelease');
  eq(r.steps.map((s) => s.verb), ['walk', 'look', 'cmd', 'slot', 'attack', 'release']);
  eq(r.steps[2].args, ['give @s diamond 3'], 'cmd keeps its spaces');
  ok(r.errors.length === 2 && /^6: 書き方: walk/.test(r.errors[0]) && /^7: 書き方: mine/.test(r.errors[1]), r.errors.join('\n'));
  // (a stand-in device: what was pressed, in order)
  const calls = [], adb = { padReady: true, pad: (w, o) => { calls.push(`pad ${w}${o?.wait ? ' (wait)' : ''}`); }, shell: (a) => { calls.push(a.join(' ')); return { status: 0, stdout: '', stderr: '' }; }, screencap: () => Buffer.from([137, 80, 78, 71]) };
  process.env.APP_TIME_SCALE = '0';
  const run = await S.runScenario(r.steps, { adb, runDir: path.join(tmp, 'run1'), decode: () => ({ w: 1, h: 1, data: Buffer.alloc(4) }), pkg: 'x', logcatFile: path.join(tmp, 'none'), server: { logFile: path.join(tmp, 'none') } });
  ok(run.ok, JSON.stringify(run.results));
  eq(calls, ['pad LY=-100 wait2000 LY=0 (wait)', 'pad RX=100 wait500 RX=0 (wait)', 'input keyevent 48', `input text ${(await imp('app/lib/client.mjs')).inputText('/give @s diamond 3')}`, 'input keyevent 66', 'input keyevent 16', 'pad RT=100 wait600 RT=0 (wait)', 'pad center (wait)']);
  // no controller (a phone without root): a stick cannot be moved — the step says so; a plain button still goes
  const bare = { padReady: false, pad: (w) => calls.push(`pad ${w}`), shell: () => ({ status: 0, stdout: '', stderr: '' }), screencap: () => Buffer.from([137, 80, 78, 71]) };
  const r2 = await S.runScenario(S.parseScenario('jump\nwalk forward 1').steps, { adb: bare, runDir: path.join(tmp, 'run2'), decode: () => ({ w: 1, h: 1, data: Buffer.alloc(4) }), pkg: 'x', logcatFile: path.join(tmp, 'none'), server: { logFile: path.join(tmp, 'none') } });
  ok(!r2.ok && r2.results[0].ok && /コントローラー（lab-pad/.test(r2.results[1].note), JSON.stringify(r2.results));
  delete process.env.APP_TIME_SCALE;
});

await t('live: game verbs, app.txt steps and live\'s own verbs told apart; the help says them all (pure)', () => {
  const k = (l) => LV.liveKind(l);
  eq(['walk forward 2', 'mine 3', 'cmd /time set day'].map(k), ['game', 'game', 'game']);
  eq(['tap text (?i)play', 'chat hi', 'until text Inventory 9000', 'press W 2000', 'screen off', 'step stop', 'perf', 'do say hi'].map(k), Array(8).fill('step'));
  eq(['tap 0.5 0.5', 'screen', 'key E', 'pad A', 'stop', 'pull main', 'run'].map(k), Array(7).fill('live'));
  eq(k('steps <<\nwalk forward 1\nEOF'), 'steps');
  for (const v of ['walk', 'mine', 'chat', 'press', 'mouse', 'step', 'steps']) ok(!LV.parseCommand(`${v} x`).error, v);
  ok(LV.LONG.has('steps'), 'steps waited for longer');
  ok(/walk <forward/.test(LV.HELP) && /steps <</.test(LV.HELP) && /tap text/.test(LV.HELP), 'help');
  eq(LV.splitCommands('walk forward 2\n# note\n\nsteps <<\nshot a\nEOF\nscreen'), ['walk forward 2', 'steps <<\nshot a', 'screen']);
  // (a phone's keyboard capitalizes the first word: a known verb is taken in lower case, anything else stays as it is)
  eq(['Walk forward 2', 'SCREEN', 'Chat Hello World', 'Hello'].map(LV.phoneLine), ['walk forward 2', 'screen', 'chat Hello World', 'Hello']);
});

await t('Discord: the controller of buttons (5 rows of 5), each press a live command or a form; forms → commands (pure)', () => {
  const rows = LV.panel();
  ok(rows.length === 5 && rows.every((r) => r.type === 1 && r.components.length === 5), 'five rows of five');
  const all = rows.flatMap((r) => r.components);
  ok(all.every((b) => b.type === 2 && b.custom_id.length <= 100 && b.label.length <= 80 && !b.disabled), 'buttons within Discord\'s limits');
  ok(LV.panel(true).flatMap((r) => r.components).every((b) => b.disabled), 'greyed at the end');
  for (const b of all) {
    const c = LV.panelCommand(b.custom_id);
    ok(c && (LV.FORMS[c] || !LV.parseCommand(c).error), `${b.label}: ${c}`);
    if (LV.liveKind(c) === 'game') ok(!P.gameLine(c).error, `${c} is a good game step`);
  }
  eq(LV.panelCommand('other:x'), null);
  ok(LV.FORMS['#chat'].components[0].components[0].type === 4 && LV.FORMS['#cmd'].components[0].components[0].style === 2, 'the forms: a line, a paragraph');
  eq(LV.formCommands('lab-form:chat', { text: ' hello ' }), ['chat hello']); eq(LV.formCommands('lab-form:chat', { text: ' ' }), []);
  eq(LV.formCommands('lab-form:cmd', { cmds: 'walk forward 2\n# x\nscreen' }), ['walk forward 2', 'screen']); eq(LV.formCommands('else', {}), null);
});

await t('Discord: who counts (the person, in the DM — never a server\'s message, a bot, someone else); the config; a form\'s values; text kept within a message (pure)', () => {
  const me = '123456789012345678';
  ok(DC.fromPerson({ author: { id: me }, content: 'x' }, me), 'the person in the DM');
  ok(!DC.fromPerson({ author: { id: me }, guild_id: '9', content: 'x' }, me), 'a server');
  ok(!DC.fromPerson({ author: { id: '999999999999999999' } }, me) && !DC.fromPerson({ author: { id: me, bot: true } }, me), 'someone else, a bot');
  eq(DC.senderOf({ user: { id: me } }), me); eq(DC.senderOf({ member: { user: { id: me } }, guild_id: '1' }), null);
  eq(DC.config({ DISCORD_BOT_TOKEN: 'x', DISCORD_USER_ID: me }), { token: 'x', userId: me });
  eq(DC.config({ DISCORD_BOT_TOKEN: '', DISCORD_USER_ID: 'me' }).missing, ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID']);
  const m = DC.modal('f', 'T'.repeat(60), [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', long: true, required: false }]);
  ok(m.title.length === 45 && m.components.length === 2 && m.components[1].components[0].style === 2 && m.components[1].components[0].required === false, JSON.stringify(m));
  eq(DC.modalValues({ data: { components: [{ components: [{ custom_id: 'a', value: '1' }] }, { component: { custom_id: 'b', value: '2' } }] } }), { a: '1', b: '2' });
  const cb = DC.codeBlock('x'.repeat(5000) + 'END```', 500);
  ok(cb.length <= 520 && cb.includes("END'''") && cb.startsWith('```\n…（前を省略）'), cb.slice(0, 40));
});

await t('Discord REST: JSON or a picture (multipart: payload_json + files[n]), a rate limit waited out, an error said without the token', async () => {
  const seen = [];
  let limited = 1;
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers.authorization, body: init.body });
    if (url.endsWith('/limited') && limited-- > 0) return { ok: false, status: 429, json: async () => ({ retry_after: 0.01 }) };
    if (url.endsWith('/bad')) return { ok: false, status: 403, text: async () => 'Missing Access' };
    return { ok: true, status: 200, json: async () => ({ id: 'm1' }) };
  };
  const call = DC.rest({ token: 'BOT.TOKEN', base: 'https://d.test/api', fetchImpl, sleep: async () => {} });
  eq(await call('POST', '/x', { content: 'hi' }), { id: 'm1' });
  ok(seen[0].auth === 'Bot BOT.TOKEN' && JSON.parse(seen[0].body).content === 'hi', 'JSON with the bot\'s token');
  await call('POST', '/y', { content: 'pic' }, [{ name: 'screen.png', type: 'image/png', data: Buffer.from('PNGDATA') }]);
  const fd = seen[1].body;
  ok(fd instanceof FormData && JSON.parse(fd.get('payload_json')).attachments[0].filename === 'screen.png' && (await fd.get('files[0]').text()) === 'PNGDATA', 'multipart');
  eq(await call('GET', '/limited'), { id: 'm1' }); ok(seen.filter((s) => s.url.endsWith('/limited')).length === 2, 'tried again after the 429');
  let err = ''; try { await call('GET', '/bad'); } catch (e) { err = e.message; }
  ok(/Discord GET \/bad: 403 Missing Access/.test(err) && !err.includes('BOT.TOKEN'), err);
});

// a fake gateway: hello, then READY after the identify, then what the test sends
class FakeWS {
  static last = null;
  constructor(url) { FakeWS.last = this; this.url = url; this.sent = []; setTimeout(() => this.onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }) }), 1); }
  send(x) { const m = JSON.parse(x); this.sent.push(m); if (m.op === 2) setTimeout(() => this.emit('READY', { application: { id: 'app1' }, user: { id: 'bot1' } }), 1); }
  emit(t, d) { this.onmessage?.({ data: JSON.stringify({ op: 0, s: (this.s = (this.s ?? 0) + 1), t, d }) }); }
  close(code) { this.closed = code; setTimeout(() => this.onclose?.({ code }), 1); }
}
const fakeRest = (log) => async (url, init) => {
  log.push({ url: url.replace('https://d.test/api', ''), method: init.method, body: init.body instanceof FormData ? JSON.parse(init.body.get('payload_json')) : init.body ? JSON.parse(init.body) : null, files: init.body instanceof FormData ? [...init.body.keys()].filter((k) => k.startsWith('files')) : [] });
  if (url.endsWith('/gateway/bot')) return { ok: true, status: 200, json: async () => ({ url: 'wss://gateway.test' }) };
  if (url.endsWith('/users/@me/channels')) return { ok: true, status: 200, json: async () => ({ id: 'dm1' }) };
  return { ok: true, status: url.includes('/callback') ? 204 : 200, json: async () => ({ id: `msg${log.length}` }) };
};
const tick = () => new Promise((r) => setTimeout(r, 20));

await t('Discord gateway + live: identify with DIRECT_MESSAGES only; the person\'s message → commands; a press answered at once and queued; a form button → the form; strangers and servers unseen', async () => {
  process.env.DISCORD_API_URL = 'https://d.test/api';
  const log = [], jobs = [], me = '123456789012345678';
  const b = DC.bot({ token: 'tok', userId: me, fetchImpl: fakeRest(log), WebSocketImpl: FakeWS });
  await LV.discordJobs(b, (j) => jobs.push(j));
  const ws = FakeWS.last;
  ok(ws.url === 'wss://gateway.test/?v=10&encoding=json' && ws.sent[0].op === 2 && ws.sent[0].d.token === 'tok' && ws.sent[0].d.intents === DC.INTENTS && DC.INTENTS === 4096, JSON.stringify(ws.sent[0]));
  ws.emit('MESSAGE_CREATE', { author: { id: '999999999999999999' }, content: 'kill' });
  ws.emit('MESSAGE_CREATE', { author: { id: me }, guild_id: '5', content: 'kill' });
  ws.emit('MESSAGE_CREATE', { author: { id: me }, content: 'Walk forward 2\nscreen' });
  ws.emit('INTERACTION_CREATE', { id: 'i1', token: 't1', application_id: 'app1', type: 3, user: { id: me }, data: { custom_id: 'lab:walk forward 1' } });
  ws.emit('INTERACTION_CREATE', { id: 'i2', token: 't2', application_id: 'app1', type: 3, user: { id: me }, data: { custom_id: 'lab:#chat' } });
  ws.emit('INTERACTION_CREATE', { id: 'i3', token: 't3', application_id: 'app1', type: 5, user: { id: me }, data: { custom_id: 'lab-form:chat', components: [{ components: [{ custom_id: 'text', value: '/time set day' }] }] } });
  ws.emit('INTERACTION_CREATE', { id: 'i4', token: 't4', type: 3, user: { id: '999999999999999999' }, data: { custom_id: 'lab:stop' } });
  await tick();
  eq(jobs.map((j) => j.cmds), [['walk forward 2', 'screen'], ['walk forward 1'], ['chat /time set day']]);
  eq(jobs[1].it, { id: 'i1', token: 't1', application_id: 'app1' });
  const cb = log.filter((x) => /\/callback$/.test(x.url)).map((x) => [x.url, x.body.type]);
  eq(cb, [['/interactions/i1/t1/callback', 6], ['/interactions/i2/t2/callback', 9], ['/interactions/i3/t3/callback', 6]]);
  ok(log.find((x) => x.url === '/interactions/i2/t2/callback').body.data.custom_id === 'lab-form:chat', 'the chat form');
  // the answer: the message the press was on changed (a new picture), a new message for a typed one
  await b.editReply(jobs[1].it, { content: 'done', components: LV.panel(), files: [{ name: 'screen.png', data: Buffer.from('P') }] });
  await b.send({ content: 'x'.repeat(3000) });
  const edit = log.find((x) => x.url.startsWith('/webhooks/')), sent = log.at(-1);
  ok(edit.url === '/webhooks/app1/t1/messages/@original' && edit.method === 'PATCH' && edit.files[0] === 'files[0]' && edit.body.components.length === 5, JSON.stringify(edit));
  ok(sent.url === '/channels/dm1/messages' && sent.body.content.length === 2000 && sent.body.allowed_mentions.parse.length === 0, 'into the DM, within the limit, mentioning no one');
  // a heartbeat is answered; Discord asking to reconnect: closed and opened again; close() ends it
  ws.onmessage({ data: JSON.stringify({ op: 1 }) }); ok(ws.sent.at(-1).op === 1, 'heartbeat');
  ws.onmessage({ data: JSON.stringify({ op: 7 }) }); ok(ws.closed === 4000, 'reconnect asked');
  b.close();
  delete process.env.DISCORD_API_URL;
});

// a stand-in bot for the secrets' form: what was sent, answered and changed; the person's events as the test plays them
const formBot = (play) => {
  const st = { sent: [], responded: [], replies: [], edits: [], closed: false };
  return { st, async send(m) { st.sent.push(m); return { id: `m${st.sent.length}` }; }, async edit(id, m) { st.edits.push([id, m]); }, async respond(d, type, data) { st.responded.push([d.id, type, data]); },
    async editReply(d, m) { st.replies.push(m); }, async listen(h) { setTimeout(() => play(h), 1); return this; }, close() { st.closed = true; } };
};
await t('secrets: names checked (5 at most, GitHub\'s form, no GITHUB_), values cleaned, hidden in the log line by line (pure)', () => {
  eq(SF.secretNames('ms_email, MS_PASSWORD,MS_EMAIL'), { names: ['MS_EMAIL', 'MS_PASSWORD'] });
  ok(SF.secretNames('A,B,C,D,E,F').error && SF.secretNames('GITHUB_TOKEN').error && SF.secretNames('1ABC').error && SF.secretNames('A-B').error && SF.secretNames('').error, 'bad names');
  eq(SF.cleanValue('MS_EMAIL', '  me@example.com \n'), 'me@example.com'); eq(SF.cleanValue('MS_PASSWORD', ' pass word \n'), ' pass word ', 'a password as typed');
  eq(SF.secretLines('MS_EMAIL=me@example.com\nms_password: p=1\nOTHER=x\nnote', ['MS_EMAIL', 'MS_PASSWORD']), { MS_EMAIL: 'me@example.com', MS_PASSWORD: 'p=1' });
  eq(SF.maskLines('a%b'), ['::add-mask::a%25b']);
  ok(SF.maskLines('line one\nline two').includes('::add-mask::line one') && SF.maskLines('line one\nline two').includes('::add-mask::line two') && SF.maskLines('line one\nline two').every((l) => !l.slice(13).includes('\n')), 'every line hidden, no line break inside a command');
  const f = SF.secretForm(42, ['MS_EMAIL', 'MS_PASSWORD']);
  ok(f.custom_id === 'lab-secrets:42:form' && f.components.length === 2 && f.components.every((r) => r.components[0].required === false) && /見えます/.test(f.components[1].components[0].placeholder), JSON.stringify(f));
});
await t('secrets: the DM\'s button opens the form; what is sent is hidden first, then set; the answer names the secrets, never a value; an empty field leaves its secret', async () => {
  const order = [], EMAIL = 'player.one@example.com', PW = 'Very-Secret-pw-123';
  const b = formBot(async (h) => {
    await h('INTERACTION_CREATE', { id: 'i1', type: 3, data: { custom_id: 'lab-secrets:7:open' } });
    await h('INTERACTION_CREATE', { id: 'i2', type: 5, data: { custom_id: 'lab-secrets:7:form', components: [{ components: [{ custom_id: 'MS_EMAIL', value: ` ${EMAIL} ` }] }, { components: [{ custom_id: 'MS_PASSWORD', value: PW }] }, { components: [{ custom_id: 'APP_X', value: '' }] }] } });
  });
  const r = await SF.askSecrets({ b, names: ['MS_EMAIL', 'MS_PASSWORD', 'APP_X'], run: 7, repo: 'o/r', minutes: 1, mask: (v) => order.push(['mask', v]), setSecret: (n, v) => { order.push(['set', n, v]); return { ok: true }; } });
  eq([r.how, r.set, r.kept, r.failed], ['form', ['MS_EMAIL', 'MS_PASSWORD'], ['APP_X'], []]);
  eq(order.filter((x) => x[0] === 'set'), [['set', 'MS_EMAIL', EMAIL], ['set', 'MS_PASSWORD', PW]], 'set as typed (the e-mail trimmed)');
  ok(order.findIndex((x) => x[0] === 'mask' && x[1] === PW) < order.findIndex((x) => x[0] === 'set'), 'hidden before anything is done with it');
  eq(b.st.responded.map((x) => [x[0], x[1]]), [['i1', 9], ['i2', 6]]);
  ok(b.st.responded[0][2].custom_id === 'lab-secrets:7:form', 'the form');
  const said = JSON.stringify([b.st.sent, b.st.replies, b.st.edits]);
  ok(!said.includes(PW) && !said.includes(EMAIL) && /登録しました: MS_EMAIL・MS_PASSWORD/.test(said) && /そのまま: APP_X/.test(said) && b.st.closed, said);
  ok(b.st.sent[0].components[0].components.map((x) => x.custom_id).join() === 'lab-secrets:7:open,lab-secrets:7:cancel', 'the DM: open and cancel');
});
await t('secrets: a message NAME=value works too (asked to delete it); a failure said without its value; cancel and time-out set nothing', async () => {
  const PW = 'Another-Secret-456';
  const b1 = formBot(async (h) => { await h('MESSAGE_CREATE', { content: 'hello' }); await h('MESSAGE_CREATE', { content: `MS_PASSWORD=${PW}` }); await h('MESSAGE_CREATE', { content: 'MS_PASSWORD=again' }); });
  const r1 = await SF.askSecrets({ b: b1, names: ['MS_EMAIL', 'MS_PASSWORD'], run: 8, repo: 'o/r', minutes: 1, setSecret: (n, v) => ({ ok: false, error: `could not set ${v} for ${n}` }) });
  eq([r1.how, r1.set, r1.failed.map((f) => f.name)], ['message', [], ['MS_PASSWORD']]);
  ok(!r1.failed[0].error.includes(PW) && /<値>/.test(r1.failed[0].error), r1.failed[0].error);
  const said = b1.st.sent.map((m) => m.content).join('\n');
  ok(/名前=値.*の行がありません/.test(said) && /消してください/.test(said) && !said.includes(PW) && b1.st.sent.length === 3, said);
  const b2 = formBot(async (h) => { await h('INTERACTION_CREATE', { id: 'c', type: 3, data: { custom_id: 'lab-secrets:9:cancel' } }); });
  const r2 = await SF.askSecrets({ b: b2, names: ['MS_EMAIL'], run: 9, repo: 'o/r', setSecret: () => { throw new Error('not to be called'); } });
  ok(r2.how === 'cancel' && b2.st.responded[0][1] === 7 && b2.st.responded[0][2].components.length === 0, JSON.stringify(b2.st.responded));
  let fire = null;
  const b3 = formBot(async () => { fire(); });
  const r3 = await SF.askSecrets({ b: b3, names: ['MS_EMAIL'], run: 10, repo: 'o/r', minutes: 2, setSecret: () => { throw new Error('not to be called'); }, timers: { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} } });
  ok(r3.how === 'timeout' && /締め切りました（2 分）/.test(b3.st.edits[0][1].content) && b3.st.closed, JSON.stringify(b3.st.edits));
  // another run's form or a stranger's button: not this one's
  const b4 = formBot(async (h) => { await h('INTERACTION_CREATE', { id: 'x', type: 5, data: { custom_id: 'lab-secrets:1:form', components: [] } }); fire(); });
  const r4 = await SF.askSecrets({ b: b4, names: ['MS_EMAIL'], run: 11, repo: 'o/r', setSecret: () => { throw new Error('not to be called'); }, timers: { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} } });
  ok(r4.how === 'timeout' && !b4.st.responded.length, 'another run\'s form is not taken');
});
await t('app secrets ask: without the Discord secrets it says which and where, and asks nobody', () => {
  const env = { ...process.env, DISCORD_BOT_TOKEN: '', DISCORD_USER_ID: '', GITHUB_REPOSITORY: 'o/r' };
  delete env.GITHUB_ACTIONS;
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'secrets', 'ask', '--names', 'MS_EMAIL'], { cwd: TOP, encoding: 'utf8', env, timeout: 60_000 });
  ok(r.status === 1 && /DISCORD_BOT_TOKEN・DISCORD_USER_ID がありません/.test(r.stdout + r.stderr), r.stdout + r.stderr);
  const bad = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'secrets', 'ask', '--names', 'GITHUB_TOKEN'], { cwd: TOP, encoding: 'utf8', env, timeout: 60_000 });
  ok(bad.status === 1 && /秘密の名前にできません: GITHUB_TOKEN/.test(bad.stdout + bad.stderr), bad.stdout + bad.stderr);
});
await t('secrets.yml: by hand only, read-only token, actions pinned to commits, inputs and secrets only through env', () => {
  const y = fs.readFileSync(path.join(TOP, '.github', 'workflows', 'secrets.yml'), 'utf8');
  ok(/^on:\n {2}workflow_dispatch:/m.test(y) && !/^\s+(push|pull_request|pull_request_target|schedule|issue_comment):/m.test(y), 'by hand only');
  ok(/^permissions: \{ contents: read \}$/m.test(y), 'contents: read');
  ok([...y.matchAll(/uses: (\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])), 'pinned');
  const run = y.split('\n').filter((l) => /^\s+run:/.test(l)).join('\n');
  ok(run && !/\$\{\{/.test(run), 'no ${{ }} in a run line: ' + run);
  ok(/GH_TOKEN: \$\{\{ secrets\.LAB_SECRETS_TOKEN \}\}/.test(y) && /persist-credentials: false/.test(y), 'the token that sets secrets, no git credentials left');
  const al = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  if (al.status === 0) { const r = spawnSync('actionlint', [path.join(TOP, '.github', 'workflows', 'secrets.yml')], { encoding: 'utf8' }); ok(r.status === 0, r.stdout + r.stderr); }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
