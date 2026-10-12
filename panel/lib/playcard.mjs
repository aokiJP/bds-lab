// playcard: a short card for the people who play an addon — what it does, the commands they type and the items they get —
// made from the unit's own files: TASK.md's first paragraph (what it does; else the pack's description), tests.txt's
// `@A cmd /ns:x ..` lines (the commands; what each does from the TASK.md line that names it, else an example from the tests)
// and its `give A ns:item` / `@A select|place ns:item` lines (the items), and bp/manifest.json's name (the title). Minecraft's
// own (minecraft:, /function and the like) is left out: only what the addon adds. Also as Markdown, for a release's notes.
// Pure: no DOM, no fetch, no node:.
import { parseManifest, taskTitle } from './units.mjs';

/** at most this many commands and items on a card */
export const CARD_LIMIT = 12;
/** the card's words in each language it is written in (the addon's own words stay as they are) */
export const WORDS = {
  ja: { what: '何ができるか', commands: 'コマンド', items: 'アイテム', example: '例', none: 'まだ書かれていません' },
  en: { what: 'What it does', commands: 'Commands', items: 'Items', example: 'e.g.', none: 'Not written yet' },
};
// (an addon's own command / item id: a namespace that is not minecraft's)
const ID = /^(?!minecraft:)[a-z0-9_.-]{1,32}:[a-z0-9_./-]{1,64}$/;
// (Minecraft's § colour codes, HTML comments and runs of spaces out)
const plain = (s) => String(s ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/§./g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// (a TASK.md line as words: its list mark, check box, emphasis and the `（## test name）` it ends with out)
const prose = (line) => plain(String(line).replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/^\[[ xX]\]\s*/, '').replace(/[（(]##[^）)]*[）)]\s*$/, '').replace(/[*_`]/g, ''));

/** TASK.md's first paragraph (pure): the first run of lines that are not a heading, a comment or empty → one line of words
 *  (at most 300 characters); '' when it has none */
export function firstParagraph(text) {
  const lines = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/), out = [];
  for (const l of lines) {
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) { if (out.length) break; continue; }
    out.push(prose(l));
  }
  return cut(out.filter(Boolean).join(' '), 300);
}

/** tests.txt → { commands: [{ name: '/ns:x', example: '/ns:x B 20' }], items: ['ns:item'] } in the order first seen (pure):
 *  the addon's own, each once */
export function fromTests(text) {
  const commands = new Map(), items = new Set();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const l = raw.trim();
    let m = /^@\w+\s+cmd\s+(\/(\S+)(?:\s.*)?)$/.exec(l);
    if (m && ID.test(m[2]) && !commands.has(m[2])) commands.set(m[2], { name: `/${m[2]}`, example: cut(plain(m[1]), 80) });
    m = /^(?:\/?give\s+\S+|@\w+\s+(?:select|place))\s+(\S+)/.exec(l);
    if (m && ID.test(m[1])) items.add(m[1]);
  }
  return { commands: [...commands.values()], items: [...items] };
}

/** what TASK.md says of this command (pure) → { usage: '/ns:x <相手> <額>', say } or null. say: the first sentence that names
 *  it — only its own clause (split at 、 or ,) when the sentence names another command too */
function fromTask(task, name) {
  const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:./-])((?:\\s+(?:<[^<>\\n]{1,20}>|\\[[^[\\]\\n]{1,20}\\]))*)`);
  let usage = null, say = null;
  for (const line of String(task ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const s of prose(line).split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/)) {
      const m = re.exec(s);
      if (!m) continue;
      if (!usage || (m[1] && usage === name)) usage = plain(`${name}${m[1]}`);
      if (!say) {
        const others = (s.match(/\/[a-z0-9_.-]+:[a-z0-9_./-]+/g) ?? []).some((c) => c !== name);
        say = (others ? s.split(/[、,]\s*/).find((c) => re.test(c)) : null) ?? s;
      }
    }
  }
  return usage ? { usage, say: cut(say.replace(/[。．.]$/, ''), 120) } : null;
}

/** the card (pure): { task, tests, manifest } are the files' texts (null: not there); lang 'ja' | 'en' (the card's own words)
 *  → { title, what, commands: [{ cmd, say }], items, md }. cmd: how it is typed (`/ns:x <相手>` when TASK.md shows it);
 *  say: TASK.md's line that names it, else an example from the tests */
export function playcard({ task = null, tests = null, manifest = null, lang = 'ja' } = {}) {
  const w = WORDS[lang] ?? WORDS.ja, m = manifest === null ? null : parseManifest(manifest);
  const title = m?.name || taskTitle(task) || '';
  const what = firstParagraph(task) || m?.description || '';
  const found = fromTests(tests);
  const commands = found.commands.slice(0, CARD_LIMIT).map((c) => {
    const t = fromTask(task, c.name);
    return { cmd: t?.usage ?? c.name, say: t?.say || `${w.example}: ${c.example}` };
  });
  const items = found.items.slice(0, CARD_LIMIT);
  return { title, what, commands, items, md: toMarkdown({ title, what, commands, items }, w) };
}

// (Markdown: the words escaped so that a < or a * in them is shown, not read; code in backticks without backticks in it)
const esc = (s) => String(s).replace(/([\\`*_[\]<>|#])/g, '\\$1');
const code = (s) => `\`${String(s).replace(/`/g, '')}\``;
function toMarkdown({ title, what, commands, items }, w) {
  const out = [];
  if (title) out.push(`## 🎮 ${esc(title)}`, '');
  out.push(`### ${w.what}`, '', what ? esc(what) : `_${w.none}_`, '');
  if (commands.length) out.push(`### ${w.commands}`, '', ...commands.map((c) => `- ${code(c.cmd)} — ${esc(c.say)}`), '');
  if (items.length) out.push(`### ${w.items}`, '', ...items.map((i) => `- ${code(i)}`), '');
  return `${out.join('\n').trimEnd()}\n`;
}
