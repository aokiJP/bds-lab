import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { remoteSlug } from './github.mjs';

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

export function currentToken() {
  if (process.env.BDS_LAB_TOKEN) return process.env.BDS_LAB_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const r = run('gh', ['auth', 'token']);
  return r.status === 0 ? r.stdout.trim() : null;
}

export function tokenScope(token) {
  const r = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: token },
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** AI が GitHub を触れるようにする一式。zip に入れるのは、人が明示したときだけ */
export function githubGuide({ ROOT, token, slug, branch }) {
  const lines = [
    '# GITHUB.md — このリポジトリを操作する',
    '',
    `リポジトリ: \`${slug ?? '（不明）'}\``,
    `作業する枝: \`${branch ?? 'main'}\``,
    '',
  ];
  if (token) {
    lines.push(
      '## 認証',
      '',
      '同梱の `github.token` に、このリポジトリを操作できる token が入っています。',
      '',
      '```sh',
      'export GH_TOKEN="$(cat github.token)"',
      `gh repo clone ${slug ?? '<所有者>/<名前>'} work`,
      'cd work && git checkout ' + (branch ?? 'main'),
      '```',
      '',
      '`git` から直接使う場合:',
      '',
      '```sh',
      `git clone https://x-access-token:$(cat github.token)@github.com/${slug ?? '<所有者>/<名前>'}.git work`,
      '```',
      '',
      '## 守ること',
      '',
      '- この token を、返す zip・コミット・ログ・チャットに書き出さないでください。',
      '- 触ってよいのは上の枝だけです。`main` はテンプレートなので変更しないでください。',
      '- 強制 push（`--force`）はしないでください。',
      '',
    );
  } else {
    lines.push(
      '## 認証',
      '',
      'token は同梱していません。人から渡されるか、`gh auth login` で入ってください。',
      '',
    );
  }
  lines.push(
    '## 作業の流れ',
    '',
    '1. 上の枝を取ってくる',
    '2. `addons/<名前>/` を直す（`specs/` は条件なので緩めない）',
    '3. commit して push する',
    '4. 人が `npm run auto` を回すと、実機で検証され、次の指示が出ます',
    '',
    'CI（`verify`）は push のたびに実機で検証します。結果は Actions の artifact（`report.json`）にあります。',
  );
  return lines.join('\n');
}

export function writeTokenFiles({ dir, token, ROOT, branch }) {
  const slug = remoteSlug(ROOT);
  fs.writeFileSync(path.join(dir, 'GITHUB.md'), githubGuide({ ROOT, token, slug, branch }));
  if (token) fs.writeFileSync(path.join(dir, 'github.token'), `${token}\n`, { mode: 0o600 });
  return { slug, hasToken: Boolean(token) };
}
