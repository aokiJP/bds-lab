// health: how well the lab is doing, in one number (0–100) and a letter (A–E) — eight things the panel can read, each with its
// points, what it says in words and the tab where it is mended — and the same as a Markdown report for a company (the score, the
// access review, the policy, the failures, the lenders). A thing this sign-in could not read is left out, and the points count only
// what was read. Pure: no DOM, no fetch, no node:.
import { STALE_DAYS } from './model.mjs';
import { HELP } from './guide.mjs';
import { ACTION_WORDS } from './policy.mjs';
import { PERMISSION_WORDS } from './members.mjs';
import { redact } from './debug.mjs';

/** the letters, from the points that earn each (pure): A 90 and up, B 75, C 60, D 40, E below */
export const GRADES = Object.freeze([[90, 'A'], [75, 'B'], [60, 'C'], [40, 'D']]);
/** the letter for a score (pure) */
export const gradeOf = (n) => (GRADES.find(([min]) => n >= min) ?? [0, 'E'])[1];

/** how many of the 100 points what was read must be worth for the score to tell anything: a lab read only for the newest page is
 *  not an A */
export const ENOUGH = 40;

/** the eight things and the most points each can give (100 together), in the order they are shown; tab: where it is mended
 *  (null: by reading the page again) */
export const FACTORS = Object.freeze([
  { key: 'setup', name: '準備', max: 20, tab: 'setup' },
  { key: 'runs', name: '実行の成功', max: 25, tab: 'runs' },
  { key: 'policy', name: 'ポリシー', max: 15, tab: 'members' },
  { key: 'secrets', name: '秘密の古さ', max: 10, tab: 'secrets' },
  { key: 'access', name: 'アクセス', max: 10, tab: 'members' },
  { key: 'lenders', name: '時間を貸す人', max: 10, tab: 'hosts' },
  { key: 'admins', name: '管理者の貸し出し', max: 5, tab: 'hosts' },
  { key: 'version', name: 'ページの版', max: 5, tab: null },
]);
// (what was handed in, or null — "not read": a count is a whole number from 0 or a list; a rate is 0–1; a flag is true or false)
const count = (x) => (Array.isArray(x) ? x.length : typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null);
const rate = (x) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : null);
const flag = (x) => (typeof x === 'boolean' ? x : null);
const pct = (x) => Math.round(x * 100);

/** the lab's health (pure) → { score: 0–100, grade: 'A'–'E', known (how many of the eight were read), enough (what was read is worth
 *  ENOUGH points or more: else the screens do not give the number), factors: [{ key, name, points, max, gain, say, tab, known }] }.
 *  What is handed in (null or left out: not read, and not counted — `max` is 0 for it and `known` false):
 *    setupOk, setupTotal   the 「準備」 checks that are right, of those that could be told (20 points)
 *    successRate           the share of recent runs that passed, 0–1 (25)
 *    policyErrors          what is wrong in .github/bds-lab-panel.json, a count or a list: a broken one allows nothing (15)
 *    staleSecrets          secrets not renewed for STALE_DAYS (10, 3 off for each)
 *    flagged               people the access review says to look at (10, 2 off for each)
 *    lendersAlways         people who lend always: two or more keep the lab going when one stops (10, 5 each)
 *    adminsIdle            administrators who do not lend yet, where the policy says they must (5, 2 off for each)
 *    versionLive           the page is the newest the lab published (5)
 *  score = the points over the points the read things can give, in hundredths; gain = what mending that one adds to the score.
 *  Nothing read: 0, E, known 0, not enough (the screens say they cannot tell) */
