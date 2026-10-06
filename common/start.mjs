// node lab.mjs start: the first time on a machine, in one go (asks before each step; Enter = yes):
//   1. what this machine lacks (doctor)  2. sign-ins (AI key, GitHub)  3. the server (setup)  4. "what do you want to make?" → make
// Not at a terminal (an AI, CI): prints the same steps as commands.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { canAsk, ask, yes } from './secrets.mjs';
import { TOP, status, loginAi, loginGithub } from './auth.mjs';

const lab = (args, opts = {}) => spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, ...opts });

export async function startCmd(args, out = console.log) {
  out('bds-lab へようこそ。作りたいものを言うだけで、AI が本物のサーバーで確かめながらアドオンを作ります。\n');
  if (!canAsk()) {
    out(['順番に:', '  node lab.mjs doctor              足りないものの確認', '  node lab.mjs login               AI の鍵・GitHub（.env に書いてもよい: .env.example）', '  node lab.mjs setup               サーバーの用意（初回だけ数分）', '  node lab.mjs make "<作りたいもの>"  AI が作る', '  node lab.mjs watch               保存するたびに自動でテスト', '  node lab.mjs ui                  ブラウザの画面でボタン操作'].join('\n'));
    return true;
  }
  // 1. the machine
  out('1/4 このコンピュータを調べています…');
  const d = lab(['doctor']);
  const bad = (d.stdout + d.stderr).split('\n').filter((l) => /^(MISSING|BLOCKED|FAIL)/.test(l) || /^\s+→/.test(l));
  if (bad.length) {
    bad.slice(0, 12).forEach((l) => out('  ' + l));
    if (await yes('足りないものがあります。ラボに入れられるものは入れますか（node lab.mjs doctor --fix）？')) lab(['doctor', '--fix'], { stdio: 'inherit' });
    else if (!(await yes('このまま続けますか？'))) return false;
  }
  else out('  OK');
  // 2. sign-ins
  out('\n2/4 ログイン');
  const rows = status();
  for (const [k, s, dd] of rows) out(`  ${s.padEnd(8)}${k.padEnd(10)}${dd}`);
  if (rows.find(([k]) => k === 'ai')[1] === 'MISSING') await loginAi({ out });
  if (rows.find(([k]) => k === 'github')[1] === 'MISSING' && await yes('GitHub にもつなぎますか（作ったものの保存と自動テスト。あとで node lab.mjs login github でも可）？', false)) await loginGithub({ out });
  if (!fs.existsSync(path.join(TOP, '.env')) && fs.existsSync(path.join(TOP, '.env.example'))) out('  （メールアドレス・パスワード・鍵は .env にまとめて書けます: .env.example をコピーして .env に）');
  // 3. the server
  out('\n3/4 サーバー');
  const has = fs.existsSync(path.join(TOP, 'bds', '.lab', 'bds'));
  if (has) out('  OK もう用意してあります（最新にするなら node lab.mjs maintain）');
  else if (await yes('Minecraft のサーバー（BDS）と道具を用意しますか？（初回だけ数分）')) { const r = lab(['bds', 'setup'], { stdio: 'inherit' }); if (r.status !== 0) { out('  E 用意できませんでした: node lab.mjs doctor を見てください'); return false; } }
  // 4. make
  out('\n4/4 作る');
  const req = await ask('何を作りますか？（例: ルビーを追加して /lab:shop でダイヤと交換。Enter でやめる）\n> ');
  if (!req) { out('\nいつでも: node lab.mjs make "<作りたいもの>"  |  ブラウザの画面で操作: node lab.mjs ui  |  保存で自動テスト: node lab.mjs watch  |  最新版への追従: node lab.mjs maintain（毎日自動: maintain --schedule daily）'); return true; }
  const play = await yes('できたら別の AI に遊ばせて壊させますか（AI プレイテスト。トークンは増えます）？', false);
  const r = lab(['make', req, ...(play ? ['--playtest'] : [])], { stdio: 'inherit' });
  out(r.status === 0 ? '\nできました。bds/dist/ の .mcaddon をダブルクリックで入れられます。直すとき: node lab.mjs make -a <名前> "<直したいこと>"（戻すとき: node lab.mjs undo）' : '\nまだ完成していません。もう一度 make するか、node lab.mjs undo で戻せます。');
  return r.status === 0;
}
