// model: what the panel knows and decides, pure (no DOM, no fetch) — so tests/panel-offline.mjs runs it in Node.
// Who may use the panel (GitHub decides: a token's permissions on the lab's repository or on a host), what each repository's
// own settings let its people do (its secrets' names, its workflows, its visibility), the forms of its workflows' inputs
// (read from their YAML), a run's progress, and a host's rules and minutes (the lender's .lab-host.json; the same checks as
// common/hosts.mjs — the test holds them equal).

// ---- who: the token's permissions on a repository → a role ----
/** GitHub's permissions of a repository for the token's user → 'admin' | 'write' | 'read' | null */
export function roleOf(perm) {
  if (!perm) return null;
  if (perm.admin) return 'admin';
  if (perm.maintain || perm.push) return 'write';
  if (perm.pull || perm.triage) return 'read';
  return null;
}
export const ROLE_NAMES = { admin: '管理者', write: '書き込みできる人', read: '見るだけ', lender: '貸し手', borrower: '借り手' };
/** may this person use the panel: they can write to the lab's repository, or they lend or borrow a host (GitHub Actions
 *  minutes) → { ok, as: [..], why } */
export function access({ lab, hosts = [] }) {
  const as = [];
  const lr = roleOf(lab?.permissions);
  if (lr === 'admin' || lr === 'write') as.push(lr === 'admin' ? 'admin' : 'write');
  for (const h of hosts) { const r = roleOf(h.permissions); if (r === 'admin') as.push('lender'); else if (r === 'write') as.push('borrower'); }
  const uniq = [...new Set(as)];
  return uniq.length ? { ok: true, as: uniq, why: '' } : { ok: false, as: [], why: 'このパネルは、ラボのリポジトリに書き込める人と、GitHub Actions の時間を貸している人（ホストの持ち主）・借りている人だけが使えます。このトークンではどちらでもありません' };
}

