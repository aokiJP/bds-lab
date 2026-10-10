// workspace (the 「アドオン」 tab's making and changing, ui/units.mjs): a new unit, a person's addon taken in, a unit's files
// changed — each by GitHub alone: the files through the contents API, the lab's own work by unit.yml on GitHub Actions
// (lib/workspace.mjs: its inputs; common/unitci.mjs runs them). Each change goes through the lab's policy once:
// guarded('dispatch', …) — allowed for this role, asked again when the policy wants, kept in the audit log.
import { h, toast, link } from './dom.mjs';
import * as W from '../lib/workspace.mjs';
import * as U from '../lib/units.mjs';
import { fmtBytes } from '../lib/model.mjs';

/** ctx, the same for every card here (ui/units.mjs passes its own on): {
 *    api (lib/gh.mjs), lab: { slug, repo: { default_branch }, workflows? (GitHub's list: unit.yml looked for in it) },
 *    gate(action) (a button's attributes when the policy does not allow it), guarded(action, detail, fn, done), go(tab),
 *    dispatch(workflow, inputs) → the workflow started on the lab's default branch — GitHub's call alone,
 *      st.api.dispatch(slug, workflow, default_branch, inputs): the guard is the caller's (here, once per action),
 *    runUnit?({ job, unit }) (test / go / sim of a unit; none: startUnit — unit.yml), closeEditor?() (the editor's 「閉じる」) } */
const branch = (ctx) => ctx.lab.repo?.default_branch ?? 'main';
const ready = (ctx) => W.hasWorkflow(ctx.lab.workflows, W.WORKFLOW);
/** a button that starts unit.yml: off when the policy does not allow it, or when the lab has no unit.yml */
export function startAttrs(ctx) {
  const g = ctx.gate?.('dispatch') ?? {}, off = !ready(ctx);
  return { disabled: Boolean(g.disabled) || off, title: g.title ?? (off ? 'このラボには .github/workflows/unit.yml がありません' : null) };
}
const noWorkflow = (ctx) => (ready(ctx) ? null : h('p', { class: 'warn' }, 'このラボには .github/workflows/unit.yml がまだありません（古いラボ）: ラボを新しくすると使えます。'));
const later = (ctx) => setTimeout(() => ctx.go?.('runs'), 2500);

/** test / go / sim of a unit on the lab's own Actions (unit.yml) → what guarded gave (undefined: not started) */
export async function startUnit(ctx, { job, unit }) {
  const r = W.runInputs({ job, unit });
  if (r.error) { toast(r.error, true); return undefined; }
  const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job, unit: r.inputs.unit }, () => ctx.dispatch(W.WORKFLOW, r.inputs),
    `${r.inputs.unit} の${W.JOB_WORDS[job]}を始めました（「進み具合」の unit で見られます${job === 'go' ? `。.mcaddon は実行の成果物 unit-${r.inputs.unit} に` : ''}）`);
  if (ok !== undefined) later(ctx);
  return ok;
}
const runOf = (ctx) => (x) => (ctx.runUnit ? ctx.runUnit(x) : startUnit(ctx, x));

/** 「新しく作る」: a name, a title and what it does → unit.yml (job new) makes the unit and commits it to the default branch */
export function newUnitCard(ctx) {
  const name = h('input', { type: 'text', id: 'newunit-name', placeholder: 'ruby_sword', autocapitalize: 'off', spellcheck: 'false' });
  const title = h('input', { type: 'text', id: 'newunit-title', placeholder: 'Ruby Sword' });
  const what = h('textarea', { id: 'newunit-request', placeholder: '例: ルビーの剣。右クリックで雷が落ちる。村人が 5 エメラルドで売ってくれる' });
  const make = async () => {
    const r = W.newUnitInputs({ unit: name.value, title: title.value, request: what.value });
    if (r.error) return toast(r.error, true);
    // (a name taken already: said now, not by a run a minute later)
    if (await U.unitExists(ctx.api, ctx.lab.slug, r.inputs.unit).catch(() => false)) return toast(`bds/addons/${r.inputs.unit} はもうあります: ほかの名前に`, true);
    const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job: 'new', unit: r.inputs.unit }, () => ctx.dispatch(W.WORKFLOW, r.inputs), `${r.inputs.unit} を作り始めました（数分: できると「アドオン」に出ます）`);
    if (ok === undefined) return;
    name.value = ''; title.value = ''; what.value = '';
    later(ctx);
  };
  return h('div', { class: 'card', id: 'newunit' }, h('h2', {}, '🆕 新しく作る'),
    h('p', { class: 'muted' }, 'GitHub の Actions がひな形（src/main.ts・tests.txt・TASK.md・bp と rp）を作り、既定の枝に入れます（unit.yml）。中身は「ファイルを直す」か「AI で変える」で。'),
    noWorkflow(ctx),
    h('details', {}, h('summary', {}, '名前・題・何をするかを書く'),
      h('label', { for: 'newunit-name' }, '名前（英小文字・数字・_ の 2〜40 文字: bds/addons/<名前>）'), name,
      h('label', { for: 'newunit-title' }, '題（遊ぶ人に見える名前。空なら名前）'), title,
      h('label', { for: 'newunit-request' }, '何をするアドオンか（TASK.md に）'), what,
      h('div', { class: 'row' }, h('button', { class: 'primary', ...startAttrs(ctx), onclick: make }, '作る'))));
}

