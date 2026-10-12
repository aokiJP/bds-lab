// connect (the 「連携」 tab): one card for each service the lab can be tied to (lib/connect.mjs) — how it stands (✅ tied, ⚠️
// not yet, ❔ not checked), the steps with the official page to open (the person logs in, agrees and makes the token there:
// the panel presses none of it), fields whose shape is checked before anything is sent, and 「封じて登録して確かめる」:
// each value sealed in this browser into the lab's secrets, connect.yml started and waited for, its notice read and shown with
// the next step (Discord: the invite link). 「全部つなぐ」 opens the services not yet tied one after another. A secret field is
// a password field, not offered to the browser, and emptied once the value is sent; no value is kept, shown or recorded.
import { h, toast, link, failView } from './dom.mjs';
import * as C from '../lib/connect.mjs';
import * as P from '../lib/policy.mjs';

const ICON = { ok: '✅ ', bad: '⚠️ ', missing: '⚠️ ', unchecked: '❔ ' };
const STATE_WORDS = { ok: 'つながっている', bad: 'つながらなかった', missing: '未（秘密がまだ入っていません）', unchecked: '入っているが、確かめていない' };
const NEEDS = ['secrets.put', 'dispatch'];
const roleName = (r) => (typeof r === 'string' ? r : r?.name ?? (r?.names?.length ? `${r.names.join(' か ')}（チームが読めません）` : 'なし'));
/** why this person may not connect (words), null when they may: GitHub's write role at least, and the policy's role allows
 *  putting secrets and starting a workflow */
function notAllowed(ctx) {
  const policy = ctx.policy ?? P.DEFAULT_POLICY, role = ctx.role ?? ctx.lab?.role;
  if (P.GITHUB_ROLES.indexOf(ctx.lab?.role) < P.GITHUB_ROLES.indexOf('write')) return 'このラボに書ける人（GitHub の write 以上）が連携できます';
  const no = NEEDS.filter((a) => !P.can(policy, role, a));
  return no.length ? `役割「${roleName(role)}」には、ポリシー（${P.POLICY_FILE} の roles）が「${no.map((a) => P.ACTION_WORDS[a] ?? a).join('・')}」を許していません` : null;
}

/** the 「連携」 tab. ctx: the same as setupTab's { api, lab: { slug, secrets, role }, me, policy, role, reload, record(action, detail)? } */
export function connectTab(body, ctx) {
  const checked = {}, cards = new Map(), say = h('div', { class: 'muted', role: 'status' });
  let queue = null;
  const secrets = () => ctx.lab.secrets ?? [];
  const refresh = () => { for (const s of C.status(secrets(), checked)) cards.get(s.key)?.paint(s); };
  // 「全部つなぐ」: the next service not yet tied, its card opened and scrolled to
  const advance = () => {
    const left = queue?.filter((k) => C.status(secrets(), checked).find((s) => s.key === k)?.state !== 'ok') ?? [];
    if (!queue || !left.length) { queue = null; say.replaceChildren(left.length ? '' : '✅ つなぐものは、すべてつながりました'); return; }
    const k = left[0], c = cards.get(k);
    c.details.open = true; c.details.scrollIntoView?.();
    say.replaceChildren(`つぎは ${C.serviceOf(k).name}: 手順の通りに画面を開いて、値を貼ってください（残り ${left.length}）`);
  };
  const no = notAllowed(ctx);
  const all = h('button', { class: 'primary', onclick: () => {
    if (no) return toast(no, true);
    queue = C.status(secrets(), checked).filter((s) => s.state !== 'ok').map((s) => s.key);
    advance();
  } }, '全部つなぐ');
  for (const svc of C.SERVICES) cards.set(svc.key, card(ctx, svc, { checked, no, secrets, refresh, done: (r) => { if (!queue) return; if (r.ok) return advance(); queue = null; say.replaceChildren(`${svc.name} がつながらないので止めました: 直してから、もう一度「全部つなぐ」`); }, skip: () => { if (queue) { queue = queue.filter((k) => k !== svc.key); advance(); } } }));
  put(body, h('div', { class: 'card' }, h('h2', {}, `連携（${ctx.lab.slug}）`),
    h('p', { class: 'muted' }, 'サービスごとに、公式の画面を開いて値を写し、ここに貼ります。値はこのブラウザで封じてから GitHub の秘密に入り、GitHub Actions で本物かを確かめます（値は残しません・表示しません）。ログインや同意の確認は、あなたが公式の画面で押します。'),
    no ? h('p', { class: 'bad', role: 'alert' }, `（${no}）`) : null, h('div', { class: 'row' }, all), say),
  [...cards.values()].map((c) => c.el));
  refresh();
  return Promise.resolve([...cards.keys()]);
}

