// node lab.mjs host: GitHub Actions time lent by people (lenders) on their own accounts. A lender makes a private repository
// from host/template (host.yml + .lab-host.json: the minutes a month, the jobs, the hours, the last day), invites this person
// as a collaborator, and the lab — signed in to GitHub as this person, with gh — pushes itself to a lab/run-<id> branch
// there, starts host.yml (workflow_dispatch), waits, takes the result (an artifact), writes the minutes it cost into
// auto/host-ledger.jsonl and deletes the branch. The minutes count to the repository's owner (GitHub bills the owner, not
// the person who started the run); one free account per person and one person per login, so the lab never logs in as a
// lender and never makes accounts. Never sent: secrets (.env, keys), the BDS zip (the runner takes Mojang's own),
// borrowed addons (someone else's), the app lab's runs; AI jobs and accounts never run on a host.
//   host [list] · template [<dir>] · add <owner/repo> · run <job> [-a <unit>] [--on <owner/repo>|auto] [--no-wait] [--dry]
//   results [<request>] · report <owner/repo> [--month YYYY-MM] [--issue [--yes]] · forget <owner/repo> · __job (on the host)
//   ci (hostrun.yml: started from the management panel, in the lab's own Actions, with the person's LAB_HOST_TOKEN)
// LAB_GH: another gh (tests). LAB_HOST_POLL_MS: how often a run is looked at (15 s).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// the hosts and the ledger (auto/: this person's, never shipped by share), the results (.lab: this machine's).
// LAB_HOST_STATE: another folder for all three (tests)
const STATE = () => process.env.LAB_HOST_STATE || path.join(TOP, 'auto');
const HOSTS = () => path.join(STATE(), 'hosts.json'), LEDGER = () => path.join(STATE(), 'host-ledger.jsonl');
const RESULTS = () => (process.env.LAB_HOST_STATE ? path.join(STATE(), 'results') : path.join(TOP, '.lab', 'host-results'));
const shownPath = (f) => { const r = path.relative(TOP, f); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : f; };
export const TEMPLATE = path.join(TOP, 'host', 'template');
export const WORKFLOW = '.github/workflows/host.yml';
// what a host may run: AI-free, account-free (make, harden, app: never). unit: the job needs -a
export const JOBS = {
  gate: { args: ['lab.mjs', 'auto', 'gate'], est: 15, limitMin: 50 },
  'gate-all': { args: ['lab.mjs', 'auto', 'gate', '--all'], est: 40, limitMin: 58 },
  test: { args: (u) => ['lab.mjs', 'test', '-a', u], unit: true, est: 4, limitMin: 30 },
  go: { args: (u) => ['lab.mjs', 'go', '-a', u], unit: true, est: 6, limitMin: 40 },
  sim: { args: (u) => ['lab.mjs', 'sim', '-a', u], unit: true, est: 2, limitMin: 15 },
  upkeep: { args: ['lab.mjs', 'upkeep'], est: 30, limitMin: 58 },
  'dev-bds': { args: ['tests/dev-bds.mjs'], est: 25, limitMin: 58 },
};
export const STOP_AT = 0.8;
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n'); fs.renameSync(t, f); };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

