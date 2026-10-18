// workspace (the 「アドオン」 tab's making and changing, ui/units.mjs): a new unit, a person's addon taken in, a unit's files
// changed — each by GitHub alone: the files through the contents API, the lab's own work by unit.yml on GitHub Actions
// (lib/workspace.mjs: its inputs; common/unitci.mjs runs them). Each change goes through the lab's policy once:
// guarded('dispatch', …) — allowed for this role, asked again when the policy wants, kept in the audit log.
import { h, toast, link, failView } from './dom.mjs';
import * as W from '../lib/workspace.mjs';
import * as U from '../lib/units.mjs';
import { fmtBytes } from '../lib/model.mjs';
import * as D from '../lib/drafts.mjs';
import { revertCard } from './revert.mjs';

/** a failure drawn in place (a list that could not be read, a file that could not be opened): GitHub's words as they came
 *  and, under them, what to do — lib/rescue.mjs's next step, with its GitHub page as a link or 「もう一度」 as a button
 *  (retry: what that button does; none: no button, the words alone). Never an empty box */
// (the page's own way out — failView: the same words and next step as every other failure, with this sign-in's context: the
// App or a token; ctx is not needed for it)
export function wayOut(e, _ctx, retry = null) { return failView(e, retry); }

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
  return { disabled: Boolean(g.disabled) || off, title: g.title ?? (off ? 'このラボには .github/workflows/unit.yml がありません: ラボを新しくすると使えます（フォークなら GitHub のラボのページで Sync fork → Update branch）' : null) };
}
const noWorkflow = (ctx) => (ready(ctx) ? null : h('p', { class: 'warn' }, 'このラボには .github/workflows/unit.yml がまだありません（古いラボ）: ラボを新しくすると使えます。'));
const later = (ctx) => setTimeout(() => { if (ctx.isActive?.() !== false) ctx.go?.('runs'); }, 2500);
// Lock the entire action, including its preflight reads and the policy confirmation, and always restore its controls.
function singleAction(button, fields, fn, onError = null) {
  let busy = false;
  return async () => {
    if (busy || button.disabled) return;
    busy = true; const disabled = fields.map((f) => f.disabled);
    button.disabled = true; button.setAttribute('aria-busy', 'true'); fields.forEach((f) => { f.disabled = true; });
    try { return await fn(); }
    catch (e) { toast(e.message ?? String(e), true); onError?.(e); }
    finally { busy = false; button.disabled = false; button.setAttribute('aria-busy', 'false'); fields.forEach((f, i) => { f.disabled = disabled[i]; }); }
  };
}
const pendingRuns = new WeakMap();
const requireActive = (ctx) => { if (ctx.isActive?.() === false) throw new Error('画面かアカウントが変わりました。アドオンを開き直して操作してください'); };

/** test / go / sim of a unit on the lab's own Actions (unit.yml) → what guarded gave (undefined: not started) */
export async function startUnit(ctx, { job, unit }) {
  const r = W.runInputs({ job, unit });
  if (r.error) { toast(r.error, true); return undefined; }
  const key = `${ctx.lab.slug}:${job}:${r.inputs.unit}`, owner = ctx.api ?? ctx;
  const pending = pendingRuns.get(owner) ?? new Map(); pendingRuns.set(owner, pending);
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job, unit: r.inputs.unit }, () => { requireActive(ctx); return ctx.dispatch(W.WORKFLOW, r.inputs); },
      `${r.inputs.unit} の${W.JOB_WORDS[job]}を始めました（「進み具合」の unit で見られます${job === 'go' ? `。.mcaddon は実行の成果物 unit-${r.inputs.unit} に` : ''}）`);
    if (ok !== undefined) later(ctx);
    return ok;
  })();
  pending.set(key, task);
  try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
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
    // Check before dispatch; a failed check keeps the form and never submits an unchecked name.
    if (await U.unitExists(ctx.api, ctx.lab.slug, r.inputs.unit)) return toast(`bds/addons/${r.inputs.unit} はもうあります: ほかの名前に`, true);
    if (ctx.isActive?.() === false) return;
    const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job: 'new', unit: r.inputs.unit }, () => { requireActive(ctx); return ctx.dispatch(W.WORKFLOW, r.inputs); }, `${r.inputs.unit} を作り始めました（数分: できると「アドオン」に出ます）`);
    if (ok === undefined) return;
    name.value = ''; title.value = ''; what.value = '';
    later(ctx);
  };
  const submit = h('button', { class: 'primary', ...startAttrs(ctx) }, '作る');
  submit.addEventListener('click', singleAction(submit, [name, title, what], make));
  return h('div', { class: 'card', id: 'newunit' }, h('h2', {}, '🆕 新しく作る'),
    h('p', { class: 'muted' }, 'GitHub の Actions がひな形（src/main.ts・tests.txt・TASK.md・bp と rp）を作り、既定の枝に入れます（unit.yml）。中身は「ファイルを直す」か「AI で変える」で。'),
    noWorkflow(ctx),
    h('details', {}, h('summary', {}, '名前・題・何をするかを書く'),
      h('label', { for: 'newunit-name' }, '名前（英小文字・数字・_ の 2〜40 文字: bds/addons/<名前>）'), name,
      h('label', { for: 'newunit-title' }, '題（遊ぶ人に見える名前。空なら名前）'), title,
      h('label', { for: 'newunit-request' }, '何をするアドオンか（TASK.md に）'), what,
      h('div', { class: 'row' }, submit)));
}