export function score(facts = {}) {
  const f = facts ?? {};
  const total = typeof f.setupTotal === 'number' && f.setupTotal >= 1 ? Math.floor(f.setupTotal) : null;
  const done = total !== null && typeof f.setupOk === 'number' && f.setupOk >= 0 ? Math.min(total, Math.floor(f.setupOk)) : null;
  const runs = rate(f.successRate), errors = count(f.policyErrors), stale = count(f.staleSecrets), flagged = count(f.flagged), lenders = count(f.lendersAlways), idle = count(f.adminsIdle), live = flag(f.versionLive);
  // (key → [points, what it says] when it was read, else null)
  const read = {
    setup: done === null ? null : [Math.round((20 * done) / total), done === total ? `準備は全部できています（${done}/${total}）` : `準備ができていないところが ${total - done} 個あります（${done}/${total}）`],
    runs: runs === null ? null : [Math.round(25 * runs), `最近の実行の ${pct(runs)}% が通っています`],
    policy: errors === null ? null : [errors ? 0 : 15, errors ? `ポリシー（.github/bds-lab-panel.json）に誤りが ${errors} 件あります: 直すまでパネルは何も許しません` : 'ポリシー（.github/bds-lab-panel.json）は正しく読めています'],
    secrets: stale === null ? null : [Math.max(0, 10 - 3 * stale), stale ? `${STALE_DAYS} 日以上そのままの秘密が ${stale} 個あります` : '古い秘密はありません'],
    access: flagged === null ? null : [Math.max(0, 10 - 2 * flagged), flagged ? `アクセスの棚卸しで見ておくことが ${flagged} 件あります` : '見直すところのある人はいません'],
    lenders: lenders === null ? null : [Math.min(10, 5 * lenders), lenders >= 2 ? `いつも貸している人が ${lenders} 人います` : lenders === 1 ? 'いつも貸している人は 1 人だけです（2 人以上だと、1 人が止まっても続きます）' : 'いつも貸している人がいません'],
    admins: idle === null ? null : [Math.max(0, 5 - 2 * idle), idle ? `まだいつも貸していない管理者が ${idle} 人います` : '管理者はみんないつも貸しています'],
    version: live === null ? null : [live ? 5 : 0, live ? 'このページはいちばん新しい版です' : 'このページは新しい版ではありません（読み直すか、pages.yml を見てください）'],
  };
  const factors = FACTORS.map((x) => {
    const r = read[x.key];
    return r ? { key: x.key, name: x.name, points: r[0], max: x.max, gain: 0, say: r[1], tab: x.tab, known: true }
      : { key: x.key, name: x.name, points: 0, max: 0, gain: 0, say: '測れませんでした（この役割・この設定では分かりません）', tab: x.tab, known: false };
  });
  const may = factors.reduce((n, x) => n + x.max, 0), got = factors.reduce((n, x) => n + x.points, 0), known = factors.filter((x) => x.known).length;
  for (const x of factors) x.gain = may ? Math.round((100 * (x.max - x.points)) / may) : 0;
  const n = may ? Math.round((100 * got) / may) : 0;
  return { score: n, grade: gradeOf(n), known, enough: may >= ENOUGH, factors };
}

/** what would raise the score most (pure): the things read that are short of their points, the biggest gap first (the order
 *  above on a tie), `n` of them */
export function lift(result, n = 3) {
  return (result?.factors ?? []).map((x, i) => [x, i]).filter(([x]) => x.known && x.points < x.max)
    .sort((a, b) => (b[0].max - b[0].points) - (a[0].max - a[0].points) || a[1] - b[1]).slice(0, n).map(([x]) => x);
}

// ---- the report, in Markdown ----
/** words made safe for a line or a table cell of Markdown (pure): one line, and nothing in it is read as Markdown or HTML — a
 *  run's name, a branch, a login are other people's words — nor anything shaped like a token or a key (debug.mjs redact: taken out
 *  first, before the escaping would hide its shape) */
