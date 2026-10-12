// failsum: why a run failed, in three lines — where (the failed job and its failed step), why (the common failures said in
// words: a secret not there, the BDS not fetched, a test's expectation not met, out of time, stopped) and the one next step.
// Built from the jobs' steps (their names and conclusions) and the failed jobs' annotations only: a job's log is a 302 to
// another host the page may not call (its CSP's connect-src), so it is never read here. lib/guide.mjs diagnose says the
// causes and their fixes as a list; when its answer is given, its first fix is the next step here (one wording, not two).
// Pure: no DOM, no fetch, no node:.

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);
const OK = new Set(['success', 'skipped', 'neutral']);
// (a cause here → the title diagnose gives the same cause)
const SAME = { cancelled: /止められ/, timeout: /時間切れ/, secret: /^秘密/, bds: /BDS/, test: /試験/, startup: /ワークフローのファイル/ };
const clip = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** the common failures, the first that fits wins (pure data + a test). test({ run, jobs, text, steps }) → true | { name } (a
 *  word for the sentences: the secret's name); why/next: the words, given that */
export const CAUSES = Object.freeze([
  {
    id: 'cancelled', label: '止められた',
    test: ({ run, jobs }) => run.conclusion === 'cancelled' || (!jobs.some((j) => j.conclusion === 'failure') && jobs.some((j) => j.conclusion === 'cancelled')),
    why: () => '誰かが「止める」を押したか、同じワークフローの新しい実行に場所をゆずって、止まりました',
    next: () => 'こわれたのではありません。もう一度動かしたいなら「やり直す」を押してください',
  },
  {
    id: 'timeout', label: '時間切れ',
    test: ({ run, jobs, text }) => run.conclusion === 'timed_out' || jobs.some((j) => j.conclusion === 'timed_out' || (j.steps ?? []).some((s) => s.conclusion === 'timed_out'))
      || /timed? ?out|maximum execution time|timeout-minutes|has exceeded the maximum/i.test(text),
    why: () => '決めた時間をこえても終わらなかったので、GitHub が止めました（時間切れ）',
    next: () => '仕事を小さく分けるか、貸し手の Actions で走らせてください。たまたま遅かっただけなら「やり直す」',
  },
  {
    id: 'secret', label: '秘密が無い',
    test: ({ text }) => {
      // (a name that looks like a secret's: words joined by _, or one of TOKEN KEY SECRET PASSWORD WEBHOOK — never ERROR)
      const named = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]*(?:TOKEN|KEY|SECRET|PASSWORD|WEBHOOK))\b[^\n]{0,40}?(?:is not set|not set|is missing|missing|is empty|が(?:無い|ない|ありません|空))/.exec(text)
        ?? /(?:secret|秘密)[^\n]{0,20}?\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b[^\n]{0,40}?(?:not set|missing|empty|not found|無い|ない|ありません|空)/i.exec(text);
      if (named) return { name: named[1] };
      return /Input required and not supplied|secret[^\n]{0,30}(?:missing|not set|not found|empty)|秘密[^\n]{0,20}(?:無い|ない|ありません|空)/i.test(text) ? { name: '' } : false;
    },
    why: ({ name }) => `秘密${name ? ` ${name}` : ''}が登録されていないので、そこから先へ進めませんでした`,
    next: ({ name }) => `「秘密」で${name ? ` ${name} ` : ''}を登録してから「やり直す」を押してください`,
  },
  {
    id: 'bds', label: 'BDS を取れない',
    test: ({ text, steps }) => /bedrock-server|minecraft\.net|\bBDS\b[^\n]{0,40}(?:download|fetch|404|取れ|取得|見つから)|(?:download|fetch)[^\n]{0,40}\bBDS\b/i.test(text)
      || steps.some((s) => /\b(?:bds|bedrock)\b|サーバーを取/i.test(s.name) && /download|fetch|get|setup|取|入れ|install/i.test(s.name)),
    why: () => 'Minecraft のサーバー（BDS）を取ってこられませんでした（配布元の不調か、配り方が変わった）',
    next: () => 'しばらく待って「やり直す」。それでもだめなら「実行」で upkeep（新しい Minecraft に合わせる）を走らせてください',
  },
  {
    id: 'test', label: '試験の期待が合わない',
    test: ({ text, steps }) => /\bFAIL\b|✘|AssertionError|expected[^\n]{0,60}(?:got|but|received)|want [^\n]{0,60} got|期待|tests\.txt/i.test(text)
      || steps.some((s) => /\b(?:test|tests|go|check|verify)\b|試験|テスト/i.test(s.name)),
    why: () => '試験（tests.txt など）の期待と、実際に出たものが合いませんでした',
    next: () => '注釈の行が、どの期待が合わなかったかです。アドオンを直して「やり直す」（手元なら node lab.mjs go）。期待をゆるめて通すのはだめです',
  },
  {
    id: 'startup', label: 'ワークフローが読めない',
    test: ({ run }) => run.conclusion === 'startup_failure',
    why: () => 'ワークフローのファイル（.github/workflows/ の .yml）を GitHub が読めず、始まりませんでした',
    next: () => '最近変えた .yml の書き方（字下げ・引用符）を確かめてください',
  },
]);

