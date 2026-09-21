import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const FILES = {
  runtime: '10-runtime.md',
  modules: '11-modules.md',
  world: '20-world.md',
  entity: '21-entity.md',
  component: '22-components.md',
  event: '30-events.md',
  scriptevent: '31-scriptevent.md',
  ui: '40-ui.md',
  input: '41-input-camera.md',
  gametest: '50-gametest.md',
  perf: '60-performance.md',
  pitfall: '70-pitfalls.md',
  bp: '80-bp-json.md',
};

async function ask(q, fallback = '') {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim() || fallback; } catch { return fallback; } finally { rl.close(); }
}


/** 症状や語から、当たるカード（## の固まり）だけを出す。ファイル全部は読ませない */
export function findSkill({ ROOT, word, say = console.log, max = 2, lines = 10 }) {
  const dir = path.join(ROOT, 'skills');
  const q = String(word).toLowerCase();
  const hits = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const card of body.split(/\n(?=## )/).slice(1)) {
      const title = card.split('\n')[0].replace(/^##\s*/, '');
      const score = (title.toLowerCase().includes(q) ? 2 : 0) + (card.toLowerCase().includes(q) ? 1 : 0);
      if (score) hits.push({ score, name, title, card: card.trim() });
    }
  }
  if (!hits.length) { say(`「${word}」に当たるものはありません（一覧: skills/README.md）`); return []; }
  hits.sort((a, b) => b.score - a.score);
  const shown = hits.slice(0, max);
  for (const h of shown) {
    const body = h.card.split('\n');
    say(`--- skills/${h.name}`);
    say(body.slice(0, lines).join('\n'));
    if (body.length > lines) say(`… 続きは skills/${h.name}`);
    say('');
  }
  if (hits.length > shown.length) say(`ほか ${hits.length - shown.length} 件: ${hits.slice(max).map((h) => h.title).join(' / ')}`);
  return shown;
}

export async function addSkill({ ROOT, title, file = null, body = null, say = console.log }) {
  const dir = path.join(ROOT, 'skills');
  const t = title ?? await ask('何が分かりましたか（見出し）> ');
  if (!t) { say('見出しが要ります: npm run skill -- "見出し"'); return null; }

  const key = file ?? await ask(`どこに足しますか（${Object.keys(FILES).join(' / ')}。Enter で pitfall）> `, 'pitfall');
  const name = FILES[key] ?? key;
  const target = path.join(dir, name);
  if (!fs.existsSync(target)) { say(`${name} がありません。${Object.keys(FILES).join(' / ')} から選んでください`); return null; }

  const text = body ?? await ask('中身（コードや注意を 1 行で）> ');
  const rep = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.bds-lab', 'report.json'), 'utf8')); } catch { return null; }
  })();

  const entry = [
    '',
    `## ${t}`,
    text,
    rep?.version ? `確かめた実機: ${rep.version}` : '',
  ].filter(Boolean).join('\n');

  fs.appendFileSync(target, `${entry}\n`);
  say(`skills/${name} に足しました: ${t}`);
  return target;
}
