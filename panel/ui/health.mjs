// health (「概要」's 「健康度」 card and the report): the lab's health as a number and a letter (lib/health.mjs) with the three things
// that would raise it most, each a tap away from where it is mended, and the report for a company as a Markdown file made in
// this page (a Blob and a link with download: sent nowhere). It reads what it needs itself — the lab's newest runs, its secrets'
// ages, the 「準備」 checks, the people (a lab's administrator), the lenders (the owner) — and what this sign-in may not read is
// left out of the score and said so. The card reads again each time it is drawn (a thing just mended shows at once); the report
// makes do with what was read in the last minute.
import { h, toast, act } from './dom.mjs';
import * as H from '../lib/health.mjs';
import * as S from '../lib/setup.mjs';
import * as ST from '../lib/stats.mjs';
import * as MB from '../lib/members.mjs';
import * as G from '../lib/guide.mjs';
import * as P from '../lib/policy.mjs';
import * as M from '../lib/model.mjs';
import { readRuns } from './stats.mjs';

// (what was read, kept per client and lab for whoever asks for a reading no older than it wants — the report, a minute: the
// card always reads again, so a thing just mended shows at once)
const MEMO = new WeakMap();
// (a read this sign-in may not do, or GitHub refuses, or an answer that is not what it should be: not read — null — and the
// score leaves it out)
const safe = async (fn) => { try { return await fn(); } catch { return null; } };
const sync = (fn) => { try { return fn(); } catch { return null; } };

/** what the score and the report are made of → { at, score (lib/health.mjs score), review (the access review; null: the people not
 *  readable), runs, failures (the failed ones among the runs), lending (ctx.lending's answer; null: not the owner's) }. The
 *  reading — the lab's runs, its secrets' ages, the 「準備」 checks, the people (an administrator's), the lenders (the owner's) —
 *  is made again unless one no older than `maxAge` ms (default 0: always) was made; what the panel knows itself (the policy's
 *  errors, the page's version, the policy) is taken as it is now. Never throws. Same ctx as healthCard's */
export async function readFacts(ctx, { fresh = false, maxAge = 0 } = {}) {
  const { api, lab } = ctx, at = ctx.now ?? Date.now(), memo = MEMO.get(api) ?? new Map();
  MEMO.set(api, memo);
  const hit = memo.get(lab.slug), age = hit ? at - hit.at : Infinity;
  let raw = hit?.raw;
  // (a reading from a moment after now — the clock was set back — is no reading)
  if (fresh || !(age >= 0 && age < maxAge)) {
    const [runs, secrets, checks, people, lending] = await Promise.all([
      ctx.runs ? ctx.runs : safe(() => api.runs(lab.slug, { per: 100 })), safe(() => api.secrets(lab.slug)), safe(() => (ctx.checks ? ctx.checks() : S.checks(ctx))),
      lab.role === 'admin' ? safe(() => MB.readMembers(api, lab.slug, lab.repo)) : null, ctx.lending ? safe(() => ctx.lending()) : null]);
    raw = { runs, secrets, checks, people, lending };
    memo.set(lab.slug, { at, raw });
  }
  const { runs, secrets, checks, people, lending } = raw;
  const rs = Array.isArray(runs) ? runs.filter((r) => r && typeof r === 'object') : [], decided = rs.filter((r) => ST.kindOf(r) !== 'other'), must = P.adminsLend(ctx.policy), state = ctx.version?.state;
  const lends = lending ? sync(() => (lending.list ?? []).filter((x) => x.always.ok)) : null, list = Array.isArray(checks) ? checks : null;
  const review = people ? sync(() => G.accessReview({ members: people.members, invitations: people.invitations, runs: rs, owner: people.owner, lending: (lends ?? []).map((x) => x.owner), adminsLend: must, now: at })) : null;
  const score = H.score({
    setupOk: list ? list.filter((c) => c?.ok === true).length : null, setupTotal: list ? list.filter((c) => c?.ok !== null && c?.ok !== undefined).length : null,
    successRate: decided.length ? decided.filter((r) => ST.kindOf(r) === 'ok').length / decided.length : null, policyErrors: ctx.policyErrors ?? null,
    staleSecrets: Array.isArray(secrets) ? sync(() => secrets.filter((x) => M.secretAge(x.updated_at, at).stale).length) : null, flagged: review ? review.flagged : null,
    lendersAlways: lends ? lends.length : null, adminsIdle: lends && must ? sync(() => (lending.idle ?? []).length) : null,
    versionLive: state === 'live' ? true : state === 'newer' || state === 'failed' ? false : null });
  return { at, score, review, runs: rs, failures: rs.filter((r) => ST.kindOf(r) === 'bad'), lending };
}

// (replaceChildren takes nodes, not lists or nulls)
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const tone = (grade) => (grade === 'A' || grade === 'B' ? 'ok' : grade === 'C' ? 'warn' : 'bad');
const tabName = (tab) => G.HELP[tab]?.title ?? tab;

/** the 「健康度」 card for 「概要」: the points, the letter, the three things that would raise it most — each with a button to the
 *  tab where it is mended (ctx.go) — and the eight things with their points under 「数字で見る」. Filled once it has read.
 *  ctx: { api, lab: { slug, repo, role, secrets, workflows }, hosts, me, config, panelUrl, signedInWithApp (as the 「準備」 tab's, for
 *  its checks), policy, policyErrors (policy.mjs, as read), version (the page's: { state, say }), go(tab), reload()? (the page read
 *  again; else location.reload), lending()? (the owner's forkLendingNow: { list, idle }), runs? / checks()? (already read: used
 *  instead of reading), now? (ms: tests only) } */
