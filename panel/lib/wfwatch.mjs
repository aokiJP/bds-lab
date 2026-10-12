// wfwatch (「概要」's watch on pull requests): which open pull requests change .github/ (the workflows that run with the lab's
// secrets and rights) and what they change — a wider permission, pull_request_target, a secret used, an outside action that is
// not pinned to a commit (pure: no DOM, no network; only the added lines of a patch are read).

const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW = /^\.github\/workflows\//;

/** the added lines of a patch (without the +++ header) */
const added = (patch) => String(patch ?? '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));

/** a PR's changed files ([{ filename, patch }]) → { level: 'none' | 'look' | 'danger', why: [words] }. none: nothing under
 *  .github/ changed. danger: pull_request_target, or a permission made `write`. look: any other change there, a secret used,
 *  a new `uses:` of an outside action not pinned to a full commit (a tag can be moved), or a patch GitHub did not give.
 *  Pure; the same reason is said once */
export function risk(files) {
  const why = [];
  let level = 'none';
  const say = (lv, text) => { if (!why.includes(text)) why.push(text); if (lv === 'danger') level = 'danger'; else if (level === 'none') level = 'look'; };
  for (const f of Array.isArray(files) ? files : []) {
    const name = String(f?.filename ?? '');
    if (!name.startsWith('.github/')) continue;
    say('look', WORKFLOW.test(name) ? 'ワークフロー（自動で動く手順）が変わります' : '.github の中身が変わります');
    if (typeof f.patch !== 'string' || f.patch === '') { say('look', `${name} は差分が大きすぎて読めませんでした: 自分の目で見てください`); continue; }
    for (const line of added(f.patch)) {
      const code = line.replace(/\s#.*$/, '');
      if (/pull_request_target/.test(code)) say('danger', 'pull_request_target を使います（外からの PR でも、ラボの秘密と書く権限で動きます）');
      if (/^\s*[\w-]+\s*:\s*write\s*$/.test(code) || /\bwrite-all\b/.test(code)) say('danger', '書き込みの権限（write）を広げます');
      if (/secrets\.[A-Za-z_]/.test(code)) say('look', '秘密（secrets）を使います');
      const u = /^\s*-?\s*uses\s*:\s*['"]?([^'"\s]+)/.exec(code);
      if (u && !u[1].startsWith('./') && !u[1].startsWith('docker://')) {
        const ref = u[1].split('@')[1];
        if (!ref || !SHA.test(ref)) say('look', `外の部品 ${u[1].split('@')[0]} を足します（版が固定されていません: 後から中身を替えられます）`);
      }
    }
  }
  return { level, why };
}