// (the children flattened and the empty ones dropped: replaceChildren/append alone would write a null or an array as text)
function put(el, ...kids) {
  const fresh = kids.at(-1) === true; if (fresh) kids.pop();
  const xs = kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);
  if (fresh) el.replaceChildren(...xs); else el.append(...xs);
}

function card(ctx, svc, k) {
  const st = h('div', {}), steps = h('ol', {}, svc.steps.map((s) => h('li', {}, s.say, s.link ? [' ', link(C.safeLink(s.link), '公式の画面を開く')] : null)));
  const fields = svc.fields.map((f) => [f, h('input', { type: f.secret ? 'password' : 'text', autocomplete: 'off', 'aria-label': f.label, placeholder: f.optional ? '（なくてもよい）' : null })]);
  const out = h('div', { class: 'muted', role: 'status' }), details = h('details', {}, h('summary', {}, 'つなぐ'));
  const btn = h('button', { class: 'primary', onclick: () => go() }, '封じて登録して確かめる');
  const skip = h('button', { onclick: () => k.skip() }, 'とばして次へ（「全部つなぐ」の途中）');
  const go = async () => {
    if (k.no) return toast(k.no, true);
    const values = Object.fromEntries(fields.map(([f, el]) => [f.name, el.value.trim()]));
    const bad = C.problems(svc, values, k.secrets());
    if (Object.keys(bad).length) { out.replaceChildren(h('div', { class: 'bad', role: 'alert' }, Object.values(bad).join(' / '))); return; }
    btn.disabled = true; out.replaceChildren('封じて登録しています…');
    try {
      for (const f of svc.fields) {
        if (!values[f.name]) continue;
        await ctx.api.putSecret(ctx.lab.slug, f.name, values[f.name]);
        ctx.lab.secrets = [...new Set([...k.secrets(), f.name])];
        // (sent: the value leaves the page at once, not after the check)
        fields.find(([x]) => x.name === f.name)[1].value = '';
      }
      for (const [, el] of fields) el.value = '';
      k.refresh();
      const r = await C.runCheck(ctx.api, ctx.lab.slug, svc.key, { ref: ctx.lab.repo?.default_branch ?? 'main', me: ctx.me?.login, onStep: (t) => out.replaceChildren(t) });
      k.checked[svc.key] = r;
      ctx.record?.(`connect.${svc.key}`, { ok: r.ok });
      put(out, h('div', { class: r.ok ? 'ok' : 'bad', role: r.ok ? 'status' : 'alert' }, (r.ok ? '✅ ' : '⚠️ ') + r.text),
        r.next ? h('div', {}, r.next.say, r.next.url ? [' ', link(r.next.url, '開く')] : null) : null, true);
      k.refresh(); k.done(r);
    } catch (e) {
      for (const [, el] of fields) el.value = '';
      put(out, failView(e, () => go()), true);
      k.refresh(); k.done({ ok: false });
    } finally { btn.disabled = false; }
  };
  put(details, h('p', { class: 'muted' }, svc.why), steps,
    k.no ? h('div', { class: 'muted' }, `（${k.no}）`) : [fields.map(([f, el]) => [h('label', {}, f.label), el]), h('div', { class: 'row' }, btn, skip)], out);
  const el = h('div', { class: 'card', 'data-service': svc.key }, h('h3', {}, svc.name), st, details);
  const paint = (s) => {
    const n = s.state === 'missing' && s.missing.length ? ` — ${s.missing.join('・')}` : '';
    put(st, h('div', {}, ICON[s.state], STATE_WORDS[s.state], n), s.result && !s.result.ok ? h('div', { class: 'bad' }, s.result.text) : null, true);
  };
  return { el, details, paint };
}
