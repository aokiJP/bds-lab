#!/usr/bin/env node
// docs/tokens.mjs — AI が読み書きするトークンを数える。依存なし・Node 20 以上。
//
//   node docs/tokens.mjs                 表を出す（docs/TOKENS.md の「改修前」はこの出力）
//   node docs/tokens.mjs --json          機械で読む形
//   node docs/tokens.mjs --file <path>   1 ファイルだけ
//   node docs/tokens.mjs --cmd "<...>"   コマンドの出力を数える（改修後の npm run api などを測る）
//
// 数え方: 日本語 1 文字 ≒ 1 token、それ以外は 3.6 文字 ≒ 1 token。
// 実際のトークナイザではないので絶対値は目安。**同じ物差しで前後を比べる**ために使う。
// この数え方を変えると倍率が作れてしまうので、変えるときは docs/TOKENS.md の基準値も測り直すこと。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JP = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]/gu;

export function tokens(text) {
  if (!text) return 0;
  const jp = (text.match(JP) ?? []).length;
  return Math.round(jp + (text.length - jp) / 3.6);
}

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const t = (rel) => { const s = read(rel); return s === null ? null : tokens(s); };
const sum = (list) => list.reduce((a, b) => a + (b ?? 0), 0);

const glob = (dir, ext) => {
  try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`); }
  catch { return []; }
};

const latestHandoff = () => {
  const p = '.bds-lab/handoff/PROMPT.md';
  return read(p) !== null ? p : 'PROMPT.md';
};

const addonDir = () => {
  // いま検証している方を測る（state.json が正。無ければ addons/ の先頭）
  try {
    const st = JSON.parse(read('.bds-lab/state.json') ?? '{}');
    if (st.addon && fs.existsSync(path.join(ROOT, 'addons', st.addon))) return st.addon;
  } catch { /* 無ければ次へ */ }
  try { return fs.readdirSync(path.join(ROOT, 'addons')).filter((n) => !n.startsWith('_')).sort()[0] ?? null; }
  catch { return null; }
};

// d.ts から 1 クラス分だけ切り出す。「引ければどれだけで済むか」の下限を測るため
const classBlock = (src, name) => {
  const re = new RegExp(`^export (?:declare )?class ${name}\\b[^\\n]*\\{`, 'm');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  }
  return src.slice(m.index, i);
};

const addonFiles = (name) => {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else out.push(r);
    }
  };
  walk(`addons/${name}`);
  return out.sort();
};

export function measure() {
  const skills = glob('skills', '.md');
  const skillTokens = skills.map((f) => t(f) ?? 0);
  const specs = glob('specs', '.mjs');
  const addon = addonDir();
  const files = addon ? addonFiles(addon) : [];
  const addonTokens = files.map((f) => t(f) ?? 0);
  const prompt = latestHandoff();

  const rows = [];
  const add = (group, what, value, note = '') => rows.push({ group, what, value, note });

  // (a) 毎回読むもの
  add('a 常駐', 'AGENTS.md', t('AGENTS.md'));
  add('a 常駐', 'START_HERE.md', t('START_HERE.md'));
  add('a 常駐', prompt, t(prompt), '毎ラウンド生成される指示文');
  add('a 常駐', '小計', sum([t('AGENTS.md'), t('START_HERE.md'), t(prompt)]), 'AI が何をするにも先に読む量');

  // (b) 引きに行くもの
  add('b 資料', 'README.md', t('README.md'), '人向け');
  add('b 資料', `skills/ 合計（${skills.length} 枚）`, sum(skillTokens));
  add('b 資料', 'skills/ 最大の 1 枚', Math.max(0, ...skillTokens));
  add('b 資料', 'types/minecraft/server.d.ts', t('types/minecraft/server.d.ts'), '全文を読ませたら文脈が潰れる');
  add('b 資料', 'types/minecraft/server-ui.d.ts', t('types/minecraft/server-ui.d.ts'));
  add('b 資料', 'types/minecraft/server-gametest.d.ts', t('types/minecraft/server-gametest.d.ts'));
  add('b 資料', 'api.json（実機に在る API）', t('api.json') ?? t('.bds-lab/api.json'));

  // (c) 1 ラウンドの結果
  add('c 結果', '.bds-lab/report.json', t('.bds-lab/report.json') ?? t('report.json'));
  add('c 結果', '.bds-lab/server.log', t('.bds-lab/server.log') ?? t('server.log'));

  // (d) AI が返す量
  add('d 返却', `addons/${addon ?? '-'}/ 全文`, sum(addonTokens), '今の規則（全文で返す）で毎回返る量');
  add('d 返却', '同 うち最大の 1 ファイル', Math.max(0, ...addonTokens));
  add('d 返却', `specs/ 合計（${specs.length} 本）`, sum(specs.map((f) => t(f) ?? 0)));

  // (e) 1 つの問いに答えるまでに読む量。ここが本丸
  const dts = read('types/minecraft/server.d.ts') ?? '';
  const whole = tokens(dts);
  for (const name of ['InputInfo', 'Camera', 'PlayerButtonInputAfterEvent']) {
    const block = classBlock(dts, name);
    const min = block ? tokens(block) : null;
    add('e 1 問', `${name} の中身を知る`, whole, '今: 引くコマンドが無いので d.ts 全文が上限');
    add('e 1 問', `└ そのクラスだけなら`, min, `下限。全文の 1/${min ? Math.round(whole / min).toLocaleString('en-US') : '?'}`);
  }
  add('e 1 問', '入力の符号を確かめる', sum([t('skills/41-input-camera.md'), t('skills/70-pitfalls.md')]), '今: 落とし穴と入力の 2 枚を読む');

  return { rows, meta: { addon, skills: skills.length, specs: specs.length, prompt } };
}

const RUN_DIRECTLY = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = RUN_DIRECTLY ? process.argv.slice(2) : ['--quiet'];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

if (!RUN_DIRECTLY) {
  // import されただけのときは何も出さない（測る道具が測定結果を汚さないように）
} else if (opt('--file')) {
  const s = fs.readFileSync(path.resolve(opt('--file')), 'utf8');
  console.log(`${tokens(s)}\t${opt('--file')}`);
} else if (opt('--cmd')) {
  const cmd = opt('--cmd');
  let out = '';
  try { out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
  console.log(`${tokens(out)}\t${out.split('\n').length} 行\t${cmd}`);
} else {
  const { rows, meta } = measure();
  if (args.includes('--json')) {
    console.log(JSON.stringify({ rows, meta }, null, 2));
  } else {
    const w = Math.max(...rows.map((r) => [...r.what].length));
    let group = '';
    for (const r of rows) {
      if (r.group !== group) { group = r.group; console.log(`\n## ${group}`); }
      const v = r.value === null ? '（無い）' : `${r.value.toLocaleString('en-US')} tok`;
      console.log(`  ${r.what.padEnd(w)}  ${v.padStart(12)}${r.note ? `  ${r.note}` : ''}`);
    }
    console.log('\n数え方: 日本語 1 文字 ≒ 1 token / それ以外 3.6 文字 ≒ 1 token');
  }
}
