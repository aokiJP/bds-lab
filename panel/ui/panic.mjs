// panic (a card): 🛑 the emergency stop — one button that cancels every run still going and turns off, on GitHub, every
// workflow that starts by itself (a schedule, a push, …), after saying what and how many (lib/panic.mjs works it out; pages.yml
// and the like are kept, with the reason). The workflows it turned off are kept in this tab's storage (their ids and file
// names only) and on the 「もとに戻す」 button, which turns on those and no others. Writes go through ctx.guarded:
// 'dispatch' for turning workflows off and on, 'run.cancel' for the runs — once each, so the policy asks once and the audit
// log has one line for each.
import { h, failView, toast } from './dom.mjs';
import * as PN from '../lib/panic.mjs';
import * as P from '../lib/policy.mjs';
import { clock, localZone } from '../lib/stats.mjs';

const KEY = (slug) => `bdslab.panel.panic.${slug}`;
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const names = (xs, n = 6) => `${xs.slice(0, n).join('・')}${xs.length > n ? ` ほか ${xs.length - n} 本` : ''}`;

/** ctx: { api, lab: { slug, role }, policy, role, guarded(action, detail, fn, done), storage? (sessionStorage: the stop's record),
 *  toast?(text, bad) } → the card (an element) */
export function panicCard(ctx) {
  const slug = ctx.lab.slug, say = ctx.toast ?? toast;
  const body = h('div', {}), back = h('div', {}), out = h('div', { role: 'status', 'aria-live': 'polite' });
  const card = h('div', { class: 'card', 'data-panic': slug }, h('h2', {}, '🛑 緊急停止'),
    h('p', { class: 'muted' }, 'おかしなことが起きたとき、1 つのボタンで、いま動いている実行を全部止め、自動で始まるワークフローを GitHub で止めます。あとで「もとに戻す」を押すと、ここで止めたものだけが元どおり動きます。'),
    body, out, back);
  // (may this person do this — and if not, why, in words)
  const role = () => ctx.role ?? ctx.lab.role;
  const allowed = (action) => ctx.lab?.role !== 'read' && P.can(ctx.policy ?? P.DEFAULT_POLICY, role(), action);
  const notAllowed = (action) => `${P.ACTION_WORDS[action]}は、あなたの役割には許されていません（管理者に頼んでください）`;
  // (the record of what the stop turned off: this tab's storage, else this card's memory)
  let memo = null;
  const readRecord = () => { try { const s = ctx.storage?.getItem(KEY(slug)); if (s) return JSON.parse(s); } catch { /* the memory below */ } return memo; };
  const writeRecord = (r) => { memo = r?.disabled?.length ? r : null; try { if (memo) ctx.storage?.setItem(KEY(slug), JSON.stringify(memo)); else ctx.storage?.removeItem(KEY(slug)); } catch { /* the memory alone */ } };
  let now = null, busy = false;

  const when = (ms) => { const c = clock(ms, localZone()); return c ? `${Number(c.day.slice(5, 7))}月${Number(c.day.slice(8))}日 ${c.hour} 時ごろ` : ''; };
  function drawBack() {
    const r = readRecord();
    if (!r?.disabled?.length) { fill(back); return; }
    const ok = allowed('dispatch'), ids = r.disabled.map((x) => String(x.id));
    const go = h('button', { class: 'primary', 'data-workflows': ids.join(','), disabled: !ok || busy, title: ok ? '' : notAllowed('dispatch'), onclick: restore },
      `↩️ もとに戻す（${names(r.disabled.map((x) => x.name))} を動かす）`);
    fill(back, h('div', { class: 'row' }, h('p', {}, `${when(r.at)}に緊急停止で止めたワークフロー: ${r.disabled.length} 本`), go, ok ? null : h('span', { class: 'muted' }, ` ${notAllowed('dispatch')}`)));
  }

  async function load() {
    fill(body, h('p', { class: 'muted' }, 'いま動いているものを調べています…'));
    drawBack();
    try {
      const [wfs, ...lists] = await Promise.all([ctx.api.workflows(slug), ...['in_progress', 'queued', 'waiting'].map((status) => ctx.api.runs(slug, { per: 100, status }))]);
      const runs = [...new Map(lists.flat().map((r) => [r.id, r])).values()];
      // (what starts each workflow: its file, read only for the ones that might be turned off)
      const withTriggers = await Promise.all(wfs.map(async (w) => {
        if (w.state !== 'active' || PN.KEEP_FILES[String(w.path).split('/').pop()] || !String(w.path ?? '').startsWith('.github/workflows/')) return w;
        try { return { ...w, triggers: PN.triggersOf((await ctx.api.file(slug, w.path))?.text ?? '') }; } catch { return w; }
      }));
      now = { runs, wfs: withTriggers, plan: PN.plan(runs, withTriggers) };
    } catch (e) { fill(body, failView(e, load)); return; }
    draw();
  }

  function draw() {
    const { plan, runs, wfs } = now;
    const wfName = new Map(wfs.map((w) => [w.id, String(w.path ?? '').split('/').pop() || w.name]));
    const runName = new Map(runs.map((r) => [r.id, r.display_title ?? r.name ?? String(r.id)]));
    const mayCancel = allowed('run.cancel'), mayOff = allowed('dispatch');
    const can = (plan.cancel.length && mayCancel) || (plan.disable.length && mayOff);
    const why = !plan.cancel.length && !plan.disable.length ? 'いま止めるものはありません（動いている実行も、自動で始まるワークフローもありません）'
      : !can ? `${!mayCancel ? notAllowed('run.cancel') : ''}${!mayCancel && !mayOff ? '・' : ''}${!mayOff ? notAllowed('dispatch') : ''}` : null;
    const parts = [
      h('ul', { class: 'plain' },
        h('li', {}, `▶️ 動いている実行: ${plan.cancel.length} 件${plan.cancel.length ? `（${names(plan.cancel.map((id) => runName.get(id)), 4)}）` : ''}${plan.cancel.length && !mayCancel ? ` — ${notAllowed('run.cancel')}` : ''}`),
        h('li', {}, `⏰ 自動で始まるワークフロー: ${plan.disable.length} 本${plan.disable.length ? `（${names(plan.disable.map((id) => wfName.get(id)))}）` : ''}${plan.disable.length && !mayOff ? ` — ${notAllowed('dispatch')}` : ''}`)),
      plan.keep.length ? h('details', {}, h('summary', {}, `止めないもの（${plan.keep.length}）`),
        h('ul', { class: 'plain' }, plan.keep.map((k) => h('li', { 'data-keep': String(k.id) }, `${k.kind === 'run' ? '▶️' : '⏰'} ${k.name} — ${k.why}`)))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: Boolean(why) || busy, title: why ?? '', onclick: ask }, '🛑 全部止める'),
        ' ', h('button', { disabled: busy, onclick: load }, '調べ直す')),
      why ? h('p', { class: 'muted' }, why) : null,
    ];
    fill(body, ...parts);
  }

  // (the confirmation: what and how many, said once more, before anything is sent)
  function ask() {
    const { plan } = now, mayCancel = allowed('run.cancel'), mayOff = allowed('dispatch');
    const n = mayCancel ? plan.cancel.length : 0, m = mayOff ? plan.disable.length : 0;
    fill(out, h('div', { class: 'warn', role: 'alert' },
      h('p', {}, h('strong', {}, `本当に止めますか？ 実行 ${n} 件を止め、ワークフロー ${m} 本を自動で始まらないようにします。`)),
      h('p', { class: 'muted' }, '止めた実行は途中で終わり、続きからは戻せません。ワークフローは「もとに戻す」でまた動きます。'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: stop }, `はい、止める（実行 ${n} 件・ワークフロー ${m} 本）`), ' ', h('button', { onclick: () => fill(out) }, 'やめる'))));
  }

  async function stop() {
    if (busy || !now) return;
    busy = true; fill(out, h('p', { class: 'muted' }, '止めています…')); draw();
    const { plan, wfs } = now, wfName = new Map(wfs.map((w) => [w.id, String(w.path ?? '').split('/').pop() || w.name]));
    const said = [], fails = [];
    try {
      // (the workflows first: nothing new starts while the runs are being cancelled)
      if (plan.disable.length && allowed('dispatch')) {
        const r = await ctx.guarded('dispatch', { name: '緊急停止', workflows: plan.disable.length }, async () => {
          let ok = 0; const bad = [];
          for (const id of plan.disable) {
            try {
              await ctx.api.disableWorkflow(slug, id); ok++;
              // (kept at once: a stop cut short can still be undone for what it did)
              const rec = readRecord() ?? { at: Date.now(), disabled: [] };
              if (!rec.disabled.some((x) => String(x.id) === String(id))) rec.disabled.push({ id, name: wfName.get(id) ?? String(id) });
              writeRecord(rec);
            } catch (e) { bad.push({ name: wfName.get(id) ?? String(id), e }); }
          }
          if (!ok && bad.length) throw bad[0].e;
          return { ok, bad };
        });
        if (r) { said.push(`ワークフロー ${r.ok} 本を止めました`); fails.push(...r.bad); }
      }
      if (plan.cancel.length && allowed('run.cancel')) {
        const r = await ctx.guarded('run.cancel', { name: '緊急停止', runs: plan.cancel.length }, async () => {
          let ok = 0, gone = 0; const bad = [];
          for (const id of plan.cancel) {
            // (409: the run ended by itself meanwhile — nothing left to stop)
            try { await ctx.api.cancel(slug, id); ok++; } catch (e) { if (e?.status === 409) gone++; else bad.push({ name: `実行 ${id}`, e }); }
          }
          if (!ok && !gone && bad.length) throw bad[0].e;
          return { ok, gone, bad };
        });
        if (r) { said.push(`実行 ${r.ok} 件を止めました${r.gone ? `（${r.gone} 件は、その前にもう終わっていました）` : ''}`); fails.push(...r.bad); }
      }
    } finally { busy = false; }
    fill(out,
      said.length ? h('p', {}, `✅ ${said.join('・')}`) : h('p', { class: 'bad' }, '何も止められませんでした（上の知らせを見てください）'),
      fails.map((f) => h('div', {}, h('p', {}, `⚠️ ${f.name} は止められませんでした:`), failView(f.e, load))));
    if (said.length) say(said.join('・'));
    await load();
  }

  async function restore() {
    const rec = readRecord();
    if (busy || !rec?.disabled?.length) return;
    busy = true; drawBack();
    let r;
    try {
      // (as they are now: one turned on meanwhile, or gone, is passed over)
      let wfs = null; try { wfs = await ctx.api.workflows(slug); } catch { /* all of them, then */ }
      const rp = PN.restorePlan(rec, wfs);
      const nameOf = new Map(rec.disabled.map((x) => [String(x.id), x.name]));
      r = await ctx.guarded('dispatch', { name: '緊急停止をもとに戻す', workflows: rp.enable.length }, async () => {
        let ok = 0; const bad = [];
        for (const id of rp.enable) {
          try { await ctx.api.enableWorkflow(slug, id); ok++; const left = readRecord(); if (left) writeRecord({ ...left, disabled: left.disabled.filter((x) => String(x.id) !== String(id)) }); }
          catch (e) { bad.push({ name: nameOf.get(String(id)) ?? String(id), e }); }
        }
        if (!ok && bad.length) throw bad[0].e;
        return { ok, bad };
      });
      if (r) {
        // (passed over: already going again, or gone — nothing left to do for them)
        const left = readRecord(), skipped = new Set(rp.skip.map((x) => String(x.id)));
        if (left) writeRecord({ ...left, disabled: left.disabled.filter((x) => !skipped.has(String(x.id))) });
        fill(out, h('p', {}, `↩️ ワークフロー ${r.ok} 本をまた動くようにしました${rp.skip.length ? `（${rp.skip.map((x) => `${x.name}: ${x.why}`).join('・')}）` : ''}`),
          r.bad.map((f) => h('div', {}, h('p', {}, `⚠️ ${f.name} は戻せませんでした:`), failView(f.e, restore))));
        say(`ワークフロー ${r.ok} 本をもとに戻しました`);
      }
    } finally { busy = false; }
    await load();
  }

  load();
  return card;
}
