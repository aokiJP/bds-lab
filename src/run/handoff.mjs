import fs from 'node:fs';
import path from 'node:path';
import { writeZip, collect, DEFAULT_SKIP, humanSize } from '../util/zip.mjs';
import { readAddon } from '../verify/addon.mjs';
import * as tokenMod from './token.mjs';
import * as gitMod from './github.mjs';

const stateFile = (ROOT) => path.join(ROOT, '.bds-lab', 'state.json');

export function readState(ROOT) {
  try { return JSON.parse(fs.readFileSync(stateFile(ROOT), 'utf8')); } catch { return { round: 0 }; }
}

export function writeState(ROOT, patch) {
  const s = { ...readState(ROOT), ...patch };
  fs.mkdirSync(path.dirname(stateFile(ROOT)), { recursive: true });
  fs.writeFileSync(stateFile(ROOT), `${JSON.stringify(s, null, 2)}\n`);
  return s;
}

function lastReport(ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.bds-lab', 'report.json'), 'utf8')); } catch { return null; }
}

function failuresText(report) {
  if (!report) return '（まだ実機で検証していません。最初は全部落ちているものとして進めてください）';
  if (report.ok) {
    const skip = report.skipped?.length ? `（ただし ${report.skipped.join(' / ')} は動かせていません: ${report.skippedWhy ?? '環境の都合'}）` : '';
    return `前回は ${report.passed}/${report.total} すべて通りました。${skip}`;
  }
  const out = [`前回は ${report.passed}/${report.total}。落ちたのは次の ${report.total - report.passed} 本です。`, ''];
  if (report.diff?.newlyFailed?.length) {
    out.push(`直前の変更で新しく壊れたもの: ${report.diff.newlyFailed.join(' / ')}`, 'まずここから見てください。', '');
  }
  if (report.diff?.newlyFixed?.length) out.push(`直ったもの: ${report.diff.newlyFixed.join(' / ')}`, '');
  for (const r of report.results.filter((x) => !x.ok)) {
    out.push(`### ${r.name}${r.why ? `（${r.why}）` : ''}`);
    out.push(`- 実機が返したこと: ${r.detail}`);
    if (r.hint) out.push(`- 直し方の当たり: ${r.hint}`);
    for (const n of r.notes ?? []) out.push(`- 実機で読んだ値: ${n}`);
    out.push('');
  }
  if (report.skipped?.length) {
    out.push(`### 確かめていないもの（${report.skippedWhy ?? '環境の都合'}）`);
    for (const n of report.skipped) out.push(`- ${n}`);
    out.push('これは落ちたのではなく、動かせていません。通ったものとして扱わないでください。', '');
  }
  if (report.scriptErrors?.length) {
    out.push('### アドオンが投げた例外');
    for (const e of report.scriptErrors.slice(0, 6)) out.push(`- ${e}`);
    out.push('');
  }
  return out.join('\n');
}

const RULES = [
  '## 守ること',
  '',
  '決まりごとは `AGENTS.md`（40 行）が正です。ここには、この受け渡しでしか効かないものだけ書きます。',
  '',
  '1. ファイルは**全文**で返してください。差分や「以下同じ」は使えません（返した中身でフォルダが置き換わります）。',
  '   構文エラーや省略があれば取り込みの前に弾かれ、いまのアドオンはそのまま残ります。',
  '2. 直してよいのは `addons/<アドオン名>/` の中だけ。`specs/` は通すために緩めないでください。',
  '3. API は `npm run api -- <名前>` で確かめてください（実機に在るかまで出ます）。記憶で書かない。',
].join('\n');