export const mdText = (s, max = 120) => redact(String(s ?? '')).replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\\`*_[\]<>|~&#]/g, (c) => `\\${c}`);
/** a link, only to an https:// address; any other stays as words (pure) */
export const mdLink = (text, url) => { const u = redact(String(url ?? '')); return /^https:\/\/[^\s<>]+$/.test(u) ? `[${mdText(text)}](${u.replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))})` : mdText(text); };
const tabName = (tab) => HELP[tab]?.title ?? tab;
const dayText = (d) => { const s = d instanceof Date ? (Number.isNaN(d.getTime()) ? '' : d.toISOString()) : String(d ?? ''); return /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : '（不明）'; };
// (a Markdown table; the columns named in `right` are numbers)
const table = (head, rows, right = []) => [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (right.includes(i) ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
const words = (list) => (Array.isArray(list) && list.includes('*') ? 'すべて' : (list ?? []).map((a) => ACTION_WORDS[a] ?? mdText(a)).join('・') || 'なし');

/** the health as a Markdown report for a company (pure; the same inputs, the same text — the date is handed in):
 *    lab        the lab's owner/name (or { slug })          date      'YYYY-MM-DD'
 *    score      score()'s answer                           review    the access review (guide.mjs accessReview's answer)
 *    policy     the lab's policy (policy.mjs), policyErrors  its errors, in words
 *    failures   failed runs (GitHub's, or { name, branch, at, url }), any order: the newest 10 are listed
 *    lenders    [{ slug (or where / name), always, runs, minutes }] — who lends and what it cost them (estimated minutes)
 *  Anything left out is said as not read, never guessed. */
export function report(input) {
  const { lab, date, score: sc, review, policy, policyErrors, failures = [], lenders = [] } = input ?? {};
  const slug = typeof lab === 'string' ? lab : lab?.slug ?? '', out = [];
  out.push('# bds-lab ラボの健康度の報告書', '', `- ラボ: ${slug ? mdText(slug) : '（不明）'}`, `- 日付: ${dayText(date)}`);
  if (sc?.enough) out.push(`- 健康度: **${sc.score} / 100**（評価 **${sc.grade}**）`, `- 測れた項目: ${sc.known} / ${sc.factors.length}`);
  else out.push(sc?.known ? `- 健康度: まだ測れていません（読めた項目が少なすぎます: ${sc.known} / ${sc.factors.length}）` : '- 健康度: まだ測れていません（読めたものがありません）');
  if (sc?.known) {
    out.push('', '## 点の内訳', '', ...table(['項目', '点', '満点', '状況'], sc.factors.map((x) => [mdText(x.name), x.known ? x.points : '—', x.known ? x.max : '—', mdText(x.say, 200)]), [1, 2]));
    const up = lift(sc, 5);
    out.push('', '## 直すと点が上がること', '', ...(up.length ? up.map((x, i) => `${i + 1}. ${mdText(x.say, 200)}（+${x.gain} 点${x.tab ? `・パネルの「${mdText(tabName(x.tab))}」で` : ''}）`) : ['- 直すところはありません']));
  }
  out.push('', '## アクセスの見直し', '');
  if (review?.rows) {
    out.push(review.flagged ? `見ておくこと **${review.flagged}** 件（${review.rows.length} 行）` : `気になるところはありません（${review.rows.length} 行）`, '');
    if (review.rows.length) out.push(...table(['ログイン', '種類', '役割', '最後の実行', '注意'], review.rows.map((x) => [mdText(x.login), mdText(x.kind), mdText(PERMISSION_WORDS[x.role]?.split('（')[0] ?? x.role), mdText(x.last ?? '—'), mdText((x.flags ?? []).join(' / ') || '—')])));
  } else out.push('読めていません（メンバーを読めるのはラボの管理者だけです）。');
  out.push('', '## パネルのポリシー（.github/bds-lab-panel.json）', '');
  if (policy) {
    out.push(...table(['役割', 'できること'], Object.entries(policy.roles ?? {}).map(([r, l]) => [mdText(r), words(l)])), '',
      `- 確かめてから行う操作: ${words(policy.confirm)}`, `- 操作がないときにサインアウトする: ${policy.idleMinutes ? `${policy.idleMinutes} 分` : 'しない'}`,
      `- 監査ログ: ${({ issue: '残す（issue）', off: '残さない', auto: 'auto（非公開のラボなら残す）' })[policy.audit] ?? mdText(policy.audit)}`, `- 管理者はいつも時間を貸す: ${policy.adminsLend ? 'はい' : 'いいえ'}`);
    const teams = Object.entries(policy.teams ?? {});
    if (teams.length) out.push(`- チームの役割: ${teams.map(([t, r]) => `${mdText(t)} → ${mdText(r)}`).join('・')}`);
  } else out.push('読めていません。');
  // (the errors only when they were handed in: not read is not "none")
  if (Array.isArray(policyErrors)) out.push(policyErrors.length ? `- **ポリシーの誤り ${policyErrors.length} 件**（直すまでパネルは何も許しません）: ${policyErrors.map((e) => mdText(e, 200)).join(' / ')}` : '- ポリシーの誤り: なし');
  // (failed runs, the newest first; GitHub's shape or the plain one)
  const fails = (failures ?? []).map((r) => ({ name: r?.name ?? '', branch: r?.head_branch ?? r?.branch ?? '', at: String(r?.created_at ?? r?.at ?? ''), url: r?.html_url ?? r?.url ?? '' })).sort((a, b) => b.at.localeCompare(a.at));
  out.push('', '## 最近の失敗', '');
  if (fails.length) out.push(`落ちた実行 ${fails.length} 件のうち、新しい ${Math.min(10, fails.length)} 件:`, '', ...table(['いつ（UTC）', 'ワークフロー', '枝'], fails.slice(0, 10).map((x) => [mdText(x.at.replace('T', ' ').slice(0, 16) || '—'), mdLink(x.name || '?', x.url), mdText(x.branch || '—')])));
  else out.push('最近の実行に、落ちたものはありません。');
  out.push('', '## 時間を貸している人', '');
  const lend = (lenders ?? []).map((x) => ({ who: x?.slug ?? x?.where ?? x?.name ?? '', always: x?.always, runs: x?.runs, minutes: x?.minutes }));
  if (lend.length) out.push(...table(['貸し手', 'いつも貸す', '実行', '分（見積もり）'], lend.map((x) => [mdText(x.who || '?'), x.always === undefined || x.always === null ? '—' : x.always ? 'はい' : 'いいえ', Number.isFinite(x.runs) ? x.runs : '—', Number.isFinite(x.minutes) ? x.minutes : '—']), [2, 3]));
  else out.push('読めた貸し手はいません。');
  out.push('', '## 点の付け方', '',
    `合計 100 点（${FACTORS.map((x) => `${x.name} ${x.max}`).join('・')}）。読めなかった項目は数えず、読めた項目だけで 100 点に直します（読めた項目の満点が ${ENOUGH} 点に満たないときは、点を出しません）。評価は ${GRADES.map(([m, g]) => `${g}: ${m} 点以上`).join('・')}・E: それより下。`,
    '分は、実行の始まりから最後の更新までを分に切り上げた見積もりです（GitHub の請求そのものではありません）。', '',
    '---', 'この報告書は bds-lab の管理パネルが、GitHub から読めたことだけで作りました。');
  return `${out.join('\n')}\n`;
}