export function healthCard(ctx) {
  const box = h('div', { class: 'card', id: 'labhealth' }, h('h2', {}, '🩺 ラボの健康度'), h('p', { class: 'muted' }, '測っています…'));
  const draw = (f) => {
    const sc = f.score, up = H.lift(sc, 3);
    fill(box, h('h2', {}, '🩺 ラボの健康度', sc.enough ? h('span', { class: 'chip' }, `評価 ${sc.grade}`) : null),
      sc.enough ? [h('p', {}, h('strong', { class: tone(sc.grade), style: { fontSize: '28px' } }, String(sc.score)), h('span', { class: 'muted' }, ' / 100')),
        h('div', { class: `bar${sc.score < 60 ? ' bad' : sc.score < 75 ? ' warn' : ''}`, role: 'img', 'aria-label': `${sc.score} 点` }, h('i', { style: { width: `${sc.score}%` } }))]
        : h('p', { class: 'muted' }, sc.known ? 'まだ測れません: この役割・設定では、読めた項目が少なすぎます' : 'まだ測れません: この役割では、読めるものがありませんでした'),
      up.length ? h('div', {}, h('h3', {}, '直すと点が上がること'), h('ul', { class: 'plain' }, up.map((x) => h('li', { class: 'row', 'data-factor': x.key },
        h('span', { class: 'grow' }, '⚠️ ', x.say, h('span', { class: 'muted' }, `（+${x.gain} 点）`)),
        x.tab ? h('button', { onclick: () => ctx.go?.(x.tab) }, `「${tabName(x.tab)}」を開く`) : h('button', { onclick: () => (ctx.reload ? ctx.reload() : globalThis.location?.reload()) }, '読み直す')))))
        : sc.enough ? h('p', { class: 'ok' }, '✅ 直すところはありません') : null,
      h('div', { class: 'row' }, h('button', { onclick: () => load(true) }, '測り直す'), h('span', { class: 'muted grow' }, `${sc.known}/${sc.factors.length} 項目で測りました${sc.known < sc.factors.length ? '（この役割・設定で読めないものは数えません）' : ''}`)),
      // (the numbers behind it)
      h('details', {}, h('summary', {}, '📋 数字で見る（点の内訳）'), h('table', {}, h('thead', {}, h('tr', {}, ['項目', '点', '満点', '状況'].map((t) => h('th', {}, t)))),
        h('tbody', {}, sc.factors.map((x) => h('tr', { 'data-factor': x.key }, h('td', {}, x.name), h('td', {}, x.known ? String(x.points) : '—'), h('td', {}, x.known ? String(x.max) : '—'), h('td', { class: x.known && x.points === x.max ? '' : 'muted' }, x.say)))))));
  };
  // (the last picture stays, dimmed, while it is read again)
  const load = (fresh) => act(async () => {
    box.style.opacity = '0.55';
    try { const f = await readFacts(ctx, { fresh }); draw(f); return f; } finally { box.style.opacity = ''; }
  });
  load(false);
  return box;
}

/** each lender's minutes in the last 30 days, an estimate: the forks that lend (the owner sees them all), else the hosts this
 *  account has — their host.yml runs, up to 20 lenders */
async function lendersOf(ctx, facts, at) {
  const lends = sync(() => (facts.lending?.list ?? []).map((x) => ({ slug: x.slug, always: x.always.ok }))) ?? [];
  const list = lends.length ? lends : (ctx.hosts ?? []).filter((x) => x?.repo && !x.error).map((x) => ({ slug: x.slug, always: x.json ? M.alwaysLends(x.json).ok : undefined }));
  const since = new Date(at - 31 * 86_400_000).toISOString().slice(0, 10);
  return Promise.all(list.slice(0, 20).map(async (x) => {
    const rs = await safe(() => readRuns(ctx.api, x.slug, { workflow: 'host.yml', since })), e = rs ? ST.minutesBy(ST.inWindow(rs, { days: 30, tz: 'UTC', now: at }), () => x.slug)[0] : null;
    return { slug: x.slug, always: x.always, runs: rs ? e?.runs ?? 0 : undefined, minutes: rs ? e?.minutes ?? 0 : undefined };
  }));
}

/** 「報告書」: a button that makes the health report (lib/health.mjs report) as a Markdown file for a company — the points, the
 *  access review (an administrator's), the policy, the recent failures, what each lender spent — from what was read in the last
 *  minute (else read again), and then offers it as a download link (a Blob made in this page, sent nowhere). Same ctx as
 *  healthCard's, and tz? (IANA; the date's) */
export function reportButton(ctx) {
  const out = h('span', {});
  let url = null;
  const make = () => act(async () => {
    const now = ctx.now ?? Date.now(), f = await readFacts(ctx, { maxAge: 60_000 }), lenders = await lendersOf(ctx, f, now), date = M.dayOf(new Date(now), ctx.tz ?? ST.localZone());
    const md = H.report({ lab: ctx.lab.slug, date, score: f.score, review: f.review, policy: ctx.policy, policyErrors: ctx.policyErrors, failures: f.failures, lenders });
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    out.replaceChildren(h('a', { class: 'btn', href: url, download: `bds-lab-health-${ctx.lab.slug.replace('/', '_')}-${date}.md` }, '⬇ 報告書（Markdown）をダウンロード'));
    toast('報告書を作りました（ダウンロードのリンクを押してください）');
    return md;
  });
  return h('div', { class: 'row', id: 'healthreport' }, h('button', { onclick: make }, '📄 会社向けの報告書を作る'), out,
    h('span', { class: 'muted' }, '点の内訳・アクセスの見直し・ポリシー・最近の失敗・貸し手の分を、Markdown のファイルに（このブラウザの中だけで作ります）'));
}