// ---------------------------------------------------------------- the lender's rules (.lab-host.json), pure
/** .lab-host.json → { rules, errors: [..] } */
export function checkRules(j) {
  const e = [];
  if (!j || typeof j !== 'object') return { rules: null, errors: ['.lab-host.json が JSON のオブジェクトではありません'] };
  if (!Number.isInteger(j.minutesPerMonth) || j.minutesPerMonth < 1 || j.minutesPerMonth > 50000) e.push('minutesPerMonth: 1〜50000 の整数');
  if (!Array.isArray(j.jobs) || !j.jobs.length || j.jobs.some((x) => !JOBS[x])) e.push(`jobs: ${Object.keys(JOBS).join(' ')} から（AI とアカウントの要る仕事はありません）`);
  if (j.hours !== undefined && !validHours(j.hours)) e.push('hours: "HH:MM-HH:MM"（例 "09:00-23:00"、日をまたぐ "22:00-06:00" も可）');
  if (j.timezone !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: j.timezone }); } catch { e.push(`timezone: ${j.timezone} は知らない時間帯（例 Asia/Tokyo）`); } }
  if (j.until !== undefined && !/^\d{4}-\d\d-\d\d$/.test(String(j.until))) e.push('until: YYYY-MM-DD');
  if (j.contact !== undefined && (typeof j.contact !== 'string' || j.contact.length > 200)) e.push('contact: 200 文字までの文字');
  return { rules: e.length ? null : { minutesPerMonth: j.minutesPerMonth, jobs: j.jobs, hours: j.hours ?? '00:00-24:00', timezone: j.timezone ?? 'UTC', until: j.until ?? null, contact: j.contact ?? '' }, errors: e };
}
const validHours = (h) => { const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(h)); return Boolean(m) && +m[1] <= 24 && +m[2] < 60 && +m[3] <= 24 && +m[4] < 60 && +m[1] * 60 + +m[2] <= 1440 && +m[3] * 60 + +m[4] <= 1440; };
const parts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
export const monthOf = (d, tz = 'UTC') => { const p = parts(new Date(d), tz); return `${p.year}-${String(p.month).padStart(2, '0')}`; };
export const dayOf = (d, tz = 'UTC') => { const p = parts(new Date(d), tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
/** now within "HH:MM-HH:MM" in the time zone (the end not included; a window over midnight wraps) */
export function within(hours, tz = 'UTC', now = new Date()) {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(hours ?? '00:00-24:00'));
  if (!m) return false;
  const p = parts(now, tz), t = (p.hour % 24) * 60 + p.minute, a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  if (a === b) return true;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

// ---------------------------------------------------------------- the ledger and the hosts
export function readLedger(f = LEDGER()) { let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
export function addLedger(row, f = LEDGER()) { const r = { at: new Date().toISOString(), ...row }; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(r) + '\n'); return r; }
/** requests started and not settled → [{ dispatched row, with its run once it was seen }] */
export function pending(ledger) {
  const done = new Set(ledger.filter((r) => r.state === 'done' || r.state === 'lost').map((r) => r.request));
  const seen = new Map(ledger.filter((r) => r.state === 'running' && r.run).map((r) => [r.request, r.run]));
  return ledger.filter((r) => r.state === 'dispatched' && !done.has(r.request)).map((r) => (seen.has(r.request) && !r.run ? { ...r, run: seen.get(r.request) } : r));
}
/** a host's minutes in a month (its time zone): the runs settled then */
export const used = (ledger, host, month, tz = 'UTC') => ledger.filter((r) => r.host === host && r.state === 'done' && monthOf(r.at, tz) === month).reduce((n, r) => n + (Number(r.minutes) || 0), 0);
/** a host's runs of host.yml as GitHub lists them → the minutes they took in a month of its time zone (each finished run
 *  rounded up to the minute: the floor of what GitHub billed) — everyone's runs, not only this person's: a lender may lend
 *  to more than one, and a lab on a fresh runner (hostrun.yml) has no ledger. The panel counts the same (panel/lib/model.mjs) */
export const monthMinutes = (runs, month, tz = 'UTC') => runs.filter((r) => r.status === 'completed' && monthOf(r.run_started_at ?? r.created_at, tz) === month)
  .reduce((n, r) => n + Math.max(1, Math.ceil((Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 60_000)), 0);
/** what GitHub says of a host this month (pure): { month, used, running } — running: a run of host.yml not finished */
export const githubUse = (runs, now = new Date(), tz = 'UTC') => { const month = monthOf(now, tz); return { month, used: monthMinutes(runs, month, tz), running: runs.some((r) => r.status !== 'completed') }; };
/** a job's minutes as the last runs of it took (5), else the job's own guess */
export function estimate(ledger, job) {
  const reqJob = new Map(ledger.filter((r) => r.state === 'dispatched').map((r) => [r.request, r.job]));
  const past = ledger.filter((r) => r.state === 'done' && reqJob.get(r.request) === job && Number(r.minutes) > 0).slice(-5).map((r) => Number(r.minutes));
  return past.length ? Math.ceil(past.reduce((a, b) => a + b, 0) / past.length) : JOBS[job]?.est ?? 10;
}
/** may this host take this job now (pure) → { ok, why: [..], used, limit, stopAt, remaining, estimate } */
export function canRun(h, job, ledger, now = new Date()) {
  const why = [];
  if (h.withdrawn) why.push(`使えなくなりました（${h.withdrawn.why}、${String(h.withdrawn.at).slice(0, 10)}）`);
  // (as the last look found it: not seen this time, no write access, archived, its rules gone or wrong — the lender may have
  // done that to stop lending: the old rules are not used in their place)
  if (!h.withdrawn && h.unseen) why.push(`今は見えません（${h.unseen.why}）`);
  if (h.push === false) why.push('書き込めません（collaborator の Write が外されました）');
  if (h.archived) why.push('アーカイブされています（貸し手が止めました）');
  if (h.rulesBad) why.push(`貸し手の .lab-host.json が使えません（${h.rulesBad}）: 直るまで使いません`);
  const r = h.rules;
  if (!r) return { ok: false, why: [...why, '.lab-host.json がありません'], used: 0, limit: 0, remaining: 0 };
  // (the minutes: the more of this person's ledger and GitHub's own count of the host's runs this month — the last look's)
  const tz = r.timezone ?? 'UTC', month = monthOf(now, tz), g = h.github?.month === month ? h.github : null;
  const u = Math.max(used(ledger, h.slug, month, tz), Number(g?.used) || 0), stopAt = Math.floor(r.minutesPerMonth * STOP_AT), est = estimate(ledger, job);
  if (r.until && dayOf(now, tz) > r.until) why.push(`期限（${r.until}）を過ぎました`);
  if (!r.jobs.includes(job)) why.push(`${job} は許されていません（許す仕事: ${r.jobs.join(' ')}）`);
  if (!within(r.hours, tz, now)) why.push(`時間帯（${r.hours} ${tz}）の外です`);
  if (pending(ledger).some((p) => p.host === h.slug) || g?.running) why.push('別の仕事が走っています（同じホストで同時に 1 つ）');
  if (u + est > stopAt) why.push(`今月 ${u} 分 + この仕事の見込み ${est} 分が、上限 ${r.minutesPerMonth} 分の 80%（${stopAt} 分）を超えます`);
  return { ok: !why.length, why, used: u, limit: r.minutesPerMonth, stopAt, remaining: Math.max(0, stopAt - u), estimate: est };
}
/** the host for a job: the given one, or the one with the most minutes left (auto) → { host, checks: [{ slug, c }] } */
export function choose(hosts, job, ledger, { on = 'auto', now = new Date() } = {}) {
  const list = Object.entries(hosts).map(([slug, h]) => ({ slug, ...h })).filter((h) => on === 'auto' || h.slug === on);
  const checks = list.map((h) => ({ slug: h.slug, c: canRun(h, job, ledger, now) }));
  const fit = checks.filter((x) => x.c.ok).sort((a, b) => b.c.remaining - a.c.remaining || a.slug.localeCompare(b.slug));
  return { host: fit[0]?.slug ?? null, checks };
}
export const readHosts = () => readJson(HOSTS(), { hosts: {} });
/** one line for `node lab.mjs auto`: each host's minutes this month against its stop, or null with none */
export function hostsSummary(now = new Date()) {
  const H = readHosts(), L = readLedger(), list = Object.entries(H.hosts);
  if (!list.length) return null;
  return list.map(([s, h]) => { const tz = h.rules?.timezone ?? 'UTC', m = monthOf(now, tz); return `${s} ${usedNow(h, s, L, now)}/${Math.floor((h.rules?.minutesPerMonth ?? 0) * STOP_AT)} 分（${m}）${h.withdrawn ? ' ✘ 使えません' : h.unseen || h.push === false || h.archived || h.rulesBad ? ' ⏸ 止まっています' : ''}`; }).join(' · ');
}
const saveHosts = (h) => writeJson(HOSTS(), h);

// ---------------------------------------------------------------- what goes to a host (and what never does)
const NEVER = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, '秘密のファイル（.env）'], [/^bds\/vendor\/.*\.zip$|bedrock[-_]server.*\.zip$/i, 'BDS の zip（Mojang のもの: ランナーが公式から取ります）'],
  [/\.(pem|key|p12|pfx|jks|keystore|ppk)$/i, '鍵のファイル'], [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, 'SSH の鍵'], [/(^|\/)\.(npmrc|netrc|pypirc)$|(^|\/)credentials(\.json)?$/, '認証のファイル'],
  [/\.(apk|apks|xapk|so)$/i, 'APK・.so'], [/^app\/(runs|\.lab)\//, 'app ラボの結果'], [/(^|\/)\.lab\//, 'ラボの手元の記録（.lab）'], [/(^|\/)node_modules\//, 'node_modules'],
  [/^auto\/(hosts\.json|host-ledger\.jsonl|borrowed-seen\.jsonl)$/, 'この PC の記録'], [/(^|\/)github\.token$|(^|\/)\.lab-cache-for$/, '秘密のファイル'],
];
/** files about to be pushed ([[rel, Buffer]]) → [{ rel, why }] for each one that must not go (pure but for the secret scan) */
export async function prePush(files, top = TOP) {
  const bad = [];
  for (const [rel] of files) for (const [re, why] of NEVER) if (re.test(rel)) { bad.push({ rel, why }); break; }
  // someone else's addon (colony harvest / borrow): its imported.json says so
  for (const [rel, buf] of files) if (/^(bds\/addons|end\/plugins|ll\/mods)\/[^/]+\/imported\.json$/.test(rel)) { try { if (JSON.parse(buf.toString('utf8')).borrowed) bad.push({ rel: path.posix.dirname(rel), why: '借りたアドオン（作者のもの: 配りません）' }); } catch { /* not ours to judge */ } }
  // (a unit still being judged, or one whose mark was lost: its name or the original kept in it)
  const { borrowedPath } = await import(pathToFileURL(path.join(TOP, 'common', 'borrow.mjs')).href);
  for (const u of new Set(files.map(([r]) => r).filter(borrowedPath).map((r) => r.split('/').slice(0, 3).join('/')))) if (!bad.some((b) => b.rel === u)) bad.push({ rel: u, why: '借りたアドオン（作者のもの: 配りません）' });
  // (every small file that is text, whatever its name: a unit's .mcfunction or .lang can hold a key as well as a .js)
  const { scan } = await import(pathToFileURL(path.join(TOP, 'common', 'secret-scan.mjs')).href);
  for (const h of scan(files.map(([r, b]) => [r, b]), top, { anyText: true }).filter((x) => !x.warn)) bad.push({ rel: `${h.rel}:${h.line}`, why: `秘密らしいもの（${h.what}）` });
  let total = 0;
  for (const [rel, buf] of files) { total += buf.length; if (buf.length > 50e6) bad.push({ rel, why: `大きすぎます（${(buf.length / 1e6).toFixed(0)} MB）` }); }
  if (total > 200e6) bad.push({ rel: '(全部)', why: `合わせて ${(total / 1e6).toFixed(0)} MB（200 MB まで）` });
  return bad;
}
// the lab's own GitHub files go as they are under another name: GitHub starts nothing from there (a push must start nothing
// but host.yml), and the lab's checks that read its workflows (lint-offline) still find them on the host
export const CARRIED = '.lab-github/';
/** the lab as a release would carry it (share's collect: no units but the samples, no caches, no secrets), its own CI carried
 *  inert, the memory files reset (the gate kept: the person's own list runs there), + the unit asked for + host.yml */
export async function packFiles(unit, top = TOP) {
  const SH = await import(pathToFileURL(path.join(TOP, 'common', 'share.mjs')).href);
  const { policy } = await import(pathToFileURL(path.join(TOP, 'common', 'auto-guard.mjs')).href);
  const { files } = SH.collect(top);
  await SH.resetMemory(files);
  const out = files.map(([r, b, m]) => [r.startsWith('.github/') ? CARRIED + r.slice('.github/'.length) : r, b, m]);
  // (the gate the person set — auto policy gate — is the one the host runs: auto gate reads auto/policy.json there)
  const pol = out.find(([r]) => r === 'auto/policy.json');
  if (pol) { const j = JSON.parse(pol[1].toString('utf8')); pol[1] = Buffer.from(JSON.stringify({ ...j, gate: policy(top).gate }, null, 1) + '\n'); }
  if (unit) {
    const base = `bds/addons/${unit}`, dir = path.join(top, base);
    if (!fs.existsSync(path.join(dir, 'bp', 'manifest.json'))) throw new Error(`${base} がありません`);
    const have = new Set(out.map(([r]) => r));
    // (what share never ships is not sent either: caches, results, .env files, packed files, tsconfig)
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = `${rel}/${e.name}`; if (/^(\.lab|node_modules|dist|build|\.borrowed)$/.test(e.name) || SH.SKIP(r) || SH.SKIP(`${r}/`)) continue; if (e.isSymbolicLink()) continue; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile() && !have.has(r)) out.push([r, fs.readFileSync(path.join(d, e.name)), fs.statSync(path.join(d, e.name)).mode & 0o777]); } };
    walk(dir, base);
  }
  out.push([WORKFLOW, fs.readFileSync(path.join(TEMPLATE, WORKFLOW)), 0o644]);
  return out;
}

