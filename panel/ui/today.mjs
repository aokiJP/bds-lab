// today (the top of 「概要」): the things to do now, from what the lab shows — runs still failed, a schedule that does not start,
// old secrets, invitations nobody answered, releases not told, lenders running short — the heaviest first, each with one button
// to the tab where it is mended. Reads only (nothing is written); a part GitHub will not tell is said in one line and the rest is
// still shown.
import { h, failView } from './dom.mjs';
import { todo } from '../lib/today.mjs';
import { readMembers } from '../lib/members.mjs';
import { listReleases } from '../lib/releases.mjs';
import { SCHEDULE_FILE, SCHEDULER } from '../lib/schedule.mjs';
import { checkRules } from '../lib/model.mjs';
import { availability } from '../lib/lendfc.mjs';

const TAB = { runs: '進み具合', schedule: '予約', secrets: '秘密', members: 'メンバー', releases: '配布', hosts: '貸し借り' };

/** the card. ctx: { api, lab: { slug, repo? }, hosts? ([{ slug }] or slugs: the lenders), told? ([tag] of releases already told
 *  to Discord: without it releases are not judged), go?(tab), now? } */
export function todayCard(ctx) {
  const body = h('div', {}, '読んでいます…');
  const root = h('section', { class: 'card', 'data-card': 'today' }, h('h3', {}, '📋 今日やること'), body);
  const draw = async () => {
    const slug = ctx.lab.slug, api = ctx.api, now = ctx.now ?? Date.now(), facts = { now }, missed = [];
    const read = async (what, fn) => { try { return await fn(); } catch (e) { missed.push(`${what}は読めませんでした（${e?.message ?? e}）`); return undefined; } };
    const hosts = (ctx.hosts ?? []).map((x) => (typeof x === 'string' ? x : x?.slug)).filter((x) => typeof x === 'string');
    await Promise.all([
      read('実行', async () => { facts.runs = await api.runs(slug, { per: 50 }); }),
      read('予約', async () => {
        const f = await api.file(slug, SCHEDULE_FILE), runs = await api.runs(slug, { workflow: SCHEDULER, per: 5 }).catch(() => []);
        let broken = false; if (f) { try { JSON.parse(f.text); } catch { broken = true; } }
        facts.schedule = { broken, runs };
      }),
      read('秘密', async () => { facts.secrets = await api.secrets(slug); }),
      read('招待', async () => { facts.invitations = (await readMembers(api, slug, ctx.lab.repo)).invitations; }),
      Array.isArray(ctx.told) ? read('リリース', async () => { facts.releases = await listReleases(api, slug); facts.told = ctx.told; }) : null,
      hosts.length ? read('貸し手', async () => {
        const runsBy = {}, rules = {};
        await Promise.all(hosts.map(async (s) => {
          try { runsBy[s] = await api.runs(s, { workflow: 'host.yml', per: 50 }); } catch (e) { runsBy[s] = e; }
          try { const f = await api.file(s, '.lab-host.json'); rules[s] = f ? checkRules(JSON.parse(f.text)).rules : null; } catch { rules[s] = null; }
        }));
        facts.hosts = availability(runsBy, { now, rules }).map((a) => ({ slug: a.slug, left: a.left }));
      }) : null,
    ]);
    try {
      const list = todo(facts);
      body.replaceChildren(
        list.length === 0 && missed.length === 0 ? h('p', {}, '今日はやることがありません 🎉') : null,
        list.length === 0 && missed.length > 0 ? h('p', {}, '読めたところには、やることはありません。') : null,
        list.length ? h('ul', {}, list.map((x) => h('li', { 'data-todo': x.id },
          h('span', {}, x.say, ' '),
          ctx.go ? h('button', { onclick: () => ctx.go(x.tab) }, `「${TAB[x.tab] ?? x.tab}」を開く`) : h('small', { class: 'muted' }, `（「${TAB[x.tab] ?? x.tab}」の画面で直せます）`)))) : null,
        missed.length ? h('ul', { class: 'muted' }, missed.map((m) => h('li', { class: 'warn' }, m))) : null,
        h('button', { onclick: draw }, '読み直す'));
    } catch (e) { body.replaceChildren(failView(e, draw)); }
  };
  draw();
  root.reload = draw;
  return root;
}
