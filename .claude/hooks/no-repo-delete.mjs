// PreToolUse (Bash): a GitHub repository is never deleted from here, however the command is written — `gh repo delete`, `gh api`
// with DELETE on a repository itself (-X / --method, in any order, with or without the leading /, through a variable or a
// script), curl/wget/fetch with DELETE to api.github.com/repos/<owner>/<repo>. Everything else on GitHub stays allowed (the
// permissions in settings.json). Exit 2: refused, the reason told back. Reads Claude Code's hook JSON on stdin.
import fs from 'node:fs';

/** does this shell command delete a GitHub repository (pure) → the reason, or null */
export function repoDelete(cmd) {
  const c = String(cmd ?? '').replace(/\\\n/g, ' ');
  if (/\bgh\s+repo\s+delete\b/.test(c)) return 'gh repo delete';
  const del = /(-X\s*|--method[\s=]+|--request[\s=]+|method\s*[:=]\s*['"]?)DELETE\b/i.test(c);
  // (the repository itself: repos/<owner>/<repo> with nothing after it but a quote, space, ? or the end)
  const repoPath = /(^|[\s'"/=])(\/?repos\/[A-Za-z0-9_.${}-]+\/[A-Za-z0-9_.${}-]+)\/?(?=$|[\s'"?;|&)])/m.test(c);
  if (del && repoPath && /\b(gh\s+api|curl|wget|fetch|http|Invoke-RestMethod|octokit|requests\.)/i.test(c)) return 'DELETE /repos/<owner>/<repo>';
  if (/\.repos\.delete\s*\(|repos\/delete|deleteRepo/i.test(c)) return 'リポジトリを消す API の呼び出し';
  return null;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const why = repoDelete(input?.tool_input?.command);
  if (why) { process.stderr.write(`GitHub のリポジトリの削除は、このリポジトリの設定で止めています（${why}）。消すなら GitHub の画面で人が行ってください。\n`); process.exit(2); }
}
