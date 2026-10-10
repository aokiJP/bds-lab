// bulk (「まとめて登録」 on the 「秘密」 tab): a .env pasted into one box — every NAME=value in it — checked as it is typed (lib/bulk.mjs:
// only the names are ever shown, never a value) and registered one by one, each through the panel's own guarded secrets.put
// (the policy's role and confirmation, the audit log, sealing in the browser: the same as a secret typed alone), with the
// progress shown. The box is emptied when all of them are in; when one stops it, what was registered is kept in mind (this
// card only) so that pressing again goes on with the rest.
import { h, toast } from './dom.mjs';
import { parseEnv } from '../lib/bulk.mjs';

/** ctx: { guarded(action, detail, fn, done), putSecret(name, value) (sealed and sent to the lab: api.putSecret(lab, name, value)),
 *  names? (the secrets the lab has already: [names] or a Set — those are replaced, said first), gate?(action) (a button's
 *  attributes for an action the policy may not allow), reload?() (called when some were registered: the tab's list), toast?(text,
 *  bad) } */
export function bulkCard(ctx) {
  const say = ctx.toast ?? toast, have = new Set([...(ctx.names ?? [])].map(String)), gated = ctx.gate?.('secrets.put') ?? {};
  // (the box shows its text as dots where the browser can, and is kept from spell checkers and autofill)
  const area = h('textarea', { 'aria-label': '.env の中身', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', wrap: 'off', style: { webkitTextSecurity: 'disc' },
    placeholder: 'MS_EMAIL=you@example.com\nMS_PASSWORD="…"\n# 行の頭が # なら飛ばします\nexport APP_CACHE_KEY=…' });
  const peek = h('input', { type: 'checkbox', 'aria-label': '中身を見えるようにする' });
  peek.addEventListener('change', () => { area.style.webkitTextSecurity = peek.checked ? 'none' : 'disc'; });
  const found = h('div', {}), bar = h('i', {}), progress = h('div', { class: 'bar', hidden: true }, bar), status = h('p', { class: 'muted', id: 'bulkstatus', 'aria-live': 'polite' });
  const go = h('button', { class: 'primary', id: 'bulkgo', ...gated, onclick: () => run() }), clear = h('button', { id: 'bulkclear', onclick: () => { area.value = ''; done.clear(); progress.hidden = true; status.replaceChildren(); check(); } }, '欄を空にする');
  // (name → value registered by an earlier press that stopped part-way: skipped when pressed again with the same text)
  const done = new Map();
  let busy = false, now = parseEnv('');
  const check = () => {
    now = parseEnv(area.value);
    const names = now.items.map((x) => x.name), replacing = names.filter((x) => have.has(x));
    // (h leaves out what is null; replaceChildren would write it as the word)
    found.replaceChildren(h('div', {},
      now.errors.length ? h('ul', { class: 'plain bad', id: 'bulkerrors' }, now.errors.map((e) => h('li', {}, `❌ ${e}`))) : null,
      now.warnings.length ? h('ul', { class: 'plain warn', id: 'bulkwarnings' }, now.warnings.map((e) => h('li', {}, `⚠️ ${e}`))) : null,
      names.length ? h('div', {}, h('p', {}, `登録する名前（${names.length} 個${replacing.length ? `・うち ${replacing.length} 個は入れ替え` : ''}）。値はここに出しません`),
        h('ul', { class: 'plain', id: 'bulknames' }, names.map((x) => h('li', { 'data-name': x }, have.has(x) ? '🔁 ' : '🆕 ', h('strong', {}, x), have.has(x) ? h('span', { class: 'muted' }, ' 入れ替え') : null)))) : null,
      !names.length && !now.errors.length ? h('p', { class: 'muted' }, area.value.trim() ? '登録できる行がありません' : 'まだ何も貼られていません') : null));
    go.textContent = names.length ? `${names.length} 個をまとめて登録` : 'まとめて登録';
    go.disabled = busy || Boolean(gated.disabled) || !names.length || now.errors.length > 0;
  };
  // (typing again: what the last press said is no longer about this text)
  area.addEventListener('input', () => { if (!busy) { progress.hidden = true; status.replaceChildren(); } check(); });
  const run = async () => {
    if (busy) return;
    check();
    if (!now.items.length || now.errors.length) return;
    const batch = now.items, todo = batch.filter((x) => done.get(x.name) !== x.value), replacing = todo.filter((x) => have.has(x.name)).map((x) => x.name);
    if (replacing.length && !confirm(`${replacing.length} 個の秘密は入れ替わります（${replacing.slice(0, 8).join('・')}${replacing.length > 8 ? '…' : ''}）。よろしいですか`)) return;
    busy = true; area.disabled = true; go.disabled = true; clear.disabled = true; progress.hidden = false; bar.style.width = '0%';
    let ok = 0, stopped = null;
    try {
      for (const x of todo) {
        status.replaceChildren(`${ok + 1} / ${todo.length}　${x.name} を登録しています…`);
        // (undefined: not done — not allowed, not confirmed, or GitHub said no, and has been told so; null is GitHub's empty answer: done)
        const r = await ctx.guarded('secrets.put', { name: x.name }, () => ctx.putSecret(x.name, x.value));
        if (r === undefined) { stopped = x.name; break; }
        done.set(x.name, x.value); ok++;
        bar.style.width = `${Math.round((ok / todo.length) * 100)}%`;
      }
    } finally { busy = false; area.disabled = false; clear.disabled = false; }
    if (stopped === null) {
      // (all of them are in: the box and the memory of it are emptied)
      area.value = ''; done.clear();
      status.replaceChildren(`✅ ${batch.length} 個の秘密を登録しました${ok < batch.length ? `（今回送ったのは ${ok} 個・のこりは前に登録済み）` : ''}`);
      say(`${batch.length} 個の秘密を登録しました`);
    } else {
      status.replaceChildren(`⚠️ ${stopped} で止まりました（登録した ${ok} 個・のこり ${todo.length - ok} 個）。直してからもう一度押すと、のこりだけ登録します`);
      say(`${stopped} で止まりました`, true);
    }
    check();
    if (ok) ctx.reload?.();
  };
  check();
  return h('div', { class: 'card', id: 'bulk' }, h('h2', {}, '📥 まとめて登録（.env を貼る）'),
    h('p', { class: 'muted' }, '.env の中身（NAME=値 の行）を貼ると、下に名前だけが出ます。「まとめて登録」で 1 つずつ、ひとつの秘密と同じように（このブラウザで封じて）GitHub に送ります。値はどこにも表示されず、終わると欄は空になります。'),
    h('p', { class: 'muted' }, '値に空白や # があるときは "…" か \'…\' で囲みます（"…" の中の \\n は改行）。同じ名前が二度あれば後のものを使い、空の値・GITHUB_ で始まる名前は登録できません。'),
    area, h('label', {}, peek, ' 貼った中身を見えるようにする'), found,
    h('div', { class: 'row' }, go, clear), progress, status);
}