// ---- what a repository's own settings allow (its secrets' names; the values are never read) ----
export const KNOWN_SECRETS = {
  DISCORD_BOT_TOKEN: 'Discord のボットのトークン（DM の画面とボタン・通知・秘密のフォーム）',
  DISCORD_USER_ID: '自分の Discord のユーザー ID（数字）',
  LAB_SECRETS_TOKEN: '秘密を書けるトークン（secrets ワークフローが使う。Secrets: Read and write）',
  LAB_NOTIFY_WEBHOOK: 'Discord / Slack の Webhook URL か ntfy.sh（通知の別の行き先）',
  APP_PRIVATE_KEY: 'ラボの GitHub App の鍵（「準備」が App を作るときに入れる。ワークフローが 1 時間のトークンを作る）',
  APP_CLIENT_SECRET: 'ラボの GitHub App の client secret（サインインのサービスが使う。「準備」が入れる）',
  AUTH_STATE_SECRET: 'サインインのサービスが受け渡しに署名する鍵（「準備」が作って入れる）',
  CLOUDFLARE_API_TOKEN: 'サインインのサービスを Cloudflare Workers に置くトークン（auth-deploy）',
  CLOUDFLARE_ACCOUNT_ID: 'その Cloudflare のアカウントの ID',
  LAB_HOST_TOKEN: '貸し手のホストに push でき、ワークフローを始められるあなたのトークン（「実行」でホストの Actions を使う: hostrun）',
  MS_EMAIL: '端末のゲームをサインインさせる Microsoft アカウント',
  MS_PASSWORD: 'そのパスワード（無ければ人の承認を 1 回）',
  GOOGLE_EMAIL: 'Minecraft を買った Google アカウント（APK を取る）',
  GOOGLE_AAS_TOKEN: 'その AAS トークン（node lab.mjs app token）',
  APP_CACHE_KEY: 'キャッシュと公開リポジトリのライブを封じる鍵',
};
/** a repository's settings → what can be done there: [{ key, label, ok, need }] (need: what is missing, in words) */
export function capabilities({ secrets, workflows = [], visibility = 'public', host = false, vars = null }) {
  const has = (n) => Array.isArray(secrets) && secrets.includes(n), wf = (f) => workflows.some((w) => String(w.path ?? w).endsWith(`/${f}`));
  // (the lab's GitHub App: its id a variable, its key a secret — the workflows then take an hour's App token, no one's own)
  const app = has('APP_PRIVATE_KEY') && Array.isArray(vars) && vars.includes('APP_ID');
  const known = Array.isArray(secrets);
  const c = (key, label, ok, need) => ({ key, label, ok: known ? Boolean(ok) : null, need: known ? (ok ? '' : need) : '秘密の名前を見られません（トークンに Secrets: Read が要ります）' });
  if (host) return [c('host', 'ラボの試験を走らせる（host.yml）', wf('host.yml'), 'host.yml がありません（node lab.mjs host template）')];
  const discord = has('DISCORD_BOT_TOKEN') && has('DISCORD_USER_ID');
  return [
    c('discord', 'Discord の DM で端末を操作（mode hold）', discord && wf('app.yml'), [!has('DISCORD_BOT_TOKEN') && 'DISCORD_BOT_TOKEN', !has('DISCORD_USER_ID') && 'DISCORD_USER_ID', !wf('app.yml') && 'app.yml'].filter(Boolean).join('・') + ' が要ります'),
    c('notify', '進み具合を Discord に知らせる（notify）', (discord || has('LAB_NOTIFY_WEBHOOK')) && wf('notify.yml'), !wf('notify.yml') ? 'notify.yml がありません' : 'DISCORD_BOT_TOKEN + DISCORD_USER_ID か LAB_NOTIFY_WEBHOOK が要ります'),
    c('secretsForm', '秘密を Discord のフォームで登録（secrets）', discord && (app || has('LAB_SECRETS_TOKEN')) && wf('secrets.yml'), [!discord && 'Discord の 2 つ', !app && !has('LAB_SECRETS_TOKEN') && 'ラボの App（「準備」）か LAB_SECRETS_TOKEN', !wf('secrets.yml') && 'secrets.yml'].filter(Boolean).join('・') + ' が要ります（このパネルの「秘密」からなら、どれも要りません）'),
    c('hostrun', '貸し手の Actions で走らせる（hostrun: パソコンなしで）', (app || has('LAB_HOST_TOKEN')) && wf('hostrun.yml'), [!app && !has('LAB_HOST_TOKEN') && 'ラボの App（「準備」: 貸し手がホストに入れる）か LAB_HOST_TOKEN', !wf('hostrun.yml') && 'hostrun.yml'].filter(Boolean).join('・') + ' が要ります'),
    c('app', '本物のアプリで確かめる（app）', has('GOOGLE_EMAIL') && has('GOOGLE_AAS_TOKEN') && wf('app.yml'), 'GOOGLE_EMAIL・GOOGLE_AAS_TOKEN が要ります（node lab.mjs app secrets）'),
    c('signin', 'ゲームを Microsoft でサインイン（フレンドのワールド）', has('MS_EMAIL'), 'MS_EMAIL（と MS_PASSWORD）が要ります'),
    c('vault', visibility === 'public' ? '公開リポジトリのライブを封じる・キャッシュ' : '端末のキャッシュ（暗号化）', has('APP_CACHE_KEY') || has('GOOGLE_AAS_TOKEN'), 'APP_CACHE_KEY か GOOGLE_AAS_TOKEN が要ります'),
  ];
}

// ---- a workflow's inputs, from its YAML (the part under on: workflow_dispatch: inputs:) ----
const unq = (s) => { const t = String(s ?? '').trim(); return /^'.*'$/.test(t) ? t.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(t) ? JSON.parse(t) : t; };
const list = (s) => String(s).trim().replace(/^\[|\]$/g, '').split(',').map((x) => unq(x)).filter((x) => x !== '');
/** YAML text → { dispatch: bool, inputs: [{ name, description, default, type, options, required }] } — the subset the lab's
 *  workflows are written in (block mappings, inline or block lists, quoted or plain scalars, comments) */