/** the chosen file read whole, as a data: URL */
const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(new Error('ファイルが読めませんでした'));
  r.readAsDataURL(file);
});
/** 「取り込む」: a person's .mcaddon / .mcpack / .zip → incoming/<a safe name of its own> on a branch of its own,
 *  lab-incoming/<name> — never the default branch (the contents API, base64) → unit.yml (job import) makes it the unit
 *  bds/addons/<the name typed, else the file's>, its pack names and UUIDs kept, and deletes the branch */
export function importCard(ctx) {
  const file = h('input', { type: 'file', id: 'import-file', accept: W.IMPORT_TYPES.join(',') });
  const unit = h('input', { type: 'text', id: 'import-unit', placeholder: '空ならファイルの名前から', autocapitalize: 'off', spellcheck: 'false' });
  const words = h('textarea', { id: 'import-words', placeholder: '例: 新しい Minecraft で動かなくなったので直してほしい。お店の値段を半分に' });
  const state = h('div', { class: 'muted', id: 'import-state' });
  // (a big pack: said as it is chosen — the time it takes, and what to do if GitHub refuses it)
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    state.replaceChildren(f && f.size > W.BIG_BYTES ? h('span', { class: 'warn' }, `${fmtBytes(f.size)} の大きなパックです: 送るのに時間がかかります（Wi-Fi で）。GitHub が大きすぎると断ったら、音や画像を減らして小さくしてください。`) : '');
  });
  const take = async () => {
    const f = file.files?.[0];
    if (!f) return toast('ファイルを選んでください', true);
    const p = W.importPlan({ fileName: f.name, size: f.size, words: words.value, unit: unit.value });
    if (p.error) return toast(p.error, true);
    // (a unit by that name already: said now, not by a run a minute later)
    if (await U.unitExists(ctx.api, ctx.lab.slug, p.unit).catch(() => false)) return toast(`bds/addons/${p.unit} はもうあります: 名前を変えて（「名前」の欄に）`, true);
    const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job: 'import', file: p.path, unit: p.unit }, async () => {
      state.replaceChildren(`${f.name}（${fmtBytes(f.size)}）を読んでいます…`);
      const content = W.base64Of(await readAsDataUrl(f));
      state.replaceChildren(`${p.branch} に入れています…`);
      return W.importUnit(ctx.api, ctx.lab.slug, p, content, ctx.dispatch, branch(ctx));
    }, `${f.name} を bds/addons/${p.unit} に取り込み始めました（数分: できると「アドオン」に出ます）`);
    state.replaceChildren(ok === undefined ? '' : `✅ ${p.branch} に入れ、unit.yml を始めました（bds/addons/${p.unit} に）`);
    if (ok === undefined) return;
    file.value = ''; unit.value = ''; words.value = '';
    later(ctx);
  };
  return h('div', { class: 'card', id: 'importunit' }, h('h2', {}, '📥 取り込む（.mcaddon・.mcpack・.zip）'),
    h('p', { class: 'muted' }, `人のアドオンをユニットにして、直して仕上げます。ファイルは取り込みのための枝（lab-incoming/…）に入れ、Actions がユニットにします（既定の枝には入らず、できたら枝は消えます。パックの名前と UUID はそのまま: その人のワールドが新しい版として読みます）。${W.MAX_BYTES / 1024 / 1024} MB まで。`),
    noWorkflow(ctx),
    h('details', {}, h('summary', {}, 'ファイルを選ぶ'),
      h('label', { for: 'import-file' }, 'ファイル'), file,
      h('label', { for: 'import-unit' }, '名前（英小文字・数字・_。空ならファイルの名前から）'), unit,
      h('label', { for: 'import-words' }, 'その人の言葉（何をしてほしいか: TASK.md に）'), words,
      h('div', { class: 'row' }, h('button', { class: 'primary', ...startAttrs(ctx), onclick: take }, '取り込む')), state));
}