// ---------------------------------------------------------------- GitHub, through the person's own gh login
const GH = () => process.env.LAB_GH || 'gh';
// (host ci with the lab's App: a token minted on each host the App is on — a lender's fork — held here, and GH_TOKEN set to
// that host's before anything is asked of it: gh, git push (gh auth git-credential) and the downloads all read GH_TOKEN.
// A host without one: GH_TOKEN as it was given — LAB_HOST_TOKEN in hostrun, the person's own gh login on their computer)
const HOST_TOKENS = new Map();
let BASE_TOKEN;
export function useHost(slug) {
  if (BASE_TOKEN === undefined) BASE_TOKEN = process.env.GH_TOKEN ?? null;
  const t = HOST_TOKENS.get(String(slug ?? '').toLowerCase()) ?? BASE_TOKEN;
  if (t) process.env.GH_TOKEN = t; else delete process.env.GH_TOKEN;
}
// (a rate limit, an organization's SSO sign-in, GitHub or the network down: nothing the lender did — tried again later. A plain
// 403/404 says the repository is gone for this login)
const TEMPORARY = /rate limit|secondary rate|abuse detection|SAML|single sign-on|\bSSO\b|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|HTTP 5\d\d|could not connect|connection (reset|refused)|TLS handshake|i\/o timeout/i;
function gh(args, { input, timeout = 120_000 } = {}) {
  const r = spawnSync(GH(), args, { encoding: 'utf8', input, timeout, maxBuffer: 256e6 });
  const err = `${r.stderr ?? ''}${r.error ? r.error.message : ''}`, failed = r.status !== 0;
  const temp = failed && (TEMPORARY.test(err) || Boolean(r.error));
  return { ok: !failed, out: r.stdout ?? '', err, temp, gone: failed && !temp && /HTTP 40[34]\b|Not Found|Forbidden|Could not resolve to a Repository/i.test(err) };
}
const ghJson = (args) => { const r = gh(args); if (!r.ok) return { r, j: null }; try { return { r, j: JSON.parse(r.out) }; } catch { return { r, j: null }; } };
/** a file on the host's default branch → { text } | { missing } | { temp, why } (whether the repository itself is still there
 *  is repoAccess's question) */
