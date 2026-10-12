// tutorial (「最初のアドオンを 5 分で」): one card that walks a beginner through name → make (unit.yml) → try → give out,
// showing the step they stand on (lib/tutorial.mjs, from the lab's units, unit.yml's runs and releases), what it means in
// plain words and the one button for it. Making and trying go through the lab's policy (ctx.guarded) and the same unit.yml
// calls as ui/workspace.mjs; nothing is read or shown that is secret.
import { h, act, failView } from './dom.mjs';
import * as T from '../lib/tutorial.mjs';
import * as W from '../lib/workspace.mjs';
import * as U from '../lib/units.mjs';
import * as R from '../lib/releases.mjs';
import { startUnit, startAttrs } from './workspace.mjs';

/** the card. ctx: { api (lib/gh.mjs), lab: { slug, repo, role, secrets, workflows }, me, policy, role, guarded?, record?,
 *  dispatch?(workflow, inputs), runUnit?({ job, unit }), go?(tab) } → an element (its .refresh() reads GitHub again) */
export function tutorialCard(ctx0, { unit = '' } = {}) {
  // (startUnit needs ctx.dispatch: GitHub's call alone, the guard is applied once by the caller)
  const ctx = { ...ctx0, dispatch: ctx0.dispatch ?? ((wf, inputs) => ctx0.api.dispatch(ctx0.lab.slug, wf, ctx0.lab.repo?.default_branch ?? 'main', inputs)) };
  const name = h('input', { type: 'text', id: 'tutorial-name', placeholder: 'ruby_sword', autocapitalize: 'off', spellcheck: 'false', value: unit });
  const body = h('div', {}), root = h('div', { class: 'card', id: 'tutorial' }, h('h2', {}, '🎓 最初のアドオンを 5 分で'), body);
  const say = h('p', { class: 'bad', role: 'alert' });
  const dispatch = ctx.dispatch;
  const guard = (action, detail, fn, done) => (ctx.guarded ? ctx.guarded(action, detail, fn, done) : act(fn, done));

  async function look() {
    const u = name.value.trim();
    const [units, runs, releases] = await Promise.all([
      U.listUnits(ctx.api, ctx.lab.slug, { fresh: true }), ctx.api.runs(ctx.lab.slug, { workflow: W.WORKFLOW, per: 10 }).catch(() => []), R.listReleases(ctx.api, ctx.lab.slug).catch(() => []) ]);
    return T.stepOf(T.stateOf({ unit: u, units, runs, releases }));
  }
  async function make() {
    const r = W.newUnitInputs({ unit: name.value, title: '', request: '最初のアドオン（手引きから）' });
    if (r.error) return void say.replaceChildren(r.error);
    if (await U.unitExists(ctx.api, ctx.lab.slug, r.inputs.unit).catch(() => false)) return void paint();
    await guard('dispatch', { workflow: W.WORKFLOW, job: 'new', unit: r.inputs.unit }, () => dispatch(W.WORKFLOW, r.inputs), `${r.inputs.unit} を作り始めました（数分）`);
    await paint();
  }
  const run = (job) => async () => { await (ctx.runUnit ? ctx.runUnit({ job, unit: name.value.trim() }) : startUnit(ctx, { job, unit: name.value.trim() })); await paint(); };

  async function paint() {
    let s;
    try { s = await look(); } catch (e) { body.replaceChildren(failView(e, paint)); return; }
    const steps = T.STEPS.map((st, i) => h('li', { class: i === s.index ? 'on' : i < s.index ? 'past' : '' }, `${i < s.index ? '✅ ' : i === s.index ? '👉 ' : ''}${st.title}`));
    const cur = T.STEPS[s.index], where = startAttrs(ctx), kids = [h('ol', {}, steps), h('p', {}, cur.say)];
    const btn = (label, fn, attrs = {}) => h('button', { class: 'primary', ...attrs, onclick: fn }, label);
    const why = (a) => (a.disabled ? h('p', { class: 'muted' }, `押せません: ${a.title ?? '今は押せません'}`) : null);
    if (s.id === 'name' || s.id === 'make') {
      kids.push(h('label', { for: 'tutorial-name' }, '名前（英小文字・数字・_ の 2〜40 文字）'), name);
      kids.push(h('div', { class: 'row' }, btn(s.id === 'name' ? '名前を決めて作る' : '作る', make, where)), say, why(where));
      if (s.id === 'make') kids.push(h('p', { class: 'muted' }, `${s.unit} はまだ見つかりません: 作っている途中なら、数分あとに「見直す」を押してください。`));
    } else if (s.id === 'try') {
      kids.push(h('p', { class: 'muted' }, s.tried === 'running' ? '試している途中です: 数分あとに「見直す」を押してください。' : s.tried === 'failed' ? '前の試験は通りませんでした: 「進み具合」で理由を読み、直してからもう一度。' : `${s.unit} ができました。次は試験です。`));
      kids.push(h('div', { class: 'row' }, btn('試す', run('test'), where)), why(where));
    } else if (s.id === 'share') {
      kids.push(h('div', { class: 'row' }, btn('仕上げて .mcaddon を作る', run('go'), where)), why(where),
        h('p', { class: 'muted' }, 'できた .mcaddon は実行の成果物に入ります。「リリース」に載せると、友だちにリンクで渡せます。'));
    } else {
      kids.push(h('p', {}, 'これからできること:'), h('ul', {}, T.NEXT.map((x) => h('li', {}, x))));
    }
    kids.push(h('div', { class: 'row' }, h('button', { onclick: paint }, '見直す')));
    body.replaceChildren(...kids);
  }
  root.refresh = paint;
  paint();
  return root;
}