/** the one failed step (or job) the run fell at → { job, step, index } (pure). The first job that failed (one that timed
 *  out or was stopped when none failed), and its first step that did not succeed */
export function failedAt(jobs = []) {
  const rank = (c) => (c === 'failure' ? 0 : c === 'timed_out' ? 1 : c === 'cancelled' ? 2 : FAILED.has(c) ? 3 : 9);
  const job = [...jobs].filter((j) => FAILED.has(j.conclusion)).sort((a, b) => rank(a.conclusion) - rank(b.conclusion))[0] ?? null;
  if (!job) return { job: null, step: null, index: -1 };
  const steps = job.steps ?? [];
  let index = steps.findIndex((s) => s.conclusion === 'failure' || s.conclusion === 'timed_out');
  if (index < 0) index = steps.findIndex((s) => FAILED.has(s.conclusion));
  return { job, step: index >= 0 ? steps[index] : null, index };
}

/** why a run failed, in three lines (pure) → { where, why, next, cause, tab, lines: [where, why, next] } (tab: the panel's
 *  tab for the next step, from diagnose) — or null for a run that
 *  did not fail (still going, or passed). run, jobs: GitHub's shapes; annotations: the failed jobs' ({ annotation_level,
 *  title, message }); logTail: a log's last lines if a caller has them (the panel does not: see the top); diagnosis: lib/
 *  guide.mjs diagnose's answer ([{ title, fix }]), its first fix used as the next step */
export function summarize({ run = {}, jobs = [], annotations = [], logTail = '', diagnosis = null } = {}) {
  if (run.status && run.status !== 'completed') return null;
  if (OK.has(run.conclusion) || (!run.conclusion && !jobs.some((j) => FAILED.has(j.conclusion)))) return null;
  const at = failedAt(jobs);
  const said = annotations.filter((a) => a && a.annotation_level !== 'notice' && (a.message || a.title));
  const failedSteps = jobs.flatMap((j) => (j.steps ?? []).filter((s) => FAILED.has(s.conclusion)));
  const text = [...said.map((a) => `${a.title ?? ''} ${a.message ?? ''}`), ...failedSteps.map((s) => s.name ?? ''), String(logTail ?? '')].join('\n');
  let cause = null, got = null;
  for (const c of CAUSES) { const r = c.test({ run, jobs, text, steps: failedSteps.map((s) => ({ name: String(s.name ?? '') })) }); if (r) { cause = c; got = r === true ? {} : r; break; } }

  const where = run.conclusion === 'startup_failure' && !at.job ? 'ワークフローが始まる前（ジョブは 1 つも動いていません）'
    : at.job ? `ジョブ「${at.job.name ?? at.job.id}」${at.step ? `の ${at.index + 1} 段目「${at.step.name}」` : ''}で${at.job.conclusion === 'cancelled' ? '止まりました' : at.job.conclusion === 'timed_out' ? '時間切れになりました' : '落ちました'}`
      : '落ちたジョブが見つかりません（ジョブが始まる前か、もう消えています）';
  const first = said.find((a) => a.annotation_level === 'failure') ?? said[0];
  const why = cause ? cause.why(got) : first ? `GitHub の言葉: ${clip(first.message || first.title)}` : '理由の言葉（注釈）は残っていません';
  // (diagnose's entry for the same cause when it has one — the three lines then agree — else its first)
  const fixes = Array.isArray(diagnosis) ? diagnosis.filter((d) => d?.fix) : [];
  const used = (cause && fixes.find((d) => SAME[cause.id]?.test(String(d.title ?? '')))) || fixes[0] || null, fix = used?.fix ?? null;
  const next = fix ? clip(fix, 200) : cause ? cause.next(got) : at.step ? `GitHub で「${at.step.name}」の赤い段のログを開き、最後の行を見てください` : 'GitHub で実行を開き、赤いところを見てください';
  return { where, why, next, cause: cause?.id ?? null, tab: used?.tab ?? null, lines: [`📍 どこで: ${where}`, `❓ なぜ: ${why}`, `👉 次の 1 手: ${next}`] };
}
