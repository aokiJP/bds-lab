// schedule (the 「予約」 tab): workflows the lab starts by itself at set times — each with when, in words, and its next three
// times; added, changed, paused, resumed and deleted here. They are kept in the lab's default branch
// (.github/bds-lab-schedule.json: lib/schedule.mjs) and started every hour by schedule.yml in the lab's own Actions: no one's
// computer, no one's token. Saving them starts workflows ahead of time, so it is the policy's 「ワークフローを始める」
// (dispatch), kept in the audit log; a schedule of hostrun.yml needs the policy's hostrun too, and one of ai-make (the AI's
// API, each time it starts) is asked first.
import { h, toast, link } from './dom.mjs';
import * as S from '../lib/schedule.mjs';
import * as M from '../lib/model.mjs';

const HOSTRUN = 'hostrun.yml';
const localTz = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return S.validTimezone(z) ? z : 'UTC'; } catch { return 'UTC'; } };
/** a workflow as ctx.workflows has it (GitHub's { name, path, state }, or a file name) → { file, name, state } */
const wfOf = (w) => { const file = String(w?.path ?? w ?? '').split('/').pop(); return { file, name: String(w?.name ?? file), state: w?.state ?? 'active' }; };
const inputsLine = (inputs) => Object.entries(inputs).map(([k, v]) => `${k}=${v.length > 40 ? `${v.slice(0, 40)}…` : v}`).join(' ');
const aiAsk = (job) => `AI の料金を使います: ${job.workflow} は始まるたびに、ラボの ANTHROPIC_API_KEY（か OPENAI_API_KEY）の分を使います（${S.describe(job)}）。予約しますか`;
const when = (job, now) => S.nextRuns(job, now, 3).map((d) => S.fmtWhen(d, job.timezone)).join('・');
/** an element's children replaced, as h takes them (nested lists flattened, null and false left out — the DOM itself would
 *  show them as text) */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
/** GitHub's refusal of the file's write (as api throws it: { status, message }) → is it that the sha read is no longer the
 *  file's (pure): changed elsewhere since it was read (409 「… does not match <sha>」), the branch moved under the write (409
 *  「is at … but expected …」), made elsewhere while it was read as none (422 「"sha" wasn't supplied」). Any other 409 / 422 is
 *  not — a protected default branch, a ruleset: read again, it would be refused the same */
const staleSha = (e) => M.refusal(e?.status, e?.message).kind === 'stale';
const protectedSay = (e) => { const r = M.refusal(e?.status, e?.message); return r.kind === 'protected' ? r.say : '既定の枝が守られているかもしれません（PR が要ります）'; };

/** the 「予約」 tab. ctx: { api, lab: { slug, repo }, workflows (the lab's workflows as GitHub lists them — { name, path, state }
 *  — or their file names: the active ones but schedule.yml are offered; schedule.yml's own state is shown when it is among
 *  them), dispatchInputs(file) (a workflow's inputs: what M.dispatchInputs gives for its YAML, or a promise of it; none: read
 *  here through api), may(action), gate(action), guarded(action, detail, fn, done), now() (→ ms; tests) } → a promise of the
 *  schedule read (undefined: not read — why is shown where the list goes) */