/** the chosen file read whole, as a data: URL */
const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(new Error('ファイルが読めませんでした'));
  r.onabort = () => reject(new Error('ファイルの読み込みが中断されました。選び直して、もう一度取り込んでください'));
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
    if (p.error) return toast(`${p.error}。ファイルを選び直すか「名前」の欄を直して、もう一度「取り込む」`, true);
    // (a unit by that name already: said now, not by a run a minute later)
    if (await U.unitExists(ctx.api, ctx.lab.slug, p.unit)) return toast(`bds/addons/${p.unit} はもうあります: 名前を変えて（「名前」の欄に）`, true);
    if (ctx.isActive?.() === false) return;
    const ok = await ctx.guarded('dispatch', { workflow: W.WORKFLOW, job: 'import', file: p.path, unit: p.unit }, async () => {
      requireActive(ctx);
      state.replaceChildren(`${f.name}（${fmtBytes(f.size)}）を読んでいます…`);
      const content = W.base64Of(await readAsDataUrl(f));
      requireActive(ctx);
      state.replaceChildren(`${p.branch} に入れています…`);
      return W.importUnit(ctx.api, ctx.lab.slug, p, content, ctx.dispatch, branch(ctx));
    }, `${f.name} を bds/addons/${p.unit} に取り込み始めました（数分: できると「アドオン」に出ます）`);
    state.replaceChildren(ok === undefined ? '取り込めませんでした: 上の知らせを読んで、直してからもう一度「取り込む」を押してください' : `✅ ${p.branch} に入れ、unit.yml を始めました（bds/addons/${p.unit} に）`);
    if (ok === undefined) return;
    file.value = ''; unit.value = ''; words.value = '';
    later(ctx);
  };
  const submit = h('button', { class: 'primary', ...startAttrs(ctx) }, '取り込む');
  submit.addEventListener('click', singleAction(submit, [file, unit, words], take, () => state.replaceChildren('取り込みは完了していません。入力を残しています。知らせを確認してください')));
  return h('div', { class: 'card', id: 'importunit' }, h('h2', {}, '📥 取り込む（.mcaddon・.mcpack・.zip）'),
    h('p', { class: 'muted' }, `人のアドオンをユニットにして、直して仕上げます。ファイルは取り込みのための枝（lab-incoming/…）に入れ、Actions がユニットにします（既定の枝には入らず、できたら枝は消えます。パックの名前と UUID はそのまま: その人のワールドが新しい版として読みます）。${W.MAX_BYTES / 1024 / 1024} MB まで。`),
    noWorkflow(ctx),
    h('details', {}, h('summary', {}, 'ファイルを選ぶ'),
      h('label', { for: 'import-file' }, 'ファイル'), file,
      h('label', { for: 'import-unit' }, '名前（英小文字・数字・_。空ならファイルの名前から）'), unit,
      h('label', { for: 'import-words' }, 'その人の言葉（何をしてほしいか: TASK.md に）'), words,
      h('div', { class: 'row' }, submit), state));
}

/** 「ファイルを直す」: one of a unit's files read (with its sha), changed in the page, saved as a commit on the default branch
 *  — never over another's change made since — or saved and tested. unit: a lib/units.mjs summary, or a bds unit's name */
