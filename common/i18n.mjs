// Every language of a unit has every text (rp/texts: items, blocks, entities...; bp/texts: the pack's name and description).
//   node lab.mjs i18n [-a <unit>]              what each language lacks, with the text another one has (zero tokens)
//   node lab.mjs i18n <lang> "key=text" ...    writes those lines (no .lang file to open and edit: what fixing a QA line needs)
//   node lab.mjs i18n --ai [--via ..] [--model ..]   fills every missing line with one small AI call per language (only the
//                                              missing lines are sent; default a small model)
//   node lab.mjs i18n --add <lang> [--ai]      a new language: languages.json + its .lang file (then filled with --ai)
import fs from 'node:fs';
import path from 'node:path';

export const LANGS = 'en_US en_GB de_DE es_ES es_MX fr_FR fr_CA it_IT ja_JP ko_KR pt_BR pt_PT ru_RU zh_CN zh_TW nl_NL bg_BG cs_CZ da_DK el_GR fi_FI hu_HU id_ID nb_NO pl_PL sk_SK sv_SE tr_TR uk_UA'.split(' ');
const NAMES = { en_US: 'English', en_GB: 'British English', de_DE: 'German', es_ES: 'Spanish (Spain)', es_MX: 'Spanish (Mexico)', fr_FR: 'French', fr_CA: 'French (Canada)', it_IT: 'Italian', ja_JP: 'Japanese', ko_KR: 'Korean', pt_BR: 'Portuguese (Brazil)', pt_PT: 'Portuguese (Portugal)', ru_RU: 'Russian', zh_CN: 'Simplified Chinese', zh_TW: 'Traditional Chinese', nl_NL: 'Dutch', bg_BG: 'Bulgarian', cs_CZ: 'Czech', da_DK: 'Danish', el_GR: 'Greek', fi_FI: 'Finnish', hu_HU: 'Hungarian', id_ID: 'Indonesian', nb_NO: 'Norwegian', pl_PL: 'Polish', sk_SK: 'Slovak', sv_SE: 'Swedish', tr_TR: 'Turkish', uk_UA: 'Ukrainian' };
const parse = (t) => { const m = new Map(); for (const l of t.replace(/^﻿/, '').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) m.set(l.slice(0, i).trim(), l.slice(i + 1).split('\t#')[0].trimEnd()); } return m; };
/** a unit's texts: { packs: [{ dir, langs, texts: {lang → Map} }] } */
export function texts(unit) {
  const packs = [];
  for (const p of ['rp', 'bp']) {
    const dir = path.join(unit, p, 'texts');
    if (!fs.existsSync(dir)) continue;
    let langs; try { langs = JSON.parse(fs.readFileSync(path.join(dir, 'languages.json'), 'utf8')); } catch { langs = fs.readdirSync(dir).filter((f) => f.endsWith('.lang')).map((f) => f.slice(0, -5)); }
    packs.push({ p, dir, langs, texts: Object.fromEntries(langs.map((l) => { try { return [l, parse(fs.readFileSync(path.join(dir, l + '.lang'), 'utf8'))]; } catch { return [l, new Map()]; } })) });
  }
  return { packs };
}
/** [{ p, dir, lang, key, ref, refLang }]: every line a language lacks (ref = the text in en_US, else the first that has it) */
export function missing(unit) {
  const res = [];
  for (const pk of texts(unit).packs) {
    const all = new Set(Object.values(pk.texts).flatMap((m) => [...m.keys()]));
    for (const l of pk.langs) for (const key of all) if (!pk.texts[l].has(key)) {
      const refLang = ['en_US', ...pk.langs].find((x) => pk.texts[x]?.has(key) && x !== l);
      res.push({ p: pk.p, dir: pk.dir, lang: l, key, ref: pk.texts[refLang]?.get(key) ?? '', refLang });
    }
  }
  return res;
}
/** writes key=text lines into <dir>/<lang>.lang (a key already there gets the new text) */
export function write(dir, lang, pairs) {
  const f = path.join(dir, lang + '.lang');
  let lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n') : [];
  if (lines.at(-1) === '') lines.pop();
  for (const [k, v] of pairs) { const i = lines.findIndex((l) => l.slice(0, l.indexOf('=')).trim() === k && l.indexOf('=') > 0); const line = `${k}=${String(v).replace(/\r?\n/g, '\\n')}`; if (i >= 0) lines[i] = line; else lines.push(line); }
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, lines.join('\n') + '\n');
}
export function prompt(from, to, rows) {
  return [`Translate the text of these Minecraft Bedrock addon language-file lines from ${NAMES[from] ?? from} to ${NAMES[to] ?? to}.`,
    `Keep each key (left of "=") exactly. Keep §-codes, %s %d %1$s and other % placeholders, {braces} and \\n as they are. Use the words the official ${NAMES[to] ?? to} Minecraft uses for items, blocks and mobs. As short as the original.`,
    'Answer with only the translated lines, one per line, key=text, nothing else.', '', ...rows.map(([k, v]) => `${k}=${v}`)].join('\n');
}
export function answer(text, keys) { const want = new Set(keys), got = new Map(); for (const l of String(text).split(/\r?\n/)) { const m = /^\s*([^=\s#`][^=]*?)\s*=(.*)$/.exec(l.replace(/^[-*]\s+/, '')); if (m && want.has(m[1]) && m[2].trim()) got.set(m[1], m[2].trim()); } return got; }

export async function i18nCmd(args, out = console.log) {
  const { labKind, currentUnit, unitDir } = await import('./checkpoint.mjs');
  const opt = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const k = labKind(), u = currentUnit(k, args), dir = unitDir(k, u);
  const add = opt('--add');
  if (add) {
    if (!LANGS.includes(add)) { out(`ERR ${add}: one of ${LANGS.join(' ')}`); return false; }
    const ps = texts(dir).packs; if (!ps.length) { out(`ERR ${u} has no texts/ (rp/texts or bp/texts)`); return false; }
    for (const pk of ps) if (!pk.langs.includes(add)) { fs.writeFileSync(path.join(pk.dir, 'languages.json'), JSON.stringify([...pk.langs, add]) + '\n'); write(pk.dir, add, []); }
    out(`OK ${add} added to ${ps.map((x) => x.p + '/texts').join(' ')}`);
  }
  const pos = args.filter((a, i) => !a.startsWith('--') && !['-a', '--add', '--via', '--model'].includes(args[i - 1]) && a !== '-a');
  if (pos.length && !add) {   // i18n <lang> key=text ...
    const [lang, ...kv] = pos, pairs = kv.map((x) => [x.slice(0, x.indexOf('=')).trim(), x.slice(x.indexOf('=') + 1)]).filter(([key]) => key);
    if (!LANGS.includes(lang) || !pairs.length) { out('usage: node lab.mjs i18n <lang> "key=text" ...   (lang: ja_JP, en_US ...)'); return false; }
    const where = (key) => texts(dir).packs.find((pk) => Object.values(pk.texts).some((m) => m.has(key))) ?? texts(dir).packs[0];
    const by = new Map(); for (const [key, v] of pairs) { const pk = where(key); (by.get(pk.dir) ?? by.set(pk.dir, []).get(pk.dir)).push([key, v]); }
    for (const [d, ps] of by) write(d, lang, ps);
    out(`OK ${lang}: ${pairs.length} line(s) written`);
  }
  let miss = missing(dir);
  if (args.includes('--ai') && miss.length) {
    const { pickVia, ask1 } = await import('./make.mjs'), via = pickVia(opt('--via'));
    if (!via) { out('ERR --ai needs an AI: ANTHROPIC_API_KEY or OPENAI_API_KEY in .env (node lab.mjs login ai), or the claude / codex / gemini CLI'); return false; }
    let tokens = 0;
    const groups = new Map(); for (const m of miss) if (m.ref) { const g = `${m.dir}\u0000${m.lang}\u0000${m.refLang}`; (groups.get(g) ?? groups.set(g, []).get(g)).push(m); }
    for (const [g, ms] of groups) {
      const [d, lang, from] = g.split('\u0000');
      for (let i = 0; i < ms.length; i += 150) {
        const rows = ms.slice(i, i + 150).map((m) => [m.key, m.ref]);
        try { const r = await ask1(via, prompt(from, lang, rows), { model: opt('--model') }); tokens += r.tokens; const got = answer(r.text, rows.map(([key]) => key)); write(d, lang, [...got]); out(`  ${lang}: +${got.size}/${rows.length} (${from} → ${lang})`); }
        catch (e) { out(`E i18n ${lang}: ${e.message.slice(0, 200)}`); }
      }
    }
    miss = missing(dir);
    out(`  AI ${via}${tokens ? `: ${tokens.toLocaleString('en')} tokens` : ''}`);
  }
  if (!miss.length) { out(`OK i18n ${u}: every language has every line (${texts(dir).packs.map((pk) => `${pk.p}: ${pk.langs.join(' ')}`).join(' | ')})`); return true; }
  const by = new Map(); for (const m of miss) (by.get(m.lang) ?? by.set(m.lang, []).get(m.lang)).push(m);
  for (const [lang, ms] of by) { out(`${lang} lacks ${ms.length}:`); ms.slice(0, 30).forEach((m) => out(`  ${m.key}=${m.ref ? m.ref : ''}   (${m.refLang ?? '-'})`)); if (ms.length > 30) out(`  … +${ms.length - 30}`); }
  out(`W i18n ${u}: ${miss.length} line(s) missing → node lab.mjs i18n <lang> "key=text" ... | i18n --ai`);
  return false;
}