export function scheduleTab(body, ctx) {
  const { api, lab } = ctx, now = () => ctx.now?.() ?? Date.now();
  const may = (a) => Boolean(ctx.may?.(a)), gate = (a) => ctx.gate?.(a) ?? (may(a) ? {} : { disabled: true });
  const wfs = (ctx.workflows ?? []).map(wfOf).filter((w) => /\.ya?ml$/.test(w.file));
  const inputsOf = async (file) => (ctx.dispatchInputs ? ctx.dispatchInputs(file) : M.dispatchInputs((await api.file(lab.slug, `.github/workflows/${file}`))?.text ?? ''));
  // (the file as read: its sha — a change made elsewhere in between is never written over — and its jobs as they are)
  const st = { sha: null, raw: [], errors: [], broken: false };
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…')), editor = h('div', { id: 'scheduleedit' });

  const load = async () => {
    let f;
    // (not read — the network, GitHub down or busy, no right to see it: why, where the list goes, and a way to read again; not
    // only a passing toast — the list would stay 「読んでいます…」, or show the jobs read before as if they were the file's)
    try { f = await api.file(lab.slug, S.SCHEDULE_FILE); } catch (e) {
      fill(list, h('p', { class: 'bad' }, `${S.SCHEDULE_FILE} を読めません: ${e?.message ?? e}`, ' ', h('button', { onclick: reload }, '読み直す')));
      return undefined;
    }
    let j = null, broken = false;
    if (f) { try { j = JSON.parse(f.text); } catch { broken = true; } }
    Object.assign(st, { sha: f?.sha ?? null, raw: Array.isArray(j?.jobs) ? j.jobs : [], errors: broken ? [`${S.SCHEDULE_FILE} が JSON ではありません`] : S.checkSchedule(j).errors, broken });
    draw();
    return st;
  };
  // (the form closed first: its place in the list may move)
  const reload = () => { editor.replaceChildren(); return load(); };
  /** the jobs written to the default branch with the sha read → GitHub's answer, undefined when not done */
  const save = async (jobs, { workflow, done, message }) => {
    const out = S.scheduleText(jobs);
    if (st.broken && !confirm(`いまの ${S.SCHEDULE_FILE} は JSON として読めません。保存すると、その中身は消えて、ここに出ている予約だけになります。よろしいですか`)) return undefined;
    let stale = false;
    // (any other 409 / 422 — a protected default branch, a ruleset — is GitHub's own words with what it may be: the form kept
    // as typed, nothing read again)
    const r = await ctx.guarded('dispatch', { file: S.SCHEDULE_FILE, ...(workflow ? { workflow } : {}) },
      () => api.putFile(lab.slug, S.SCHEDULE_FILE, out.text, st.sha ?? undefined, `panel: 予約 — ${message}`).catch((e) => {
        if (staleSha(e)) stale = true;
        else if (e?.status === 409 || e?.status === 422) throw Object.assign(new Error(`${e.message} — ${protectedSay(e)}`), { status: e.status });
        throw e;
      }), done);
    // (changed elsewhere since it was read: read again, nothing written over; the form closed — its place in the list may have moved)
    if (r === undefined) { if (stale) await reload(); return undefined; }
    Object.assign(st, { sha: r?.content?.sha ?? null, raw: JSON.parse(out.text).jobs, errors: out.errors, broken: false });
    // (a job on: schedule.yml on too — it turns itself off while there is none, so that an idle lab spends no minute an hour)
    if (st.raw.some((x) => S.checkJob(x).job?.enabled)) { try { await api.call('PUT', `/repos/${lab.slug}/actions/workflows/${S.SCHEDULER}/enable`); if (sch) sch.state = 'active'; } catch { /* said below when it is still off */ } }
    if (!st.sha) await load(); else draw();
    return r;
  };

  const row = (raw, i, twice) => {
    const c = S.checkJob(raw), j = c.job, id = typeof raw?.id === 'string' ? raw.id : '';
    const errs = [...c.errors, ...(id && twice.has(id.toLowerCase()) ? ['id がほかの予約と同じです（1 つずつ）'] : [])];
    const wf = j ? wfs.find((w) => w.file === j.workflow) : null;
    return h('li', { 'data-job': id || String(i) }, h('div', { class: 'row' },
      h('span', { class: 'grow' },
        h('strong', {}, j ? S.describe(j) : '正しくない予約'), ' ', h('span', { class: 'chip' }, String(raw?.workflow ?? '?').slice(0, 100)), j && !j.enabled ? [' ', h('span', { class: 'chip' }, '⏸ 止めています')] : null,
        j?.note ? h('div', {}, j.note) : null,
        j ? h('div', { class: 'muted' }, j.enabled ? `次: ${when(j, now())}` : '止めている間は始まりません') : null,
        j && Object.keys(j.inputs).length ? h('div', { class: 'muted' }, `入力: ${inputsLine(j.inputs)}`) : null,
        wf && wf.state !== 'active' ? h('div', { class: 'warn' }, `${wf.file} は GitHub で止まっています（${wf.state}）: 始まりません`) : null,
        j && !wf && wfs.length ? h('div', { class: 'warn' }, `${j.workflow} がラボのワークフローに見当たりません: 始まりません`) : null,
        errs.length ? h('div', { class: 'warn' }, errs.join(' / ')) : null,
        id ? h('div', { class: 'muted' }, `id: ${id.slice(0, 60)}`) : null),
      h('button', { ...gate('dispatch'), onclick: () => open(i) }, '直す'),
      j ? h('button', { ...gate('dispatch'), onclick: () => toggle(i) }, j.enabled ? '止める' : '動かす') : null,
      h('button', { class: 'danger', ...gate('dispatch'), onclick: () => remove(i) }, '消す')));
  };
  const draw = () => {
    const ids = st.raw.map((x) => (typeof x?.id === 'string' ? x.id.toLowerCase() : null)), twice = new Set(ids.filter((x, k) => x && ids.indexOf(x) !== k));
    // (each job's own errors are shown on its row; the file's here)
    const fileErrors = st.errors.filter((e) => !/^jobs\[\d+\]/.test(e));
    // (the scheduler's own state: off with a job on — nothing starts — is to be said; off with none on is how it rests)
    const on = st.raw.some((x) => S.checkJob(x).job?.enabled);
    fill(list,
      sch && sch.state !== 'active' ? (on ? h('p', { class: 'warn', id: 'schedulerstate' }, `${S.SCHEDULER} が GitHub で止まっています（${sch.state}${sch.state === 'disabled_inactivity' ? ': 公開リポジトリは 60 日動きがないと GitHub が止めます' : ''}）: 有効にするまで、どの予約も始まりません。 `,
        link(`https://github.com/${lab.slug}/actions/workflows/${S.SCHEDULER}`, 'GitHub で有効にする'))
        : h('p', { class: 'muted', id: 'schedulerstate' }, `動かす予約がない間は ${S.SCHEDULER} も止めています（Actions の時間を使いません）。予約を足すと、また動きます。`)) : null,
      st.errors.length ? h('div', { class: 'warn', id: 'scheduleerrors' }, `いまの ${S.SCHEDULE_FILE} は正しくありません: 直すまで、どの予約も始まりません。`, fileErrors.length ? h('ul', {}, fileErrors.map((e) => h('li', {}, e))) : null) : null,
      st.raw.length ? h('ul', { class: 'plain', id: 'schedulelist' }, st.raw.map((x, i) => row(x, i, twice))) : st.broken ? null : h('p', { class: 'muted' }, 'まだ予約はありません。「＋ 予約を足す」から。'));
  };

  const toggle = async (i) => {
    const j = S.checkJob(st.raw[i]).job;
    if (!j) return;
    const on = !j.enabled;
    if (on && j.workflow === HOSTRUN && !may('hostrun')) return toast(`貸し手の Actions で走らせる（${HOSTRUN}）予約は、あなたの役割には許されていません`, true);
    if (on && S.AI_WORKFLOWS.includes(j.workflow) && !confirm(aiAsk(j))) return;
    const what = `${j.workflow}・${S.describe(j)}`;
    await save(st.raw.map((x, k) => (k === i ? { ...j, enabled: on } : x)), { workflow: j.workflow, done: `${on ? '動かしました' : '止めました'}: ${what}`, message: `${on ? '動かす' : '止める'} ${j.id}` });
  };
  const remove = async (i) => {
    const raw = st.raw[i], j = S.checkJob(raw).job;
    if (!confirm(`予約「${j ? `${j.workflow}・${S.describe(j)}` : `${String(raw?.workflow ?? '?').slice(0, 100)}（正しくない予約）`}」を消しますか`)) return;
    await save(st.raw.filter((_, k) => k !== i), { workflow: j?.workflow, done: '予約を消しました', message: `消す ${j?.id ?? `jobs[${i}]`}` });
  };

  /** the form for a new job (i: null) or job i: the workflow and its inputs (from its YAML), when, the time zone, a note */
  const open = async (i) => {
    if (i === null && st.raw.length >= S.MAX_JOBS) return toast(`予約は ${S.MAX_JOBS} 件までです`, true);
    const raw = i === null ? null : st.raw[i], base = i === null ? {} : S.checkJob(raw).job ?? (raw && typeof raw === 'object' ? raw : {});
    // (a job keeps its id; a new one, or one whose id is not right, is given one from its workflow)
    const id = typeof base.id === 'string' && /^[A-Za-z0-9][\w-]{0,39}$/.test(base.id) ? base.id : null;
    const choices = wfs.filter((w) => w.file !== S.SCHEDULER && w.state === 'active');
    if (typeof base.workflow === 'string' && base.workflow !== S.SCHEDULER && !choices.some((w) => w.file === base.workflow)) choices.push({ file: base.workflow, name: `${base.workflow}（見当たりません）`, state: '?' });
    if (!choices.length) return editor.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'warn' }, '予約できるワークフローがありません（ラボの .github/workflows に、手で始められる workflow_dispatch のものが要ります）。')));
    const sel = (label, opts, value) => { const s = h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: v === value ? 'selected' : null }, t))); s.value = value; return s; };
    const f = {
      workflow: sel('ワークフロー', choices.map((w) => [w.file, w.name === w.file ? w.file : `${w.name}（${w.file}）`]), choices.some((w) => w.file === base.workflow) ? base.workflow : choices[0].file),
      every: sel('いつ', S.EVERY.map((k) => [k, S.EVERY_WORDS[k]]), S.EVERY.includes(base.every) ? base.every : 'day'),
      hours: sel('何時間ごと', S.HOUR_STEPS.map((n) => [String(n), n === 1 ? '毎時' : `${n} 時間ごと`]), String(S.HOUR_STEPS.includes(base.hours) ? base.hours : 1)),
      at: sel('時刻', Array.from({ length: 24 }, (_, k) => `${String(k).padStart(2, '0')}:00`).map((v) => [v, v]), /^([01]\d|2[0-3]):00$/.test(String(base.at ?? '')) ? base.at : '03:00'),
      weekday: sel('曜日', S.WEEKDAYS.map((w, k) => [String(k), `${w}曜`]), String(Number.isInteger(base.weekday) && base.weekday >= 0 && base.weekday <= 6 ? base.weekday : 1)),
      timezone: h('input', { type: 'text', value: typeof base.timezone === 'string' ? base.timezone : localTz(), 'aria-label': '時間帯', placeholder: 'Asia/Tokyo', autocapitalize: 'off' }),
      note: h('input', { type: 'text', value: typeof base.note === 'string' ? base.note : '', 'aria-label': 'メモ', maxlength: 200 }),
      enabled: h('input', { type: 'checkbox', checked: base.enabled !== false, 'aria-label': '動かす' }),
    };
    const rows = { hours: h('div', {}, h('label', {}, '何時間ごと（0 時から）'), f.hours), at: h('div', {}, h('label', {}, '時刻（その時間帯の時計で。その時のうちに始まります）'), f.at), weekday: h('div', {}, h('label', {}, '曜日'), f.weekday) };
    const inputsBox = h('div', {}), preview = h('p', { class: 'muted', id: 'schedulepreview' });
    let form = null;   // (the chosen workflow's inputs: { file, d: M.dispatchInputs's answer, fields })
    const job = () => {
      const every = f.every.value, values = Object.fromEntries(Object.entries(form?.fields ?? {}).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
      return { id: id ?? S.newId(f.workflow.value, st.raw.filter((_, k) => k !== i).map((x) => x?.id)), workflow: f.workflow.value, inputs: M.dispatchBody(form?.d.inputs ?? [], values), every,
        ...(every === 'hour' ? { hours: Number(f.hours.value) } : { at: f.at.value }), ...(every === 'week' ? { weekday: Number(f.weekday.value) } : {}),
        timezone: f.timezone.value.trim(), enabled: f.enabled.checked, ...(f.note.value.trim() ? { note: f.note.value.trim() } : {}) };
    };
    const sync = () => {
      const e = f.every.value;
      rows.hours.hidden = e !== 'hour'; rows.at.hidden = e === 'hour'; rows.weekday.hidden = e !== 'week';
      const c = S.checkJob(job());
      preview.className = c.job ? 'muted' : 'warn';
      preview.replaceChildren(c.job ? `${S.describe(c.job)}・次: ${when(c.job, now())}` : c.errors.join(' / '));
    };
    /** the chosen workflow's inputs as fields (the job's values when it is the job's workflow, else the defaults) */
    const pick = async () => {
      const file = f.workflow.value;
      form = null;
      inputsBox.replaceChildren(h('p', { class: 'muted' }, `${file} の入力を読んでいます…`));
      let d;
      try { d = await inputsOf(file); } catch (e) { if (f.workflow.value === file) { inputsBox.replaceChildren(h('p', { class: 'warn' }, `${file} を読めません: ${e.message}`)); sync(); } return; }
      if (f.workflow.value !== file) return;
      d = { dispatch: Boolean(d?.dispatch), inputs: Array.isArray(d?.inputs) ? d.inputs : [] };
      const keep = base.workflow === file && base.inputs && typeof base.inputs === 'object' && !Array.isArray(base.inputs) ? base.inputs : {}, fields = {};
      const items = d.inputs.map((x) => {
        const v = typeof keep[x.name] === 'string' ? keep[x.name] : String(x.default ?? '');
        const el = x.options?.length ? sel(x.name, x.options.map((o) => [String(o), String(o)]), x.options.map(String).includes(v) ? v : String(x.options[0]))
          : x.type === 'boolean' ? h('input', { type: 'checkbox', checked: v === 'true', 'aria-label': x.name })
            : h('input', { type: 'text', value: v, 'aria-label': x.name });
        el.addEventListener('change', sync);
        fields[x.name] = el;
        return h('div', {}, h('label', {}, `${x.name}${x.required ? '（必須）' : ''}${x.description ? ` — ${x.description}` : ''}`), el);
      });
      const gone = Object.keys(keep).filter((k) => !fields[k]);
      form = { file, d, fields };
      fill(inputsBox,
        d.dispatch ? null : h('p', { class: 'warn' }, `${file} は手で始められません（workflow_dispatch がありません）: 予約できません`),
        S.AI_WORKFLOWS.includes(file) ? h('p', { class: 'warn' }, '始まるたびに、AI の API の料金（ラボの ANTHROPIC_API_KEY / OPENAI_API_KEY の分）を使います。') : null,
        items.length ? [h('h3', {}, '入力'), items] : null,
        gone.length ? h('p', { class: 'muted' }, `${file} にもう無い入力は外します: ${gone.join('・')}`) : null);
      sync();
    };
    const saveBtn = h('button', { class: 'primary', ...gate('dispatch'), onclick: async () => {
      if (!form) return toast('ワークフローの入力をまだ読めていません', true);
      if (!form.d.dispatch) return toast(`${form.file} は手で始められません（workflow_dispatch がありません）`, true);
      const j = job(), miss = form.d.inputs.filter((x) => x.required && !x.default && !(x.name in j.inputs)).map((x) => x.name);
      if (miss.length) return toast(`入力 ${miss.join('・')} が要ります`, true);
      const c = S.checkJob(j);
      if (!c.job) return toast(c.errors.join(' / '), true);
      if (c.job.workflow === HOSTRUN && !may('hostrun')) return toast(`貸し手の Actions で走らせる（${HOSTRUN}）予約は、あなたの役割には許されていません`, true);
      if (S.AI_WORKFLOWS.includes(c.job.workflow) && c.job.enabled && !confirm(aiAsk(c.job))) return;
      const what = `${c.job.workflow}・${S.describe(c.job)}`;
      const r = await save(i === null ? [...st.raw, c.job] : st.raw.map((x, k) => (k === i ? c.job : x)),
        { workflow: c.job.workflow, done: `${i === null ? '予約しました' : '予約を直しました'}: ${what}`, message: `${i === null ? '足す' : '直す'} ${c.job.id}` });
      if (r !== undefined) editor.replaceChildren();
    } }, i === null ? '予約する' : '保存');
    f.workflow.addEventListener('change', pick);
    for (const el of [f.every, f.hours, f.at, f.weekday, f.enabled]) el.addEventListener('change', sync);
    f.timezone.addEventListener('input', sync);
    editor.replaceChildren(h('div', { class: 'card', id: 'scheduleform' }, h('h2', {}, i === null ? '＋ 予約を足す' : `予約を直す${id ? `（${id}）` : ''}`),
      h('label', {}, 'ワークフロー'), f.workflow, inputsBox,
      h('label', {}, 'いつ'), f.every, rows.hours, rows.at, rows.weekday,
      h('label', {}, '時間帯（Asia/Tokyo・UTC など）'), f.timezone,
      h('label', {}, 'メモ（なくてもよい）'), f.note,
      h('label', {}, f.enabled, ' 動かす（外すと、止めたまま残します）'), preview,
      h('div', { class: 'row' }, saveBtn, h('button', { onclick: () => editor.replaceChildren() }, 'やめる'))));
    editor.scrollIntoView?.({ block: 'nearest' });
    await pick();
  };

  const sch = wfs.find((w) => w.file === S.SCHEDULER);
  body.append(h('div', { class: 'card', id: 'schedule' }, h('h2', {}, '⏰ 予約'),
    h('p', { class: 'muted' }, `決めた時刻に、ラボのワークフローを自動で始めます。予約は ${S.SCHEDULE_FILE} に書き、毎時の ${S.SCHEDULER} がラボの Actions で、既定の枝に始めます（パソコンも、だれかのトークンも要りません）。時刻は 1 時間ごとで、GitHub が混んでいると数分〜数十分遅れることがあります。`),
    may('dispatch') ? null : h('p', { class: 'muted' }, '見るだけです: 予約を変えるには、役割に「ワークフローを始める」が要ります。'),
    list,
    h('div', { class: 'row' }, h('button', { class: 'primary', ...gate('dispatch'), onclick: () => open(null) }, '＋ 予約を足す'), h('button', { onclick: reload }, '読み直す'),
      link(`https://github.com/${lab.slug}/blob/${lab.repo?.default_branch ?? 'main'}/${S.SCHEDULE_FILE}`, 'GitHub でファイルを見る'))), editor);
  return load();
}