export function dispatchInputs(yaml) {
  const lines = String(yaml ?? '').split(/\r?\n/).map((l) => l.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '')).filter((l) => l.trim());
  const ind = (l) => l.length - l.trimStart().length;
  let i = lines.findIndex((l) => /^on:\s*$/.test(l) || /^on:\s*\S/.test(l) || /^"on":/.test(l));
  if (i < 0) return { dispatch: false, inputs: [] };
  // (on: workflow_dispatch on one line, or [push, workflow_dispatch])
  if (/^on:\s*\S/.test(lines[i])) return { dispatch: /workflow_dispatch/.test(lines[i]), inputs: [] };
  const onInd = ind(lines[i]);
  let wd = -1;
  for (let k = i + 1; k < lines.length && ind(lines[k]) > onInd; k++) if (/^\s*workflow_dispatch:/.test(lines[k])) { wd = k; break; }
  if (wd < 0) return { dispatch: false, inputs: [] };
  const wdInd = ind(lines[wd]);
  let ip = -1;
  for (let k = wd + 1; k < lines.length && ind(lines[k]) > wdInd; k++) if (/^\s*inputs:\s*$/.test(lines[k])) { ip = k; break; }
  if (ip < 0) return { dispatch: true, inputs: [] };
  const ipInd = ind(lines[ip]), inputs = [];
  let cur = null, nameInd = -1, inOptions = false;
  for (let k = ip + 1; k < lines.length && ind(lines[k]) > ipInd; k++) {
    const l = lines[k], d = ind(l), t = l.trim();
    if (nameInd < 0) nameInd = d;
    if (d === nameInd) { const m = /^([\w-]+):\s*(\{.*\})?$/.exec(t); if (!m) continue; cur = { name: m[1], description: '', default: '', type: 'string', options: [], required: false }; inputs.push(cur); inOptions = false;
      if (m[2]) for (const part of m[2].slice(1, -1).split(/,(?![^[]*\])/)) { const kv = /^\s*(\w+):\s*(.*)$/.exec(part); if (kv) setKey(cur, kv[1], kv[2]); }
      continue; }
    if (!cur) continue;
    if (inOptions && /^- /.test(t)) { cur.options.push(unq(t.slice(2))); continue; }
    const kv = /^(\w+):\s*(.*)$/.exec(t);
    if (kv) { inOptions = kv[1] === 'options' && !kv[2]; setKey(cur, kv[1], kv[2]); }
  }
  return { dispatch: true, inputs };
}
function setKey(cur, k, v) {
  if (k === 'options') { if (String(v).trim()) cur.options = list(v); return; }
  if (k === 'required') { cur.required = /^true$/i.test(String(v).trim()); return; }
  if (k === 'description' || k === 'default' || k === 'type') cur[k] = unq(v);
}
/** the form's values → what workflow_dispatch takes (strings; booleans as "true"/"false"; empty ones left to their default) */
export function dispatchBody(inputs, values) {
  const out = {};
  for (const i of inputs) {
    const v = values[i.name];
    if (v === undefined || v === '' || v === null) continue;
    out[i.name] = i.type === 'boolean' ? String(v === true || v === 'true') : String(v);
  }
  return out;
}