export async function ensureMaterials({ ROOT, say = console.log }) {
  const missing = [];
  try {
    const { haveTypes, syncTypes } = await import('./docs.mjs');
    if (!haveTypes(ROOT)) await syncTypes({ ROOT, say });
    if (!haveTypes(ROOT)) missing.push(['公式の型定義（types/minecraft/）', 'npm run docs']);
  } catch { missing.push(['公式の型定義（types/minecraft/）', 'npm run docs']); }
  if (!fs.existsSync(path.join(ROOT, 'refs'))) missing.push(['公式の一次資料（refs/）', 'npm run refs']);
  if (!fs.existsSync(path.join(ROOT, '.bds-lab', 'api.json'))) missing.push(['この実機の API 一覧（api.json）', 'npm run check']);
  if (!fs.existsSync(path.join(ROOT, 'vendor', 'bedrock-server.zip'))) missing.push(['実機の BDS', 'npm start（初回に取得します）']);
  return missing;
}

export function makeHandoff({ ROOT, addonDir, specsDir, say = console.log, extra = '', withToken = false, full = true, withBds = true, missing = [] }) {
  const addon = readAddon(addonDir);
  const report = lastReport(ROOT);
  const round = (readState(ROOT).round ?? 0) + 1;
  const dir = path.join(ROOT, '.bds-lab', 'handoff');
  fs.mkdirSync(dir, { recursive: true });

  const taskFile = path.join(addonDir, 'TASK.md');
  const task = fs.existsSync(taskFile) ? fs.readFileSync(taskFile, 'utf8').trim() : '（TASK.md がありません。何を作るのかを先に書いてください）';

  const prompt = [
    `# 依頼（第 ${round} 回）— Minecraft 統合版アドオン \`${addon.name}\``,
    '',
    'この zip だけで作業できます。ほかに指示はありません。',
    '',
    '```sh',
    'npm start                 # 足りないもの（実機・型定義）を揃えて、検証まで進みます',
    'npm run selftest          # 実機もネットワークも要らない自己点検',
    'npm run fix               # 実機を上げずに直せるものを直す',
    'npm test                  # 実機で確かめる',
    'npm run status            # 結果を 40 行で見る（最初の ✘ だけ直す）',
    'npm run real -- --all     # 本物のクライアント越しでも通るか',
    '```',
    `検証結果は実機の Bedrock Dedicated Server ${report?.version ?? ''} で動かしたものです。推測ではありません。`,
    '',
    '## 見る順番',
    '',
    '1. `AGENTS.md`（決まりごと・40 行）→ `START_HERE.md`（順番）',
    '2. この下の「実機での検証結果」— 直す場所',
    '3. 引くもの: `npm run api -- <名前>` / `skills/README.md` / `types/spec.d.ts`',
    '',
    '## 依頼書',
    '',
    task,
    '',
    '## 実機での検証結果',
    '',
    failuresText(report),
    extra ? `${extra}\n` : '',
    RULES,
    '',
    missing.length ? [
      '## 添付 zip に無いもの',
      '',
      'これらは手元のネットワークで取れなかったものです。**あなたの環境で次を実行すれば揃います。**',
      '',
      '| 無いもの | 揃え方 |',
      '|---|---|',
      ...missing.map(([what, how]) => `| ${what} | \`${how}\` |`),
      '',
      '揃わなくても作業はできますが、API の名前は記憶で書かず、`.bds-lab/api.json` を作ってから決めてください。',
      '',
    ].join('\n') : '',
    '## 添付 zip の中身',
    '',
    `\`addons/${addon.name}/\`（直す対象）・\`specs/\`（受け入れ条件）・\`AGENTS.md\`・\`START_HERE.md\`・`
    + '`skills/`・`types/`（型定義と `spec.d.ts`）・`api.json`（この実機に実在する API）・'
    + '`report.json`・`server.log`（落ちた理由の一次情報）'
    + (full ? '・`bin/` `src/` `tools/`（検証の仕組み。`npm start` でそのまま動きます）' : ''),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'PROMPT.md'), prompt);   // auto が AI に渡す用（人は見なくてよい）

  // 既定で「そのまま動かせる一式」を入れる。受け取った AI が自分で検証できるようにするため。
  const skip = new Set(DEFAULT_SKIP);
  const entries = full
    ? collect(ROOT, '', skip).filter((e) => !e.name.startsWith('addons/') || e.name.startsWith(`addons/${addon.name}/`))
    : [
      ...collect(addonDir, `addons/${addon.name}`),
      ...collect(specsDir, 'specs'),
      { name: 'AGENTS.md', abs: path.join(ROOT, 'AGENTS.md') },
      { name: 'START_HERE.md', abs: path.join(ROOT, 'START_HERE.md') },
      { name: 'types/spec.d.ts', abs: path.join(ROOT, 'types', 'spec.d.ts') },
    ];
  entries.push({ name: 'PROMPT.md', body: prompt });
  const log = path.join(ROOT, '.bds-lab', 'server.log');
  if (fs.existsSync(log)) {
    const tail = fs.readFileSync(log, 'utf8').trim().split('\n').slice(-200).join('\n');
    entries.push({ name: 'server.log', body: tail });
  }
  if (withBds) {
    const zipFile = path.join(ROOT, 'vendor', 'bedrock-server.zip');
    if (fs.existsSync(zipFile)) entries.push({ name: 'vendor/bedrock-server.zip', abs: zipFile });
    else say('  vendor/bedrock-server.zip がないので実機は入れません');
  }
  if (report) entries.push({ name: 'report.json', body: JSON.stringify(report, null, 2) });
  const api = path.join(ROOT, '.bds-lab', 'api.json');
  if (fs.existsSync(api)) entries.push({ name: 'api.json', abs: api });
  if (!full) {
    const types = path.join(ROOT, 'types', 'minecraft');
    if (fs.existsSync(types)) entries.push(...collect(types, 'types/minecraft'));
  }
  if (!full) {
    const skills = path.join(ROOT, 'skills');
    if (fs.existsSync(skills)) entries.push(...collect(skills, 'skills'));
  }
  const refs = path.join(ROOT, 'refs');
  if (fs.existsSync(refs)) {
    for (const e of collect(refs, 'refs')) {
      // 大きすぎるものは入れない。索引と ID 一覧だけで足りる
      if (fs.statSync(e.abs).size > 1024 * 1024) continue;
      entries.push(e);
    }
  }

  if (withToken) {
    const { currentToken, githubGuide } = tokenMod;
    const { currentBranch, remoteSlug } = gitMod;
    const token = currentToken();
    const slug = remoteSlug(ROOT);
    const branch = currentBranch(ROOT);
    entries.push({ name: 'GITHUB.md', body: githubGuide({ ROOT, token, slug, branch }) });
    if (token) {
      entries.push({ name: 'github.token', body: `${token}\n` });
      say('  ⚠ この zip には GitHub の token が入ります。渡す相手と置き場所に気をつけてください');
    } else {
      say('  token が取れませんでした（gh auth login か GITHUB_TOKEN）。説明だけ入れます');
    }
  }

  const zip = path.join(dir, `handoff-${String(round).padStart(2, '0')}.zip`);
  const { files, size } = writeZip(zip, entries);
  writeState(ROOT, { round, addon: addon.name, lastHandoff: zip });

  const human = humanSize(size);
  say('');
  say(`この zip を AI に渡してください（第 ${round} 回・${files} ファイル / ${human}）`);
  say(`  ${path.relative(ROOT, zip)}`);
  say('  指示は zip の中の START_HERE.md に入っています。ほかに伝えることはありません。');
  // 実機を同梱すると 90MB 前後になる。多くの AI チャットは添付の上限がこれより小さい。
  if (size > 25 * 1024 * 1024) {
    say('');
    say(`  ⚠ ${human} は AI チャットの添付上限を超えることがあります（実機の BDS が入っているためです）`);
    say('    上げられないときは npm run prompt -- --no-bds（実機抜き・数百 KB）で作り直してください');
    say('    実機抜きでも検証以外は進められます。判断の材料は api.json と server.log に入っています');
  }
  return { prompt, zip, round };
}
