// secretform: the repository's secrets set from a phone — a run of secrets.yml (GitHub's Actions → secrets → Run workflow)
// sends the person a DM on Discord with a button; it opens a form with a field for each secret asked (MS_EMAIL,
// MS_PASSWORD…); what is sent becomes those secrets (gh secret set, with the token in the secret LAB_SECRETS_TOKEN: a
// fine-grained token of this repository with "Secrets: Read and write"). Nothing else to install, no node on the phone.
// The values: hidden in the run's log the moment they arrive (::add-mask::), never printed, never written to a file, sent
// to gh through stdin. A form leaves nothing in the chat; a message `NAME=value` works too, but stays in the DM until the
// person deletes it (a bot cannot delete a person's message), so the form is what the DM offers first.
import { button, row, modal, modalValues } from './discord.mjs';

export const NAME_RE = /^[A-Z_][A-Z0-9_]{0,99}$/;
/** "MS_EMAIL, MS_PASSWORD" → { names } or { error } (pure): GitHub's names, at most 5 (a form's fields), none of GITHUB_ */
export function secretNames(list) {
  const names = [...new Set(String(list ?? '').split(/[\s,]+/).filter(Boolean).map((n) => n.toUpperCase()))];
  if (!names.length) return { error: '名前がありません（例 MS_EMAIL,MS_PASSWORD）' };
  if (names.length > 5) return { error: `一度に 5 つまで（フォームの欄の数）: ${names.length} 個` };
  const bad = names.filter((n) => !NAME_RE.test(n) || n.startsWith('GITHUB_'));
  if (bad.length) return { error: `秘密の名前にできません: ${bad.join(', ')}（英大文字・数字・_ で、数字から始めない、GITHUB_ で始めない）` };
  return { names };
}
/** a secret whose value is a password-like word (pure): kept exactly as typed (no trimming), its field says it shows */
export const isHidden = (name) => /PASS|SECRET|TOKEN|KEY|PIN|CODE/.test(name);
/** a value as it is set (pure): an e-mail or a name trimmed of the spaces a phone's keyboard adds; a password only of the
 *  line ends a paste brings */
export const cleanValue = (name, v) => (isHidden(name) ? String(v ?? '').replace(/^[\r\n]+|[\r\n]+$/g, '') : String(v ?? '').trim());
/** the form (pure): one field each, none required (an empty one leaves that secret as it is) */
export function secretForm(run, names) {
  return modal(`lab-secrets:${run}:form`, 'GitHub の秘密を登録', names.map((n) => ({ id: n, label: n, required: false, max: 4000, placeholder: isHidden(n) ? '入力した文字は画面に見えます（周りに注意）' : '空のままなら変えません' })));
}
/** a DM's lines `NAME=value` → { NAME: value } for the names asked (pure); other lines and names are not taken */
export function secretLines(text, names) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s?(.*)$/.exec(line);
    if (m && names.includes(m[1].toUpperCase())) out[m[1].toUpperCase()] = m[2];
  }
  return out;
}
/** a value hidden in GitHub's log from now on (pure): the ::add-mask:: lines for it, one for each of its lines (the runner
 *  hides line by line), its % written as %25 (the runner reads the command's data unescaped) */
export function maskLines(value) {
  const esc = (x) => x.replace(/%/g, '%25').replace(/\r/g, '%0D');
  return [...new Set([String(value), ...String(value).split(/\r?\n/)].map((x) => x.trim()).filter((x) => x.length >= 2 && !/\n/.test(x)))].map((x) => `::add-mask::${esc(x)}`);
}

/** the DM, the form and the secrets set → { set: [names], kept: [names], failed: [{ name, error }], how } (how: 'form' |
 *  'message' | 'cancel' | 'timeout'). b: lib/discord.mjs bot. setSecret(name, value) → { ok, error? }; mask(value): hides
 *  it in the log (in Actions: maskLines to stdout); minutes: how long the DM waits */