export function editorView(ctx, unit) {
  const u = typeof unit === 'string' ? U.unitSummary({ name: unit }) : unit;
  let dispose = () => {};
  const close = ctx.closeEditor ? h('button', { onclick: () => { dispose(); ctx.closeEditor(); } }, '閉じる') : null;
  if (u?.kind !== 'bds' || !U.UNIT.test(String(u?.name ?? ''))) return h('div', { class: 'card', id: 'editor' }, h('h2', {}, '✏️ ファイルを直す'), h('p', { class: 'warn' }, 'ここで直せるのは bds のアドオン（bds/addons/<名前>）だけです。Endstone・LeviLamina のものは GitHub の画面で直してください。'),
    u?.dir ? h('p', {}, link(`https://github.com/${ctx.lab.slug}/tree/${branch(ctx)}/${u.dir}`, 'GitHub で開く')) : null, close);
  const files = W.editableFiles(u), slug = ctx.lab.slug, g = ctx.gate?.('dispatch') ?? {};
  const pick = h('select', { id: 'edit-file', 'aria-label': '直すファイル' }, files.map((f) => h('option', { value: f }, f)));
  pick.value = files[0];
  const text = h('textarea', { id: 'edit-text', 'aria-label': 'ファイルの中身', spellcheck: 'false', rows: 22 });
  const note = h('p', { class: 'muted' }), state = h('div', { class: 'muted', id: 'edit-state', role: 'status', 'aria-live': 'polite' }), gh = h('span', {});
  // (the file's history and one click back to a version of it: ui/revert.mjs — read when opened, for the file chosen)
  const back = h('details', { id: 'edit-revert' });
  let backFor = null;
  const backOf = () => { backFor = null; back.open = false; back.replaceChildren(h('summary', {}, `↩️ ${pick.value} を前の版に戻す`)); };
  back.addEventListener('toggle', () => { if (back.open && backFor !== pick.value) { backFor = pick.value; back.append(revertCard(ctx, { path: `${u.dir}/${pick.value}`, branch: branch(ctx), onRestored: () => { U.forgetUnits(ctx.api, slug); load(); } })); } });
  // (the file as it was read: its sha, and its text — null: nothing read, nothing to save over)
  let sha = null, loaded = null, activeFile = pick.value, generation = 0, reading = false, writing = false, disposed = false;
  // (the draft: what was typed and not yet saved, kept in this browser — ctx.draftStore / draftWait for a test)
  const store$ = ctx.draftStore ?? D.browserStorage(), box = h('div', { id: 'edit-draft' });
  const keyOf = (f) => D.draftKey({ account: ctx.me?.login, slug, unit: u.name, path: f });
  const saver = D.draftSaver(store$, { wait: ctx.draftWait ?? D.WAIT, onSaved: (r) => { if (!r.ok) box.replaceChildren(h('span', { class: 'muted' }, `下書きは残せませんでした: ${r.why}`)); } });
  const showDraft = (f) => {
    box.replaceChildren();
    const d = D.loadDraft(store$, keyOf(f));
    if (!d) return;
    if (W.sameText(d.text, loaded)) return D.dropDraft(store$, keyOf(f));
    const stale = D.staleDraft(d, sha);
    box.append(h('p', { class: stale ? 'warn' : 'muted' }, `📝 下書きがあります（${D.ago(d.at)}）`,
      stale ? ' ※ 下書きを作ったあとに GitHub の中身が変わっています: 戻して保存すると、その変更の上に重なります（先に GitHub で見比べてください）' : ''),
      h('div', { class: 'row' },
        h('button', { onclick: () => { text.value = d.text; remember(); box.replaceChildren(h('span', { class: 'muted' }, '下書きを戻しました（保存するまで GitHub は変わりません）')); state.replaceChildren('下書きを戻しました。変更はまだ GitHub に保存されていません'); } }, '戻す'),
        h('button', { onclick: () => { saver.cancel(); D.dropDraft(store$, keyOf(f)); box.replaceChildren(h('span', { class: 'muted' }, '下書きを捨てました')); } }, '捨てる')));
  };
  const remember = () => {
    if (loaded === null) return;
    if (W.sameText(W.withEol(text.value, W.eolOf(loaded)), loaded)) { saver.cancel(); return D.dropDraft(store$, keyOf(activeFile)); }
    saver.push(keyOf(activeFile), { text: text.value, baseSha: sha, path: activeFile });
  };
  const flush = () => { remember(); saver.flush(); };
  const hidden = () => { if (globalThis.document.visibilityState === 'hidden') flush(); };
  globalThis.addEventListener?.('pagehide', flush);
  globalThis.document?.addEventListener?.('visibilitychange', hidden);
  dispose = () => {
    if (disposed) return;
    flush(); disposed = true; generation++;
    globalThis.removeEventListener?.('pagehide', flush);
    globalThis.document?.removeEventListener?.('visibilitychange', hidden);
  };
  text.addEventListener('input', () => {
    if (disposed || loaded === null) return;
    remember();
    if (!writing) state.replaceChildren(W.sameText(text.value, loaded) ? `${u.dir}/${activeFile}（変更なし）` : '未保存の変更があります（GitHub へは「保存」で反映します）');
  });
  const controls = () => {
    pick.disabled = writing || disposed; reload.disabled = writing || disposed;
    saveButton.disabled = Boolean(g.disabled) || reading || writing || disposed || loaded === null;
    const pending = writing ? '保存が終わるまでお待ちください' : reading || loaded === null ? 'ファイルがまだ読めていません。「読み直す」を押してください' : '';
    saveButton.title = g.disabled ? g.title ?? '' : pending;
    const testGate = ctx.runUnit ? g : startAttrs(ctx);
    testButton.title = testGate.disabled ? testGate.title ?? '' : pending;
    testButton.disabled = Boolean((ctx.runUnit ? g : startAttrs(ctx)).disabled) || reading || writing || disposed || loaded === null;
    text.disabled = reading || disposed || loaded === null;
  };
  const load = async () => {
    if (disposed) return;
    if (writing) { pick.value = activeFile; return; }
    const f = pick.value, ticket = ++generation;
    flush();
    activeFile = f; reading = true;
    backOf(); box.replaceChildren();
    sha = null; loaded = null; text.value = ''; controls();
    note.replaceChildren(W.EDIT_NOTES[f] ?? (f === u.entry || f === 'bp/scripts/main.js' ? W.EDIT_NOTES.script : ''));
    gh.replaceChildren(link(`https://github.com/${slug}/blob/${branch(ctx)}/${u.dir}/${f}`, 'GitHub で見る'));
    state.replaceChildren('読んでいます…');
    try {
      const r = await W.readUnitFile(ctx.api, slug, `${u.dir}/${f}`);
      if (disposed || ticket !== generation) return;
      if (!r) return state.replaceChildren(`${f} はこのユニットにありません。足すなら `, link(`https://github.com/${slug}/new/${branch(ctx)}/${u.dir}?filename=${encodeURIComponent(f)}`, 'GitHub で新しく作る'), '（または「AI で変える」で作らせる）');
      sha = r.sha; loaded = r.text; text.value = r.text;
      state.replaceChildren(`${u.dir}/${f}`); showDraft(f);
    } catch (e) { if (!disposed && ticket === generation) state.replaceChildren(wayOut(e, ctx, load)); }
    finally { if (!disposed && ticket === generation) { reading = false; controls(); } }
  };
  pick.addEventListener('change', load);
  const store = async (thenTest) => {
    if (writing || disposed) return;
    const f = activeFile;
    if (loaded === null) return toast(`${f} がまだ読めていません: 「読み直す」を押してください`, true);
    const now = W.withEol(text.value, W.eolOf(loaded)), c = W.checkEdit(f, now, u);
    if (!c.ok) return toast(c.error, true);
    flush(); writing = true; controls(); state.replaceChildren('保存を確認しています…');
    try {
      if (!W.sameText(now, loaded)) {
        const path = `${u.dir}/${f}`;
        const r = await ctx.guarded('dispatch', { file: path }, () => { if (disposed) throw new Error('編集画面を閉じたため、保存していません'); requireActive(ctx); return W.saveUnitFile(ctx.api, slug, path, now, sha, `panel: ${path} を直す`); }, `${f} を保存しました（既定の枝に）`);
        if (disposed) return;
        if (r === undefined) { state.replaceChildren('保存は完了していません。編集内容を残しています。知らせを確認して、もう一度保存してください'); return; }
        sha = r.sha ?? sha; loaded = now; U.forgetUnits(ctx.api, slug);
      } else if (!thenTest) toast('変わっていません');
      remember(); saver.flush();
      const dirty = !W.sameText(text.value, loaded);
      if (!dirty) box.replaceChildren();
      state.replaceChildren(dirty ? '保存中に加えた変更は未保存です。もう一度保存してください' : '✅ GitHub に保存済みです');
      // Testing before the latest edits were saved would give a misleading success for the screen's current text.
      if (thenTest && !dirty) await runOf(ctx)({ job: 'test', unit: u.name });
    } catch (e) { if (!disposed) { flush(); state.replaceChildren(wayOut(e, ctx)); } }
    finally { writing = false; if (!disposed) controls(); }
  };
  const reload = h('button', { onclick: load }, '読み直す');
  const saveButton = h('button', { class: 'primary', ...g, onclick: () => store(false) }, '保存');
  const testButton = h('button', { ...(ctx.runUnit ? g : startAttrs(ctx)), onclick: () => store(true) }, '保存して試験');
  const editor = h('div', { class: 'card', id: 'editor', 'data-unit': u.ref },
    h('h2', {}, `✏️ ファイルを直す: ${u.title}`, h('span', { class: 'chip' }, u.dir)),
    h('div', { class: 'row' }, pick, reload, gh), note, box, text, state,
    h('div', { class: 'row' }, saveButton, testButton, close), back);
  editor.stop = dispose;
  load();
  return editor;
}