/** 「ファイルを直す」: one of a unit's files read (with its sha), changed in the page, saved as a commit on the default branch
 *  — never over another's change made since — or saved and tested. unit: a lib/units.mjs summary, or a bds unit's name */
export function editorView(ctx, unit) {
  const u = typeof unit === 'string' ? U.unitSummary({ name: unit }) : unit;
  const close = ctx.closeEditor ? h('button', { onclick: () => ctx.closeEditor() }, '閉じる') : null;
  if (u?.kind !== 'bds' || !U.UNIT.test(String(u?.name ?? ''))) return h('div', { class: 'card', id: 'editor' }, h('h2', {}, '✏️ ファイルを直す'), h('p', { class: 'warn' }, 'ここで直せるのは bds のアドオン（bds/addons/<名前>）だけです。'), close);
  const files = W.editableFiles(u), slug = ctx.lab.slug, g = ctx.gate?.('dispatch') ?? {};
  const pick = h('select', { id: 'edit-file', 'aria-label': '直すファイル' }, files.map((f) => h('option', { value: f }, f)));
  pick.value = files[0];
  const text = h('textarea', { id: 'edit-text', 'aria-label': 'ファイルの中身', spellcheck: 'false', rows: 22 });
  const note = h('p', { class: 'muted' }), state = h('div', { class: 'muted', id: 'edit-state' }), gh = h('span', {});
  // (the file as it was read: its sha, and its text — null: nothing read, nothing to save over)
  let sha = null, loaded = null;
  const load = async () => {
    const f = pick.value;
    sha = null; loaded = null; text.value = ''; text.disabled = true;
    note.replaceChildren(W.EDIT_NOTES[f] ?? (f === u.entry || f === 'bp/scripts/main.js' ? W.EDIT_NOTES.script : ''));
    gh.replaceChildren(link(`https://github.com/${slug}/blob/${branch(ctx)}/${u.dir}/${f}`, 'GitHub で見る'));
    state.replaceChildren('読んでいます…');
    try {
      const r = await W.readUnitFile(ctx.api, slug, `${u.dir}/${f}`);
      if (pick.value !== f) return;   // (another file chosen meanwhile: that one is shown)
      if (!r) return state.replaceChildren(`${f} はこのユニットにありません`);
      sha = r.sha; loaded = r.text; text.value = r.text; text.disabled = false;
      state.replaceChildren(`${u.dir}/${f}`);
    } catch (e) { if (pick.value === f) state.replaceChildren(h('span', { class: 'bad' }, e.message)); }
  };
  pick.addEventListener('change', load);
  const store = async (thenTest) => {
    const f = pick.value;
    if (loaded === null) return toast(`${f} がまだ読めていません`, true);
    // (the textarea gives every line break as \n: compared as such — a file of \r\n untouched is no change — and saved with
    // the line breaks the file had, not as a commit of every line)
    const now = W.withEol(text.value, W.eolOf(loaded));
    const c = W.checkEdit(f, now, u);
    if (!c.ok) return toast(c.error, true);
    if (W.sameText(now, loaded)) { if (!thenTest) toast('変わっていません'); }
    else {
      const path = `${u.dir}/${f}`;
      const r = await ctx.guarded('dispatch', { file: path }, () => W.saveUnitFile(ctx.api, slug, path, now, sha, `panel: ${path} を直す`), `${f} を保存しました（既定の枝に）`);
      if (r === undefined) return;
      sha = r.sha ?? sha; loaded = now;
      U.forgetUnits(ctx.api, slug);
    }
    if (thenTest) await runOf(ctx)({ job: 'test', unit: u.name });
  };
  load();
  return h('div', { class: 'card', id: 'editor', 'data-unit': u.ref },
    h('h2', {}, `✏️ ファイルを直す: ${u.title}`, h('span', { class: 'chip' }, u.dir)),
    h('div', { class: 'row' }, pick, h('button', { onclick: load }, '読み直す'), gh), note, text, state,
    h('div', { class: 'row' }, h('button', { class: 'primary', ...g, onclick: () => store(false) }, '保存'),
      h('button', { ...(ctx.runUnit ? g : startAttrs(ctx)), onclick: () => store(true) }, '保存して試験'), close));
}