// ---- a run's progress ----
/** a run and its jobs (GitHub's) → { state, done, total, pct, now, ms, jobs: [{ name, state, done, total, now }] } */
export function progress(run, jobs = [], nowMs = Date.now()) {
  const st = (x) => (x.status === 'completed' ? x.conclusion ?? 'completed' : x.status);
  const js = jobs.map((j) => {
    const steps = j.steps ?? [], done = steps.filter((s) => s.status === 'completed').length, cur = steps.find((s) => s.status === 'in_progress');
    return { name: j.name, state: st(j), done, total: steps.length, now: cur?.name ?? '', url: j.html_url };
  });
  const done = js.reduce((n, j) => n + j.done, 0), total = js.reduce((n, j) => n + j.total, 0);
  const t0 = Date.parse(run.run_started_at ?? run.created_at), t1 = run.status === 'completed' ? Date.parse(run.updated_at) : nowMs;
  return { state: st(run), done, total, pct: run.status === 'completed' ? 100 : total ? Math.round((done / total) * 100) : 0, now: js.find((j) => j.now)?.now ?? '', ms: Number.isFinite(t0) ? Math.max(0, t1 - t0) : 0, jobs: js };
}
export const STATE_ICON = { success: '✅', failure: '❌', cancelled: '⏹️', skipped: '⏭️', timed_out: '⌛', action_required: '✋', neutral: '➖', startup_failure: '💥', in_progress: '🔄', queued: '⏳', waiting: '⏳', pending: '⏳', requested: '⏳' };
export function fmtMs(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s} 秒` : s < 3600 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${Math.floor(s / 3600)} 時間 ${Math.floor((s % 3600) / 60)} 分`; }
export function ago(iso, nowMs = Date.now()) { const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分前` : s < 86400 ? `${Math.floor(s / 3600)} 時間前` : `${Math.floor(s / 86400)} 日前`; }

// ---- hosts: the lender's rules and the minutes this month (as common/hosts.mjs reads them) ----
export const HOST_JOBS = ['gate', 'gate-all', 'test', 'go', 'sim', 'upkeep', 'dev-bds'];
export const STOP_AT = 0.8;
const validHours = (h) => { const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(h)); return Boolean(m) && +m[1] <= 24 && +m[2] < 60 && +m[3] <= 24 && +m[4] < 60 && +m[1] * 60 + +m[2] <= 1440 && +m[3] * 60 + +m[4] <= 1440; };
/** .lab-host.json → { rules, errors } (common/hosts.mjs checkRules, the same words) */
export function checkRules(j) {
  const e = [];
  if (!j || typeof j !== 'object') return { rules: null, errors: ['.lab-host.json が JSON のオブジェクトではありません'] };
  if (!Number.isInteger(j.minutesPerMonth) || j.minutesPerMonth < 1 || j.minutesPerMonth > 50000) e.push('minutesPerMonth: 1〜50000 の整数');
  if (!Array.isArray(j.jobs) || !j.jobs.length || j.jobs.some((x) => !HOST_JOBS.includes(x))) e.push(`jobs: ${HOST_JOBS.join(' ')} から（AI とアカウントの要る仕事はありません）`);
  if (j.hours !== undefined && !validHours(j.hours)) e.push('hours: "HH:MM-HH:MM"（例 "09:00-23:00"、日をまたぐ "22:00-06:00" も可）');
  if (j.timezone !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: j.timezone }); } catch { e.push(`timezone: ${j.timezone} は知らない時間帯（例 Asia/Tokyo）`); } }
  if (j.until !== undefined && !/^\d{4}-\d\d-\d\d$/.test(String(j.until))) e.push('until: YYYY-MM-DD');
  if (j.contact !== undefined && (typeof j.contact !== 'string' || j.contact.length > 200)) e.push('contact: 200 文字までの文字');
  return { rules: e.length ? null : { minutesPerMonth: j.minutesPerMonth, jobs: j.jobs, hours: j.hours ?? '00:00-24:00', timezone: j.timezone ?? 'UTC', until: j.until ?? null, contact: j.contact ?? '' }, errors: e };
}
const parts = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
export const monthOf = (d, tz = 'UTC') => { const p = parts(new Date(d), tz); return `${p.year}-${String(p.month).padStart(2, '0')}`; };
export const dayOf = (d, tz = 'UTC') => { const p = parts(new Date(d), tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
export function within(hours, tz = 'UTC', now = new Date()) {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(hours ?? '00:00-24:00'));
  if (!m) return false;
  const p = parts(now, tz), t = (p.hour % 24) * 60 + p.minute, a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  if (a === b) return true;
  return a < b ? t >= a && t < b : t >= a || t < b;
}
/** a host's runs (GitHub's, of host.yml) → the minutes they took in a month of its time zone: each finished run rounded up
 *  to the minute (GitHub bills by the minute, a job at a time: this is the floor of what it billed) */
export const monthMinutes = (runs, month, tz = 'UTC') => runs.filter((r) => r.status === 'completed' && monthOf(r.run_started_at ?? r.created_at, tz) === month)
  .reduce((n, r) => n + Math.max(1, Math.ceil((Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 60_000)), 0);
/** a host now (pure) → { ok, why: [..], used, limit, stopAt, remaining } (common/hosts.mjs canRun, without the ledger: the
 *  minutes are what GitHub shows of the host's runs) */
export function hostNow(rules, used, now = new Date(), running = false) {
  const why = [];
  if (!rules) return { ok: false, why: ['.lab-host.json がないか正しくありません'], used, limit: 0, stopAt: 0, remaining: 0 };
  const tz = rules.timezone ?? 'UTC', stopAt = Math.floor(rules.minutesPerMonth * STOP_AT);
  if (rules.until && dayOf(now, tz) > rules.until) why.push(`期限（${rules.until}）を過ぎました`);
  if (!within(rules.hours, tz, now)) why.push(`時間帯（${rules.hours} ${tz}）の外です`);
  if (running) why.push('仕事が走っています（同じホストで同時に 1 つ）');
  if (used >= stopAt) why.push(`今月 ${used} 分: 上限 ${rules.minutesPerMonth} 分の 80%（${stopAt} 分）に届きました`);
  return { ok: !why.length, why, used, limit: rules.minutesPerMonth, stopAt, remaining: Math.max(0, stopAt - used) };
}
// ---- where a job runs: this lab's own Actions, or a lender's (a host) through hostrun.yml ----
/** may this repository become this person's host (pure) → { ok, errors, warns }: their own (admin), not a fork, not archived;
 *  public is allowed but said (the jobs pushed there are public then) */
export function newHostCheck(repo, me) {
  const errors = [], warns = [];
  if (!repo) return { ok: false, errors: ['そのリポジトリが見えません（まだ作っていないか、ラボの App をそこに入れていません）'], warns };
  if (roleOf(repo.permissions) !== 'admin' || String(repo.owner?.login ?? '').toLowerCase() !== String(me ?? '').toLowerCase()) errors.push('あなた自身のリポジトリだけをホストにできます（持ち主として）');
  if (repo.fork) errors.push('フォークはホストにできません: 新しいリポジトリを作ってください');
  if (repo.archived) errors.push('アーカイブされています');
  if (!repo.private && repo.visibility !== 'private' && repo.visibility !== 'internal') warns.push('公開リポジトリです: 押し込まれた試験も公開になります（private がおすすめ）');
  return { ok: !errors.length, errors, warns };
}
/** the files a new host gets (pure): the template's README and host.yml as they are, .lab-host.json from the lender's rules */
export function newHostFiles(template, rules) {
  const c = checkRules(rules);
  if (c.errors.length) return { files: null, errors: c.errors };
  return { files: { ...template, '.lab-host.json': JSON.stringify({ lab: 1, ...rules }, null, 2) + '\n' }, errors: [] };
}
export const HOST_UNIT_JOBS = ['test', 'go', 'sim'];
export const HOST_JOB_WORDS = { gate: 'ラボの試験（gate）', 'gate-all': '全部の試験', test: 'ユニットの試験（test）', go: 'ユニットを仕上げる（go: .mcaddon も）', sim: 'ユニットをすばやく（sim）', upkeep: '新しい Minecraft に合わせる（upkeep）', 'dev-bds': 'BDS の開発版で' };
/** the form for a job on a host → { inputs } for hostrun.yml, or { error } (pure): the lender's rules allow the job, a unit
 *  for test / go / sim (bds/addons/<name>), none for the rest */
export function hostRunInputs({ host, job, unit = '', wait = true, rules }) {
  if (!SLUG.test(String(host ?? ''))) return { error: 'ホストを選んでください' };
  if (!rules) return { error: `${host} の .lab-host.json が読めません` };
  if (!rules.jobs.includes(job)) return { error: `${job} は ${host} では許されていません（許す仕事: ${rules.jobs.join(' ')}）` };
  const u = String(unit ?? '').trim();
  if (HOST_UNIT_JOBS.includes(job) && !/^[a-z0-9_]+$/.test(u)) return { error: `${job} はユニットの名前が要ります（bds/addons/<名前>: 英小文字・数字・_）` };
  return { inputs: { host, job, unit: HOST_UNIT_JOBS.includes(job) ? u : '', wait: String(wait !== false) } };
}
/** the hosts as they stand now → the one to use (pure): usable, the most minutes left; null when none is */
export const bestHost = (list) => [...list].filter((x) => x.now?.ok).sort((a, b) => b.now.remaining - a.now.remaining || a.slug.localeCompare(b.slug))[0] ?? null;

// ---- the address: #<tab>, or #runs?repo=<owner/repo>&run=<id> (Discord's 「管理パネル」 button opens that run) ----
export const TAB_KEYS = ['overview', 'runs', 'start', 'files', 'discord', 'secrets', 'live', 'hosts', 'members', 'setup', 'audit', 'settings'];
/** runs narrowed (pure): q in the name, title, branch or who started it; show: all · failed · going · mine (me: the login) */
export function filterRuns(rs, { q = '', show = 'all', me = '' } = {}) {
  const w = String(q).trim().toLowerCase();
  return rs.filter((r) => (show === 'failed' ? ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) : show === 'going' ? r.status !== 'completed' : show === 'mine' ? (r.triggering_actor?.login ?? r.actor?.login) === me : true)
    && (!w || [r.name, r.display_title, r.head_branch, r.triggering_actor?.login, r.actor?.login, r.event].some((x) => String(x ?? '').toLowerCase().includes(w))));
}
/** runs that were going at the last look and have ended now (pure) → the ended runs; `was`: id → status */
export const endedSince = (was, rs) => rs.filter((r) => r.status === 'completed' && was.has(r.id) && was.get(r.id) !== 'completed');
/** each workflow's health over the runs given (pure): how often it passed (cancelled and skipped runs aside), how long it
 *  took (the middle run), how many failed in a row up to the newest → [{ name, path, ok, bad, rate, ms, streak, last }],
 *  the failing first. rs: newest first, as GitHub lists them */
export function workflowHealth(rs) {
  const by = new Map();
  for (const r of rs) { if (r.status !== 'completed') continue; const k = r.path ?? r.name; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const BAD = ['failure', 'timed_out', 'startup_failure'];
  return [...by.entries()].map(([path, l]) => {
    const ok = l.filter((r) => r.conclusion === 'success').length, bad = l.filter((r) => BAD.includes(r.conclusion)).length;
    const ms = l.map((r) => Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)).filter((x) => x >= 0).sort((a, b) => a - b);
    let streak = 0; for (const r of l) { if (BAD.includes(r.conclusion)) streak++; else if (r.conclusion === 'success') break; }
    return { name: l[0].name, path, ok, bad, rate: ok + bad ? ok / (ok + bad) : null, ms: ms.length ? ms[Math.floor(ms.length / 2)] : 0, streak, last: l[0] };
  }).sort((a, b) => b.streak - a.streak || (a.rate ?? 1) - (b.rate ?? 1) || a.name.localeCompare(b.name));
}
/** a secret's age (pure) → { days, stale }: one not set again for STALE_DAYS is worth renewing (a key, a password) */
export const STALE_DAYS = 180;
export function secretAge(iso, nowMs = Date.now()) { const t = Date.parse(iso); if (!Number.isFinite(t)) return { days: null, stale: false }; const days = Math.floor((nowMs - t) / 86_400_000); return { days, stale: days >= STALE_DAYS }; }
/** a key pressed outside a text box → what it asks (pure): 1–9, 0 the tabs shown, / search, r read again, ? the keys */
export function shortcut(key, tabs) {
  if (/^[1-9]$/.test(key)) return tabs[Number(key) - 1] ? { tab: tabs[Number(key) - 1] } : null;
  if (key === '0') return tabs[9] ? { tab: tabs[9] } : null;
  return ({ '/': { search: true }, r: { reload: true }, '?': { help: true } })[key] ?? null;
}
/** location.hash → { tab, repo, run } (pure; anything unknown → nulls) */
export function parseHash(hash) {
  const [k, q = ''] = String(hash ?? '').replace(/^#/, '').split('?');
  const p = new URLSearchParams(q), repo = p.get('repo'), run = p.get('run');
  return { tab: TAB_KEYS.includes(k) ? k : null, repo: repo && SLUG.test(repo) ? repo : null, run: run && /^\d{1,20}$/.test(run) ? run : null };
}
/** an artifact's size in words (pure) */
export const fmtBytes = (n) => (n < 1e3 ? `${n} B` : n < 1e6 ? `${(n / 1e3).toFixed(0)} KB` : `${(n / 1e6).toFixed(1)} MB`);
/** a Discord user id (pure): 17〜20 digits */
export const DISCORD_ID = /^\d{17,20}$/;
/** the notify workflow's choices, as its variables take them */
export const NOTIFY_WHEN = { auto: '失敗と、手で始めた実行（既定）', all: 'すべて', failures: '失敗だけ', off: '知らせない' };
export const NOTIFY_FILES = { auto: 'アドオン・ワールド（.mcaddon .mcpack .mcworld .mctemplate、既定）', off: '添えない' };

/** the lender stops lending now / again until a day (pure): the rules with `until` moved (host.yml and the borrower's lab
 *  both stop after it — no new field, so every host made from the template understands it) */
export const pauseRules = (j, now = new Date(), tz = 'UTC') => ({ ...j, until: dayOf(new Date(now.getTime() - 86_400_000), tz) });
export const resumeRules = (j, untilDay) => ({ ...j, until: untilDay });

// ---- quick actions on the lab's repository (the workflows it has, with their inputs filled in) ----
export const PRESETS = [
  { id: 'hold', label: '🎮 スマホで端末を操作（Discord に画面とボタン）', workflow: 'app.yml', inputs: { mode: 'hold', hold: '60' }, needs: 'discord' },
  { id: 'run', label: '🧪 アドオンを本物のアプリで確かめる', workflow: 'app.yml', inputs: { mode: 'run' }, needs: 'app' },
  { id: 'secrets', label: '🔑 秘密を Discord のフォームで登録', workflow: 'secrets.yml', inputs: { names: 'MS_EMAIL,MS_PASSWORD' }, needs: 'secretsForm' },
  { id: 'notify', label: '🔔 Discord に試しに送る', workflow: 'notify.yml', inputs: { run: '', message: 'bds-lab: 管理パネルからの試し' }, needs: 'notify' },
  { id: 'verify', label: '✔️ ラボの試験を全部（verify）', workflow: 'verify.yml', inputs: {}, needs: null },
];
/** the lab's repository from where the panel is served (pure): <owner>.github.io/<repo>/ → owner/repo, else null */
export function repoFromLocation(loc) {
  const m = /^([A-Za-z0-9-]+)\.github\.io$/i.exec(String(loc?.hostname ?? ''));
  const seg = String(loc?.pathname ?? '').split('/').filter(Boolean)[0];
  return m && seg ? `${m[1]}/${seg}` : null;
}
export const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