function remoteRead(slug, file) {
  const { r, j } = ghJson(['api', `repos/${slug}/contents/${file}`]);
  if (!r.ok) return r.temp ? { temp: true, why: r.err.trim().split('\n').pop()?.slice(0, 160) } : { missing: true };
  try { return { text: Buffer.from(String(j?.content ?? ''), j?.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8') }; } catch { return { missing: true }; }
}
const remoteFile = (slug, file) => remoteRead(slug, file).text ?? null;
const lf = (s) => String(s).replace(/\r\n/g, '\n');
/** the repository as this person sees it: { ok, push, why, gone } */
function repoAccess(slug) {
  const { r, j } = ghJson(['api', `repos/${slug}`]);
  if (!r.ok) return { ok: false, gone: r.gone, why: r.gone ? '見えません（招待されていない・外された・消された: HTTP 403/404）' : `gh が答えません: ${r.err.trim().split('\n').pop()?.slice(0, 160)}` };
  // (the lab's App token in hostrun — ghs_, minted for this one repository with contents: write — gets no `permissions` back:
  // that it was minted at all is the proof; a person's token always gets them)
  const push = j?.permissions ? Boolean(j.permissions.push) : /^ghs_/.test(String(process.env.GH_TOKEN ?? ''));
  return { ok: true, push, private: Boolean(j?.private), archived: Boolean(j?.archived), fork: Boolean(j?.fork), branch: j?.default_branch ?? 'main' };
}
// 403/404 this many looks in a row: the host is withdrawn (one may be GitHub's own hiccup). Seen again: used again
export const STRIKES = 2;
/** a host looked at again: can this login still see it and push there, is it archived, its rules (read again: missing or wrong
 *  rules pause it — never the old ones in their place). 403/404 twice in a row: withdrawn; seen again: back */
function refresh(H, slug, out) {
  useHost(slug);
  const h = H.hosts[slug], at = new Date().toISOString();
  const a = repoAccess(slug);
  if (!a.ok) {
    h.unseen = { at, why: a.why };
    if (a.gone && !h.withdrawn) {
      h.strikes = (h.strikes ?? 0) + 1;
      if (h.strikes >= STRIKES) { h.withdrawn = { at, why: a.why }; addLedger({ host: slug, state: 'withdrawn', why: a.why }); out(`W ${slug}: ${a.why}（${h.strikes} 回続けて）。このホストはもう使いません（また見えるようになれば使います）`); }
      else out(`W ${slug}: ${a.why}（${h.strikes} 回目: 今回は使いません。次も見えなければ、もう使いません）`);
    } else if (!a.gone) out(`W ${slug}: ${a.why}（今回は使いません: 後でもう一度）`);
    return h;
  }
  if (h.withdrawn) { out(`${slug}: また見えるようになりました（使います）`); addLedger({ host: slug, state: 'back' }); }
  h.withdrawn = null; h.strikes = 0; h.unseen = null;
  h.push = a.push; h.archived = a.archived; h.private = a.private;
  const f = remoteRead(slug, '.lab-host.json');
  if (f.temp) { h.unseen = { at, why: `.lab-host.json を読めません: ${f.why}` }; out(`W ${slug}: ${h.unseen.why}（今回は使いません: 後でもう一度）`); return h; }
  let bad = null;
  if (f.missing) bad = 'ありません';
  else { try { const c = checkRules(JSON.parse(f.text)); if (c.rules) h.rules = c.rules; else bad = c.errors.join(' / '); } catch { bad = 'JSON ではありません'; } }
  if (bad && bad !== h.rulesBad) out(`W ${slug} の .lab-host.json: ${bad}（直るまで、このホストは使いません）`);
  h.rulesBad = bad;
  h.checked = at;
  // GitHub's own count of the month (everyone's runs there): a question GitHub does not answer leaves the ledger alone to count
  if (h.rules) {
    const tz = h.rules.timezone ?? 'UTC', from = new Date(Date.parse(`${monthOf(new Date(), tz)}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const { j } = ghJson(['api', `repos/${slug}/actions/workflows/host.yml/runs?per_page=100&created=${encodeURIComponent(`>=${from}`)}`]);
    h.github = Array.isArray(j?.workflow_runs) ? { ...githubUse(j.workflow_runs, new Date(), tz), at } : null;
  }
  return h;
}
/** a host's minutes this month: the more of the ledger's and GitHub's (as the last look found it) */
const usedNow = (h, slug, L, now = new Date()) => { const tz = h.rules?.timezone ?? 'UTC', m = monthOf(now, tz); return Math.max(used(L, slug, m, tz), h.github?.month === m ? Number(h.github.used) || 0 : 0); };

// ---------------------------------------------------------------- commands
const usage = `usage: node lab.mjs host <command> — GitHub Actions time lent by lenders (docs/guide/host.md)
  host [list]                          the hosts: this month's minutes / the 80% stop / the limit, the jobs, the hours, the last day
  host template [<dir>]                the lender's three files (host.yml, .lab-host.json, README.md) → <dir> (./bds-lab-host)
  host add <owner/repo>                a lender's repository: you can push there, its .lab-host.json is right, its host.yml is the lab's
  host run <job> [-a <unit>] [--on <owner/repo>|auto] [--no-wait] [--dry]   jobs: ${Object.keys(JOBS).join(' ')}
                                       push the lab (and the unit) → start host.yml → wait → the result → the minutes in the ledger
  host results [<request>]             the result of a run (and the runs left unsettled: picked up where they stopped)
  host report <owner/repo> [--month YYYY-MM] [--issue [--yes]]   the month for the lender (numbers only); --issue writes it there
  host forget <owner/repo>             stop using it (nothing changes there)
  host ci                              (hostrun.yml) the job the management panel asked for, on a host, with LAB_HOST_TOKEN`;
function opt(args, k, d = null) { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v ?? d; }
function flag(args, k) { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; }
const newRequest = (now = new Date()) => `r${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${crypto.randomBytes(2).toString('hex')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listCmd(out) {
  const H = readHosts(), L = readLedger(), now = new Date();
  const slugs = Object.keys(H.hosts);
  if (!slugs.length) { out('ホストはまだありません: 貸し手が host/template からリポジトリを作り、あなたを招いたら node lab.mjs host add <owner/repo>（docs/guide/host.md）'); return true; }
  for (const s of slugs) {
    const h = H.hosts[s], r = h.rules, tz = r?.timezone ?? 'UTC', u = usedNow(h, s, L, now);
    out(`${s}${h.withdrawn ? '  ✘ 使えません' : ''}`);
    const paused = [!h.withdrawn && h.unseen ? `今は見えません（${h.unseen.why}）` : null, h.push === false ? '書き込めません' : null, h.archived ? 'アーカイブされています' : null, h.rulesBad ? `.lab-host.json: ${h.rulesBad}` : null].filter(Boolean);
    if (paused.length) out(`  ⏸ ${paused.join(' · ')}（直るまで使いません）`);
    if (r) out(`  今月 ${u} 分 / 止める ${Math.floor(r.minutesPerMonth * STOP_AT)} 分 / 上限 ${r.minutesPerMonth} 分 · 仕事 ${r.jobs.join(' ')} · ${r.hours} ${tz}${r.until ? ` · ${r.until} まで` : ''}${r.contact ? ` · 連絡 ${r.contact}` : ''}`);
    const p = pending(L).filter((x) => x.host === s);
    if (p.length) out(`  走っている: ${p.map((x) => `${x.request} ${x.job}`).join(', ')}（node lab.mjs host results）`);
    if (h.withdrawn) out(`  ${h.withdrawn.why}`);
  }
  return true;
}
function templateCmd(args, out) {
  const dest = path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), args[0] ?? 'bds-lab-host');
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error(`${dest} は空ではありません`);
  fs.cpSync(TEMPLATE, dest, { recursive: true });
  out(`OK ${dest}: README.md（貸し手の手順）・.github/workflows/host.yml・.lab-host.json`);
  out('  貸し手: これを private のリポジトリにして（GitHub のテンプレートにしておくと「Use this template」で作れます）、あなたを collaborator（Write）に招き、.lab-host.json を書く');
  return true;
}
function addCmd(args, out) {
  const slug = args[0];
  if (!SLUG.test(String(slug ?? ''))) throw new Error('host add <owner/repo>（貸し手のリポジトリ）');
  useHost(slug);
  const a = repoAccess(slug);
  if (!a.ok) throw new Error(`${slug}: ${a.why}`);
  if (!a.push) throw new Error(`${slug}: 書き込めません（貸し手に collaborator の Write で招いてもらい、招待を受けてから）`);
  if (a.archived) throw new Error(`${slug}: アーカイブされています（貸し手が戻してから）`);
  const t = remoteFile(slug, '.lab-host.json');
  if (typeof t !== 'string') throw new Error(`${slug}: .lab-host.json がありません（ひな形: node lab.mjs host template）`);
  let j; try { j = JSON.parse(t); } catch { throw new Error(`${slug}: .lab-host.json が JSON ではありません`); }
  const c = checkRules(j);
  if (!c.rules) throw new Error(`${slug}: .lab-host.json: ${c.errors.join(' / ')}`);
  const wf = remoteFile(slug, WORKFLOW), want = sha256(lf(fs.readFileSync(path.join(TEMPLATE, WORKFLOW), 'utf8')));
  if (typeof wf !== 'string') throw new Error(`${slug}: ${WORKFLOW} がありません（ひな形と同じものを既定の枝に: node lab.mjs host template）`);
  if (sha256(lf(wf)) !== want) throw new Error(`${slug}: ${WORKFLOW} がラボのひな形と違います（sha256 ${sha256(lf(wf)).slice(0, 12)} ≠ ${want.slice(0, 12)}）: 貸し手に host/template の host.yml に置き換えてもらう`);
  const H = readHosts();
  H.hosts[slug] = { added: new Date().toISOString(), checked: new Date().toISOString(), rules: c.rules, private: a.private, push: true, archived: false, withdrawn: null, strikes: 0, unseen: null, rulesBad: null };
  saveHosts(H);
  out(`OK ${slug}: 1 か月 ${c.rules.minutesPerMonth} 分（${Math.floor(c.rules.minutesPerMonth * STOP_AT)} 分で止める）· 仕事 ${c.rules.jobs.join(' ')} · ${c.rules.hours} ${c.rules.timezone}${c.rules.until ? ` · ${c.rules.until} まで` : ''}${a.private ? '' : ' · public（押し込む試験も公開になります）'}`);
  out(`次: node lab.mjs host run gate --on ${slug}`);
  return true;
}
function forgetCmd(args, out) {
  const H = readHosts();
  if (!H.hosts[args[0]]) throw new Error(`${args[0]} は登録されていません`);
  delete H.hosts[args[0]]; saveHosts(H);
  out(`OK ${args[0]} を使わなくなりました（記録 auto/host-ledger.jsonl は残します）`);
  return true;
}
/** a dispatched run brought to its end: waited for (or only looked at: wait false), timed, its result taken, the branch
 *  deleted, the ledger written → the done row, or null while it still runs */
async function settle(p, out, { wait = true } = {}) {
  useHost(p.host);
  const poll = Number(process.env.LAB_HOST_POLL_MS) || 15_000, limit = (JOBS[p.job]?.limitMin ?? 60) * 60_000 + 10 * 60_000, t0 = Date.now();
  const findMs = Number(process.env.LAB_HOST_FIND_MS) || 120_000;
  let run = p.run, empty = 0;
  // (started but not seen yet: the branch's run looked for. Only GitHub's own answer "no run" counts towards lost: a question
  // it did not answer — the network, a rate limit — proves nothing)
  for (let k = 0; !run && Date.now() - t0 < Math.min(limit, findMs); k++) {
    const { r, j } = ghJson(['run', 'list', '--repo', p.host, '--workflow', 'host.yml', '--branch', p.branch, '--json', 'databaseId,status,conclusion', '--limit', '1']);
    if (r.ok && Array.isArray(j)) { run = j[0]?.databaseId ?? null; if (!run) empty++; }
    if (!run && !wait && k > 2) break;
    if (!run) await sleep(Math.min(poll, 5000));
  }
  if (!run) {
    // (lost: GitHub said more than once that the branch has no run — waited for here, or ten minutes after the start when only
    // looking — so the host is free again)
    if (empty < 2 || (!wait && Date.now() - Date.parse(p.at) < 10 * 60_000)) { if (wait) out(`W ${p.request}: 実行がまだ見つかりません（${empty ? 'まだ始まっていません' : 'GitHub が答えません'}）: node lab.mjs host results ${p.request}`); return null; }
    gh(['api', '-X', 'DELETE', `repos/${p.host}/git/refs/heads/${p.branch}`]);
    return addLedger({ host: p.host, request: p.request, state: 'lost', why: '実行が見つかりません（host.yml が動かなかった）' });
  }
  // (the run, once seen, is written down: later looks go to it straight, whatever happens to the branch)
  if (!p.run) addLedger({ host: p.host, request: p.request, state: 'running', run });
  let r = null;
  for (;;) {
    const x = ghJson(['api', `repos/${p.host}/actions/runs/${run}`]);
    if (!x.r.ok && x.r.gone) { addLedger({ host: p.host, request: p.request, state: 'lost', run, why: 'ホストが見えなくなりました（403/404）' }); return null; }
    r = x.j;
    if (r?.status === 'completed') break;
    if (!wait || Date.now() - t0 > limit) { if (wait) out(`W ${p.request}: まだ終わっていません（${r?.status ?? '?'}）: node lab.mjs host results ${p.request}`); return null; }
    await sleep(poll);
  }
  // the minutes: what GitHub bills the owner (each job rounded up to the minute), else the run's own length
  const tm = ghJson(['api', `repos/${p.host}/actions/runs/${run}/timing`]).j;
  const billable = Object.values(tm?.billable ?? {}).reduce((n, b) => n + (Number(b.total_ms) || 0), 0);
  const ms = billable || Number(tm?.run_duration_ms) || (r.updated_at && r.run_started_at ? Date.parse(r.updated_at) - Date.parse(r.run_started_at) : 0);
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const dir = path.join(RESULTS(), p.request);
  fs.rmSync(dir, { recursive: true, force: true });
  const dl = gh(['run', 'download', String(run), '--repo', p.host, '-n', `host-result-${p.request}`, '-D', dir], { timeout: 300_000 });
  const res = dl.ok ? readJson(path.join(dir, 'result.json')) : null;
  gh(['api', '-X', 'DELETE', `repos/${p.host}/git/refs/heads/${p.branch}`]);
  return addLedger({ host: p.host, request: p.request, state: 'done', run, conclusion: r.conclusion, ok: Boolean(res?.ok) && r.conclusion === 'success', minutes, ms, summary: (res?.summary ?? []).slice(-3), result: dl.ok ? shownPath(dir) : null });
}
async function settleAll(out, { wait = false } = {}) {
  const done = [];
  for (const p of pending(readLedger())) { const d = await settle(p, out, { wait }); if (d) done.push(d); }
  return done;
}
function showResult(d, out) {
  if (d.state === 'lost') { out(`LOST ${d.request} on ${d.host}: ${d.why}`); return; }
  out(`${d.ok ? 'PASS' : 'FAIL'} ${d.request} on ${d.host}（${d.minutes} 分、${d.conclusion}${d.result ? `、${d.result}/` : '、結果なし'}）`);
  for (const l of d.summary ?? []) out(`  ${l}`);
}
async function runCmd(args, out) {
  const a = [...args];
  const unit = opt(a, '-a'), on = opt(a, '--on', 'auto'), noWait = flag(a, '--no-wait'), dry = flag(a, '--dry');
  const job = a.shift();
  if (!JOBS[job] || a.length) throw new Error(`host run <job> [-a <unit>] [--on <owner/repo>|auto] [--no-wait] [--dry]（job: ${Object.keys(JOBS).join(' ')}）`);
  if (JOBS[job].unit && !/^[a-z0-9_]+$/.test(String(unit ?? ''))) throw new Error(`${job} はユニットが要ります: -a <unit>`);
  if (!JOBS[job].unit && unit) throw new Error(`${job} はラボ全体の仕事です（-a は要りません）`);
  // what was left running first (the same host takes one at a time)
  for (const d of await settleAll(out)) showResult(d, out);
  const H = readHosts();
  for (const s of Object.keys(H.hosts).filter((s) => on === 'auto' || s === on)) refresh(H, s, out);
  saveHosts(H);
  if (on !== 'auto' && !H.hosts[on]) throw new Error(`${on} は登録されていません（node lab.mjs host add ${on}）`);
  const L = readLedger(), pick = choose(H.hosts, job, L, { on });
  if (!pick.host) {
    out(`ホストに頼めません（${job}）:`);
    for (const x of pick.checks) out(`  ${x.slug}: ${x.c.why.join(' / ')}`);
    if (!pick.checks.length) out('  ホストがありません（node lab.mjs host add <owner/repo>）');
    out(`かわりに: 自分の場で node lab.mjs ${JOBS[job].unit ? `${job} -a ${unit}` : job === 'gate' ? 'auto gate' : job === 'gate-all' ? 'auto gate --all' : job === 'dev-bds' ? '（node tests/dev-bds.mjs）' : job}、または自分のリポジトリの Actions`);
    return false;
  }
  const files = await packFiles(unit);
  const bad = await prePush(files);
  const mb = (files.reduce((n, [, b]) => n + b.length, 0) / 1e6).toFixed(1);
  if (bad.length) { out(`STOP 送る前の検査で止めました（何も送っていません）: ${files.length} ファイル ${mb} MB`); for (const b of bad.slice(0, 20)) out(`  ✘ ${b.rel}: ${b.why}`); return false; }
  const req = newRequest(), branch = `lab/run-${req}`, c = pick.checks.find((x) => x.slug === pick.host).c;
  useHost(pick.host);
  out(`${pick.host}: ${job}${unit ? ` -a ${unit}` : ''} · ${files.length} ファイル ${mb} MB · 今月 ${c.used}/${c.stopAt} 分（見込み ${c.estimate} 分）`);
  if (dry) { for (const [r] of files.slice(0, 400)) out(`  ${r}`); out(`（--dry: 送っていません。${branch} に送ります）`); return true; }
  pushTree(files, pick.host, branch);
  const d = gh(['workflow', 'run', 'host.yml', '--repo', pick.host, '--ref', branch, '-f', `job=${job}`, '-f', `unit=${unit ?? ''}`, '-f', `request=${req}`]);
  if (!d.ok) { gh(['api', '-X', 'DELETE', `repos/${pick.host}/git/refs/heads/${branch}`]); throw new Error(`host.yml を始められません: ${d.err.trim().split('\n').pop()?.slice(0, 200)}`); }
  const row = addLedger({ host: pick.host, request: req, job, unit: unit ?? null, state: 'dispatched', branch, run: null });
  out(`started ${req}（${branch}）`);
  if (noWait) { out(`結果: node lab.mjs host results ${req}`); return true; }
  const done = await settle(row, out, { wait: true });
  if (!done) return false;
  showResult({ ...done, host: pick.host }, out);
  return done.ok === true;
}
/** host ci (hostrun.yml, in the lab's own Actions): a job on a lender's host started from the management panel — no computer of
 *  the person's in between. Their own token (secret LAB_HOST_TOKEN → GH_TOKEN) reaches the host; HOST_ON is the host or auto
 *  (the variable LAB_HOSTS' list), each added as `host add` does (the rules, host.yml as the lab's); the minutes are GitHub's
 *  count (a fresh runner has no ledger); then `host run`. The result: the run's summary, an annotation for a failure (notify
 *  tells it to Discord) and HOST_OUT (default hostrun-result/: the artifact, with a go's .mcaddon) */
/** the lab's App's token on each host it is on (APP_ID, APP_PRIVATE_KEY: hostrun.yml with host: auto) → the hosts that got
 *  one; a host without the App is said and left to GH_TOKEN (LAB_HOST_TOKEN). The key is dropped from the environment after */
export async function hostTokens(list, out, E = process.env) {
  if (!E.APP_ID || !E.APP_PRIVATE_KEY) return [];
  const { installationToken } = await import(pathToFileURL(path.join(TOP, 'common', 'ghapp.mjs')).href), got = [];
  try {
    for (const s of list) {
      try {
        const t = await installationToken({ appId: E.APP_ID, pem: E.APP_PRIVATE_KEY, repo: s, permissions: { contents: 'write', actions: 'write', workflows: 'write' }, api: E.GITHUB_API_URL || 'https://api.github.com' });
        out(`::add-mask::${t.token}`);
        HOST_TOKENS.set(s.toLowerCase(), t.token); got.push(s);
      } catch (e) { out(`・ ${s}: ラボの App のトークンはありません（${String(e.message).split('\n')[0]}）${E.GH_TOKEN ? ': LAB_HOST_TOKEN で' : ''}`); }
    }
  } finally { delete E.APP_PRIVATE_KEY; }
  if (got.length) out(`App のトークン: ${got.join(' ')}（1 時間・そのホストだけ・contents・actions・workflows）`);
  return got;
}
async function ciCmd(out) {
  const E = process.env;
  if (!E.GITHUB_ACTIONS && !E.LAB_HOST_CI) throw new Error('host ci は hostrun.yml の中で（手元からは node lab.mjs host run）');
  const job = String(E.HOST_JOB ?? '').trim(), unit = String(E.HOST_UNIT ?? '').trim(), on = String(E.HOST_ON || 'auto').trim(), wait = !/^(false|0|no)$/i.test(String(E.HOST_WAIT ?? ''));
  const list = on === 'auto' ? String(E.LAB_HOSTS ?? '').split(/[\s,]+/).filter(Boolean) : [on];
  if (!list.length) throw new Error('ホストがありません: HOST_ON に owner/repo を、または変数 LAB_HOSTS にホストの一覧を（管理パネルの「実行」）');
  const bad = list.find((s) => !SLUG.test(s));
  if (bad) throw new Error(`${bad} は owner/repo ではありません`);
  // (the lab's App on each host — a lender's fork: its say given to the lab's owner — a token of its own minted there first,
  // masked while workflow commands still count; the App's key gone from this process right after, so nothing it starts has it)
  await hostTokens(list, out);
  if (!E.GH_TOKEN && !HOST_TOKENS.size) throw new Error('ホストへのトークンがありません: 貸し手にラボの GitHub App をホストへ入れてもらう（管理パネルの「準備」のリンク。auto でも、変数 LAB_HOSTS のホストごとに App のトークンを作ります）か、秘密 LAB_HOST_TOKEN（ホストに push でき、ワークフローを始められるあなたのトークン。Classic: repo・workflow / Fine-grained: ホストの Contents・Actions・Workflows を Read and write）を、ラボの Secrets に');
  // (what the run prints is the lab's and the host's words: no line of it is taken as a workflow command)
  const stop = crypto.randomBytes(8).toString('hex'), log = [];
  out(`::stop-commands::${stop}`);
  const say = (l) => { log.push(String(l)); out(l); };
  let ok = false;
  try {
    for (const s of list) { const r = await hostCmd(['add', s], say); if (!r) say(`W ${s}: 使えません（上の理由）`); }
    ok = await hostCmd(['run', job, ...(unit ? ['-a', unit] : []), '--on', on, ...(wait ? [] : ['--no-wait'])], say);
  } finally { out(`::${stop}::`); }
  // the result where the person looks: the run's summary, an annotation when it failed (notify's message carries it)
  const keep = log.filter((l) => /^(PASS|FAIL|LOST|STOP|ERR|started|ホストに頼めません|W |\s{2}\S)/.test(l)).slice(-25);
  const md = [`## ${ok ? '✅' : '❌'} ${job}${unit ? ` -a ${unit}` : ''}（ホスト: ${on}${wait ? '' : '、待たない'}）`, '', '```', ...keep, '```', ''].join('\n');
  if (E.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(E.GITHUB_STEP_SUMMARY, md); } catch { /* the summary is extra */ } }
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  if (!ok) out(`::error title=${esc(`host ${job}`).replace(/[:,]/g, ' ')}::${esc(keep.filter((l) => !/^started/.test(l)).slice(-8).join('\n') || 'ホストで走らせられませんでした')}`);
  // the results this run took (result.json, log.txt, a go's .mcaddon) → HOST_OUT, uploaded as the run's artifact
  const dest = path.resolve(TOP, E.HOST_OUT || 'hostrun-result');
  for (const d of readLedger().filter((r) => r.state === 'done' && r.result)) {
    const src = path.isAbsolute(d.result) ? d.result : path.join(TOP, d.result);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, d.request), { recursive: true });
  }
  return ok;
}
async function resultsCmd(args, out) {
  for (const d of await settleAll(out, { wait: false })) showResult(d, out);
  const L = readLedger(), want = args[0];
  const rows = L.filter((r) => r.state === 'done' || r.state === 'lost');
  const pick = want ? rows.filter((r) => r.request === want).at(-1) : rows.at(-1);
  const still = pending(L);
  if (still.length) out(`まだ走っています: ${still.map((p) => `${p.request} ${p.job} on ${p.host}`).join(', ')}`);
  if (!pick) { if (!still.length) out(want ? `${want} はありません` : '結果はまだありません'); return !want; }
  if (pick.state === 'lost') { out(`LOST ${pick.request} on ${pick.host}: ${pick.why}`); return false; }
  showResult(pick, out);
  if (pick.result) { const r = readJson(path.join(path.isAbsolute(pick.result) ? pick.result : path.join(TOP, pick.result), 'result.json')); if (r?.summary?.length > 3) for (const l of r.summary.slice(0, -3)) out(`  ${l}`); out(`  全部: ${pick.result}/log.txt`); }
  return pick.ok === true;
}
function reportText(slug, month, L, h) {
  const rows = L.filter((r) => r.host === slug), jobOf = new Map(rows.filter((r) => r.state === 'dispatched').map((r) => [r.request, r.job]));
  const tz = h?.rules?.timezone ?? 'UTC', done = rows.filter((r) => r.state === 'done' && monthOf(r.at, tz) === month);
  const by = {};
  for (const d of done) { const j = jobOf.get(d.request) ?? '?'; (by[j] ??= { n: 0, ok: 0, min: 0 }); by[j].n++; by[j].ok += d.ok ? 1 : 0; by[j].min += Number(d.minutes) || 0; }
  const total = done.reduce((n, d) => n + (Number(d.minutes) || 0), 0), lim = h?.rules?.minutesPerMonth ?? null;
  return [`# bds-lab: ${slug} の ${month}（${tz}）`, '', `使った分: ${total} 分${lim ? ` / 上限 ${lim} 分（ラボは ${Math.floor(lim * STOP_AT)} 分で止まります）` : ''}`, `走らせた回数: ${done.length}（成功 ${done.filter((d) => d.ok).length}）`, '',
    '| 仕事 | 回数 | 成功 | 分 |', '|---|---|---|---|', ...Object.entries(by).map(([j, x]) => `| ${j} | ${x.n} | ${x.ok} | ${x.min} |`), '',
    lim ? `残り（止めるまで）: ${Math.max(0, Math.floor(lim * STOP_AT) - total)} 分` : '', '', '（数だけです: ファイルの中身や秘密は入っていません。貸してくださってありがとうございます）'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
async function reportCmd(args, out) {
  const a = [...args], month = opt(a, '--month', null), issue = flag(a, '--issue'), yes = flag(a, '--yes'), slug = a[0];
  const H = readHosts(), h = H.hosts[slug];
  if (!slug || (!h && !readLedger().some((r) => r.host === slug))) throw new Error('host report <owner/repo> [--month YYYY-MM] [--issue [--yes]]');
  const m = month ?? monthOf(new Date(), h?.rules?.timezone ?? 'UTC');
  if (!/^\d{4}-\d\d$/.test(m)) throw new Error('--month YYYY-MM');
  const text = reportText(slug, m, readLedger(), h);
  out(text);
  if (!issue) return true;
  // (written there only after asking: it goes to the lender's repository)
  if (!yes) {
    if (!process.stdin.isTTY && !process.env.LAB_ASK_FILE) throw new Error('Issue に書く前に確かめます: 端末で実行するか --yes');
    const { ask } = await import(pathToFileURL(path.join(TOP, 'common', 'secrets.mjs')).href);
    if (!/^(y|yes|はい)$/i.test(await ask(`${slug} の Issue に書きますか？ [y/N] `))) { out('書きませんでした'); return true; }
  }
  const f = path.join(os.tmpdir(), `bdslab-host-report-${process.pid}.md`);
  fs.writeFileSync(f, text + '\n');
  useHost(slug);
  const r = gh(['issue', 'create', '--repo', slug, '--title', `bds-lab: ${m} の使用量`, '--body-file', f]);
  fs.rmSync(f, { force: true });
  if (!r.ok) throw new Error(`Issue を書けません: ${r.err.trim().split('\n').pop()?.slice(0, 160)}`);
  out(`OK ${r.out.trim().split('\n').pop()}`);
  return true;
}
/** the tree as one commit on the host's work branch (a fresh repository here: only these files, nothing of this repo's
 *  history), pushed with the person's own gh login */
function pushTree(files, slug, branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-host-'));
  // (no automatic gc / maintenance: git can leave one running in the background, still writing into .git while the folder
  // is removed below — ENOTEMPTY on a CI runner)
  const git = (args) => spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], { cwd: dir, encoding: 'utf8', timeout: 600_000, maxBuffer: 64e6 });
  try {
    for (const [rel, buf, mode] of files) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); try { fs.chmodSync(f, mode & 0o111 ? 0o755 : 0o644); } catch { /* no modes */ } }
    git(['init', '-q', '-b', 'main']);
    git(['add', '-A', '-f']);
    const c = git(['-c', 'user.email=bds-lab@localhost', '-c', 'user.name=bds-lab', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `bds-lab host run ${branch}`]);
    if (c.status !== 0) throw new Error(`commit: ${(c.stderr || c.stdout).trim().slice(0, 200)}`);
    const p = git(['-c', 'credential.helper=', '-c', `credential.helper=!${GH()} auth git-credential`, 'push', '-q', '--force', `https://github.com/${slug}.git`, `HEAD:refs/heads/${branch}`]);
    if (p.status !== 0) throw new Error(`push できません: ${(p.stderr || p.stdout).trim().split('\n').pop()?.slice(0, 200)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}

// ---------------------------------------------------------------- on the host (host.yml): the job, the lender's rules first
const REDACT = async () => { const { PATTERNS } = await import(pathToFileURL(path.join(TOP, 'common', 'secret-scan.mjs')).href); return (s) => { let t = String(s); for (const [, re] of PATTERNS) t = t.replace(new RegExp(re.source, 'g'), '[redacted]'); return t.split(TOP).join('.').split(os.homedir()).join('~'); }; };
async function jobCmd(out) {
  const job = process.env.HOST_JOB ?? '', unit = process.env.HOST_UNIT ?? '', req = process.env.HOST_REQUEST ?? '', rf = process.env.HOST_RULES;
  const dir = path.join(TOP, 'host-result');
  fs.mkdirSync(dir, { recursive: true });
  const write = (o, log = '') => { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ request: req, job, unit: unit || null, at: new Date().toISOString(), ...o }, null, 1) + '\n'); fs.writeFileSync(path.join(dir, 'log.txt'), log); };
  const refuse = (why) => { write({ ok: false, refused: why, summary: [`REFUSED ${why}`] }); out(`REFUSED ${why}`); return false; };
  if (!/^r\d{8}-\d{6}-[0-9a-f]{4}$/.test(req)) return refuse('request の形が違います');
  if (!JOBS[job]) return refuse(`知らない仕事 ${job}`);
  if (JOBS[job].unit && !/^[a-z0-9_]+$/.test(unit)) return refuse('ユニットの名前が違います');
  // the lender's rules as their default branch has them: the job, the hours, the last day (the lab checked too; this is theirs)
  const c = checkRules(readJson(rf));
  if (!c.rules) return refuse(`.lab-host.json: ${c.errors.join(' / ')}`);
  const r = c.rules, now = new Date();
  if (!r.jobs.includes(job)) return refuse(`${job} は許されていません`);
  if (!within(r.hours, r.timezone, now)) return refuse(`時間帯 ${r.hours} の外`);
  if (r.until && dayOf(now, r.timezone) > r.until) return refuse(`期限 ${r.until} を過ぎました`);
  const spec = JOBS[job], args = typeof spec.args === 'function' ? spec.args(unit) : spec.args;
  const t0 = Date.now();
  const x = spawnSync(process.execPath, args, { cwd: TOP, encoding: 'utf8', timeout: spec.limitMin * 60_000, killSignal: 'SIGKILL', maxBuffer: 256e6, env: { ...process.env, LAB_NOTRACE: '1' } });
  const red = await REDACT(), log = red(`${x.stdout ?? ''}${x.stderr ?? ''}`);
  const lines = log.split('\n').filter((l) => l.trim());
  const summary = [...lines.filter((l) => /^(PASS|FAIL|DONE|✘|E |ERR )/.test(l)).slice(-12), ...lines.slice(-3)].filter((l, i, a) => a.indexOf(l) === i).slice(-15);
  let version = null; try { version = fs.readFileSync(path.join(TOP, 'VERSION'), 'utf8').trim(); } catch { /* none */ }
  let bds = null; try { bds = fs.readFileSync(path.join(TOP, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { /* none */ }
  write({ ok: x.status === 0, exit: x.status, timedOut: x.error?.code === 'ETIMEDOUT', ms: Date.now() - t0, lab: version, bds, summary }, log.length > 2e6 ? log.slice(-2e6) : log);
  // (a go that packed: the unit's own .mcaddon comes back too)
  if (job === 'go') for (const f of (() => { try { return fs.readdirSync(path.join(TOP, 'bds', 'dist')); } catch { return []; } })().filter((n) => /\.mcaddon$/.test(n))) fs.copyFileSync(path.join(TOP, 'bds', 'dist', f), path.join(dir, f));
  out(summary.join('\n'));
  return x.status === 0;
}

export async function hostCmd(args, out = console.log) {
  const [sub = 'list', ...rest] = args;
  try {
    if (sub === 'list') return listCmd(out);
    if (sub === 'template') return templateCmd(rest, out);
    if (sub === 'add') return addCmd(rest, out);
    if (sub === 'run') return await runCmd(rest, out);
    if (sub === 'results') return await resultsCmd(rest, out);
    if (sub === 'report') return await reportCmd(rest, out);
    if (sub === 'forget') return forgetCmd(rest, out);
    if (sub === 'ci') return await ciCmd(out);
    if (sub === '__job') return await jobCmd(out);
    out(usage); return sub === 'help' || sub === '--help';
  } catch (e) { out(`ERR host ${sub}: ${String(e.message).split('\n')[0]}`); return false; }
}