export async function askSecrets({ b, names, run, repo, minutes = 10, setSecret, mask = () => {}, log = () => {}, timers = { setTimeout, clearTimeout } }) {
  const id = (what) => `lab-secrets:${run}:${what}`;
  const msg = await b.send({
    content: [`🔑 GitHub の秘密を登録します（${repo}、実行 ${run}）: **${names.join('・')}**`,
      '「📝 入力する」でフォームを開いて、書いて送ってください（値はこのチャットに残りません。空の欄の秘密は変えません）。',
      `メッセージでも: 1 行に 1 つ \`名前=値\`（そのメッセージは自分で消してください: ボットには消せません）。${minutes} 分で締め切ります。`].join('\n'),
    components: [row(button('📝 入力する', id('open'), 1), button('やめる', id('cancel'), 4))],
  });
  // (the values set: each one hidden first, then set; what is said names them, never their values)
  const apply = (values) => {
    const set = [], kept = [], failed = [];
    for (const n of names) {
      const v = cleanValue(n, values[n]);
      if (v) mask(v);
      if (!v) { kept.push(n); continue; }
      const r = setSecret(n, v);
      if (r.ok) set.push(n); else failed.push({ name: n, error: String(r.error ?? '').split(v).join('<値>').slice(0, 200) });
    }
    return { set, kept, failed };
  };
  const said = (r) => [r.set.length ? `✅ 登録しました: ${r.set.join('・')}（値は表示しません）` : '何も登録していません（全部の欄が空）',
    ...(r.kept.length && r.set.length ? [`そのまま: ${r.kept.join('・')}（空の欄）`] : []),
    ...r.failed.map((f) => `❌ ${f.name}: ${f.error}`)].join('\n');
  let resolveDone, over = false;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  // (once: a second form or message after the first is not taken)
  const finish = (r) => { if (!over) { over = true; resolveDone(r); } };
  const timer = timers.setTimeout(() => finish({ set: [], kept: names, failed: [], how: 'timeout' }), minutes * 60_000);
  await b.listen(async (type, d) => {
    if (over) return;
    if (type === 'INTERACTION_CREATE' && d.type === 3 && d.data?.custom_id === id('open')) return b.respond(d, 9, secretForm(run, names));
    if (type === 'INTERACTION_CREATE' && d.type === 3 && d.data?.custom_id === id('cancel')) { await b.respond(d, 7, { content: 'やめました（何も登録していません）', components: [] }); finish({ set: [], kept: names, failed: [], how: 'cancel' }); return; }
    if (type === 'INTERACTION_CREATE' && d.type === 5 && d.data?.custom_id === id('form')) {
      const values = modalValues(d);
      for (const n of names) { const v = cleanValue(n, values[n]); if (v) mask(v); }
      await b.respond(d, 6);
      const r = apply(values);
      await b.editReply(d, { content: said(r), components: [] }).catch((e) => log(`W Discord: ${e.message}`));
      finish({ ...r, how: 'form' });
      return;
    }
    if (type === 'MESSAGE_CREATE') {
      const values = secretLines(d.content, names);
      for (const n of Object.keys(values)) { const v = cleanValue(n, values[n]); if (v) mask(v); }
      if (!Object.keys(values).length) { await b.send({ content: `\`名前=値\` の行がありません（名前: ${names.join('・')}）。フォームなら「📝 入力する」` }); return; }
      const r = apply(values);
      await b.send({ content: `${said(r)}\n⚠️ 値の入ったメッセージを消してください（長押し → 削除。ボットには消せません）` }).catch((e) => log(`W Discord: ${e.message}`));
      await b.edit(msg.id, { components: [] }).catch(() => {});
      finish({ ...r, how: 'message' });
    }
  });
  const r = await done;
  timers.clearTimeout(timer);
  if (r.how === 'timeout') await b.edit(msg.id, { content: `⌛ 締め切りました（${minutes} 分）。何も登録していません: もう一度 Actions → secrets → Run workflow`, components: [] }).catch(() => {});
  b.close();
  return r;
}
