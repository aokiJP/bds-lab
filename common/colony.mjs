// node lab.mjs colony: Crafters Colony (minecraft-mcworld.com) — people's distributed worlds and addons, into the lab.
// The site client, zip, level.dat, LevelDB and sub-chunk readers are sandbox-be's (sandbox-be/src/colony/, no dependencies);
// this is the command around them.
//   search <words> [--cat <id|name>] [--sort new|dl|rating|weekly|monthly|all] [--page n] · new [--cat <id|name>] · show <post> · cats
//   get <post> [--type mcworld|mcaddon|mcpack|zip] [--max-mb n]   download (the site's own button), checked (CRC), then inspected
//   inspect|verify <file|post> · repack <file> [--out f] · convert <file> --chunker <jar> [--format F] [--out f]
//   install <file|post> [--dir <minecraftWorlds>] [--name n] · packs <file|post> [--sim] [--ticks n]
//   import <file|post> ["<request>"] [--pack <name>] [--name n]   its addon (or the world's behavior pack) as a unit
//   voxel <file|post> [--radius n] [--height n] [--out course.json]   the terrain around spawn → a sandbox course
//   harvest [--n 5] [--seed s] [--max-requests 40] [--retry] …   other people's addons never seen before that work on the
//     latest BDS, kept as borrowed units (common/borrow.mjs: seen record, the mark, the guards) · borrowed · diff · borrow
// Read-only and polite: one request per 2.5–5 s and at most 80 an hour, remembered across runs (.lab/colony/throttle.json);
// pages are kept an hour (--fresh asks again). Never likes, counts views, comments or posts (site.js says why).
// Downloads go to .lab/colony/<post>/ (node lab.mjs clean --deep removes them). <post> is a number or the post's URL.
// LAB_COLONY_DIR: another folder. COLONY_ORIGIN / LAB_COLONY_DELAY_MS: a stand-in site and no waiting (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(TOP, 'sandbox-be', 'src', 'colony');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const DIR = () => path.resolve(process.env.LAB_COLONY_DIR || path.join(TOP, '.lab', 'colony'));
const HOUR = 3600_000;
const USAGE = `usage: node lab.mjs colony <command> (Crafters Colony, minecraft-mcworld.com: people's distributed worlds and addons)
  search <words> [--cat <id|name>] [--sort s] [--page n]   posts that match (newest first; --sort dl|rating|weekly|monthly|all)
  new [--cat <id|name>]                         the newest posts (one request)
  cats                                          the categories (ids and names)
  show <post>                                   a post: author, category, info, its download buttons
  get <post> [--type mcworld|mcaddon|mcpack|zip] [--max-mb n]  download it (checked), then what it is
  inspect <file|post>                           what a file is: Bedrock or Java world, addon; level.dat; bundled packs
  repack <file> [--out f]                       a zip with the world one folder down → a proper .mcworld
  convert <file> --chunker <jar> [--format F]   a Java world → Bedrock (Chunker CLI, needs java)
  install <file|post> [--dir d] [--name n]      the world into Minecraft's worlds folder (close the game first)
  packs <file|post> [--sim] [--ticks n]         the packs inside a world; --sim runs each behavior pack in the sandbox
  import <file|post> ["<request>"] [--pack p] [--name n]   its addon (or the world's behavior pack) as a unit here
  voxel <file|post> [--radius n] [--height n] [--out f]    the terrain around spawn as a sandbox course (course.json)
  harvest [--n 5] [--seed s] [--max-requests 40] [--min-version 1.21] [--worlds] [--any] [--allow-risk] [--retry] [--sim-only]
                                                random addon posts never seen before → kept only if they work on this BDS
                                                (brief, schemas, sim, the draft tests on a real BDS): bds/addons/borrowed_<post>
  borrowed                                      the borrowed units: where from, the post's rules, the verdict
  diff <unit|post>                              a borrowed unit against its original file (what you changed)
  borrow <file> [--url u] [--author a] [--sim-only]   the same verdict for a file you got from another site (by hand)
  (borrowed units are someone else's: run, fix and learn here; share / ship / publish / bundle / host never carry them)
<post>: the number in the post's URL (https://minecraft-mcworld.com/<post>/) or the URL itself; <file>: a path, or a post you got`;

// ---------------------------------------------------------------- arguments
function parse(args) {
  const flags = {}, pos = [];
  const VAL = new Set(['--cat', '--page', '--sort', '--type', '--max-mb', '--out', '--chunker', '--format', '--dir', '--name', '--ticks', '--radius', '--height', '--pack', '--n', '--seed', '--max-requests', '--min-version', '--url', '--author']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VAL.has(a)) { flags[a.slice(2)] = args[++i]; continue; }
    if (/^--[\w-]+=/.test(a)) { const k = a.slice(2, a.indexOf('=')); flags[k] = a.slice(a.indexOf('=') + 1); continue; }
    if (a.startsWith('--')) { flags[a.slice(2)] = true; continue; }
    pos.push(a);
  }
  return { flags, pos };
}
export const postId = (s) => { const m = /^(\d{3,})$/.exec(String(s ?? '').trim()) ?? /minecraft-mcworld\.com\/(\d{3,})\/?/.exec(String(s ?? '')) ?? /^https?:\/\/[^/]+\/(\d{3,})\/?$/.exec(String(s ?? '')); return m ? m[1] : null; };
const where = (p) => path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), p);
const shown = (p) => { const r = path.relative(TOP, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; };
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'download';

// ---------------------------------------------------------------- the site, politely
let SITE = null, CLIENT = null;
async function site() { return (SITE ??= await imp('site.js')); }
async function client() {
  if (CLIENT) return CLIENT;
  const S = await site(), d = Number(process.env.LAB_COLONY_DELAY_MS);
  const t = Number.isFinite(d) && d >= 0 ? new S.Throttle({ minDelay: d, maxDelay: d }) : new S.Throttle();
  // the hour's requests and the last one, from earlier runs too (a loop of `colony show` stays as polite as one run)
  const f = path.join(DIR(), 'throttle.json'), st = readJson(f, {});
  t.stamps = (st.stamps ?? []).filter((x) => Date.now() - x < HOUR); t.last = Number(st.last) || 0;
  const gate = t.gate.bind(t);
  t.gate = async () => { await gate(); try { writeJson(f, { stamps: t.stamps, last: t.last }); } catch { /* read-only */ } };
  return (CLIENT = new S.Client(t));
}
// a page kept an hour (the same post asked twice is one request)
async function cached(key, fresh, get) {
  const f = path.join(DIR(), 'cache', key.replace(/[^\w.-]+/g, '_') + '.json'), c = readJson(f);
  if (c && !fresh && Date.now() - c.at < HOUR) return c.v;
  const v = await get();
  try { writeJson(f, { at: Date.now(), v }); } catch { /* read-only */ }
  return v;
}
async function post(id, fresh = false) {
  const S = await site(), c = await client(), B = await import('./borrow.mjs');
  // (the rules the page states about its files — 二次配布・改変 … — go with it: a borrowed unit carries them)
  return cached(`post-${id}`, fresh, async () => { const html = await c.html(`${S.ORIGIN}/${id}/`); return { ...S.parsePost(html, id), rules: B.rulesOf(html) }; });
}
async function catId(v) {
  if (v == null || v === true) return null;
  const S = await site();
  if (/^\d+$/.test(String(v))) { if (!S.CATS[v]) throw new Error(`no category ${v} (node lab.mjs colony cats)`); return Number(v); }
  const hit = Object.entries(S.CATS).filter(([, n]) => n.toLowerCase().includes(String(v).toLowerCase()));
  if (!hit.length) throw new Error(`no category like "${v}" (node lab.mjs colony cats)`);
  if (hit.length > 1 && !hit.some(([, n]) => n.toLowerCase() === String(v).toLowerCase())) throw new Error(`"${v}" is several categories: ${hit.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  return Number((hit.find(([, n]) => n.toLowerCase() === String(v).toLowerCase()) ?? hit[0])[0]);
}
const line = (p) => `${String(p.id).padEnd(7)} ${String(p.date ?? '').slice(0, 10).padEnd(10)} ${(p.catNames?.[0] ?? '').padEnd(12)} ${p.title}`;

// ---------------------------------------------------------------- files: a path, or what was got for a post
function fileOf(arg) {
  if (!arg) throw new Error('which file? (a path, or a post you got with: node lab.mjs colony get <post>)');
  const p = where(arg);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  const id = postId(arg);
  if (id) {
    const info = readJson(path.join(DIR(), id, 'info.json'));
    if (info?.file && fs.existsSync(info.file)) return info.file;
    throw new Error(`post ${id} is not downloaded yet: node lab.mjs colony get ${id}`);
  }
  throw new Error(`no file ${arg}`);
}
const javaWorldHint = (f) => `a Java Edition world: node lab.mjs colony convert ${f} --chunker <chunker-cli.jar> (https://github.com/HiveGamesOSS/Chunker/releases; needs java)`;

// ---------------------------------------------------------------- commands
// the site's own list page (its sorts: by downloads, rating, the week's and month's views …; and when its REST index does not
// answer): post numbers with the titles the links carry
async function listPage(S, c, { words, cat, sort, page }) {
  const html = await c.html(S.pageUrl(S.listUrl({ search: words || undefined, cat: cat || undefined, sort }), page));
  if (S.noResults(html)) return [];
  return S.extractPostIds(html).map((id) => {
    const texts = [...html.matchAll(new RegExp(`href=["'](?:https?://minecraft-mcworld\\.com)?/${id}/?["'][^>]*>([\\s\\S]*?)</a>`, 'g'))].map((m) => S.ent(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean);
    return { id, title: texts.sort((a, b) => b.length - a.length)[0] ?? '(title: colony show ' + id + ')' };
  });
}
async function searchCmd({ pos, flags }, out) {
  const words = pos.join(' ').trim();
  if (!words && !flags.cat) { out('usage: node lab.mjs colony search <words> [--cat <id|name>] [--sort new|dl|rating|weekly|monthly|all] [--page n]'); return false; }
  const S = await site(), c = await client(), cat = await catId(flags.cat), page = Math.max(1, Number(flags.page) || 1), per = 20;
  const sort = flags.sort ? String(flags.sort) : 'new';
  if (!S.SORTS.includes(sort)) throw new Error(`--sort is one of ${S.SORTS.join(' ')}`);
  let r = null;
  // newest first: the site's REST index, titles and categories for 20 posts in one request (the list page shows 12, titles only)
  if (sort === 'new') {
    try {
      r = await cached(`search-${words}-${cat}-${page}`, !!flags.fresh, async () => {
        const x = await S.restIndex(c, { search: words || undefined, cat: cat || undefined, page, pages: 1, perPage: per, fields: 'id,link,date,title,categories' });
        return { total: x.total ?? x.posts.length, posts: x.posts.map((p) => ({ id: p.id, date: p.date, title: p.title, catNames: p.catNames })) };
      });
    } catch (e) { out(`W the site's index did not answer (${e.message}): its list page instead`); }
  }
  if (!r) {
    const posts = await cached(`list-${words}-${cat}-${sort}-${page}`, !!flags.fresh, () => listPage(S, c, { words, cat, sort, page }));
    r = { total: null, posts };
  }
  if (!r.posts.length) { out(`no posts for "${words}"${cat ? ` in ${S.CATS[cat]}` : ''}${page > 1 ? ` on page ${page}` : ''}`); return true; }
  for (const p of r.posts) out(p.date ? line(p) : `${String(p.id).padEnd(7)} ${p.title}`);
  const more = r.total == null ? r.posts.length >= 12 : r.total > page * per;
  out(`${r.total ?? r.posts.length} post(s)${more ? ` — next page: --page ${page + 1}` : ''}; next: node lab.mjs colony show ${r.posts[0].id}`);
  return true;
}
async function newCmd({ flags }, out) {
  const S = await site(), c = await client(), cat = await catId(flags.cat);
  const items = await cached('feed', !!flags.fresh, async () => S.parseFeed(await c.html(`${S.ORIGIN}/feed/`)));
  const shown = items.filter((x) => !cat || x.cats.includes(S.CATS[cat]) || x.cats.some((n) => S.CATS[cat].endsWith(n)));
  for (const x of shown) out(line({ id: x.id, date: new Date(x.date).toISOString(), title: x.title, catNames: x.cats }));
  out(shown.length ? `${shown.length} newest post(s); next: node lab.mjs colony show ${shown[0].id}` : `none of the ${items.length} newest posts is in ${S.CATS[cat]}`);
  return true;
}
async function catsCmd(_, out) {
  const S = await site();
  for (const [k, n] of Object.entries(S.CATS)) out(`${String(k).padEnd(4)} ${n}${S.JE_CATS.has(Number(k)) ? '  (Java Edition: worlds need convert)' : ''}`);
  return true;
}
async function showCmd({ pos, flags }, out) {
  const id = postId(pos[0]);
  if (!id) { out('usage: node lab.mjs colony show <post> (the number in https://minecraft-mcworld.com/<post>/)'); return false; }
  const p = await post(id, !!flags.fresh);
  out(`${p.title}  (${p.url})`);
  out(`by ${p.author?.name || 'a guest'} · ${p.catNames.join(', ') || 'no category'}${p.isJava ? ' · Java Edition' : ''} · ${String(p.published ?? '').slice(0, 10)}${p.modified && p.modified !== p.published ? ` (updated ${String(p.modified).slice(0, 10)})` : ''}${p.views != null ? ` · ${p.views} views` : ''}`);
  if (p.tags.length) out(`tags: ${p.tags.slice(0, 12).join(', ')}`);
  for (const [k, v] of Object.entries(p.info).slice(0, 12)) out(`  ${k}: ${v}`);
  if (p.description) out(p.description.slice(0, 300));
  if (!p.buttons.length) { out('no download button on this post (a link in its text only: open the page)'); return true; }
  for (const [i, b] of p.buttons.entries()) out(`[${i + 1}] ${b.kind}${b.count ? ` · ${b.count} downloads` : ''}${b.dest ? ` · from ${new URL(b.dest).hostname}${b.hosted ? '' : ' (not a file host: open it yourself)'}` : ''} · ${b.label}`);
  out(`next: node lab.mjs colony get ${id}${p.buttons.length > 1 ? ` [--type ${p.buttons.map((b) => b.kind).filter((v, i, a) => a.indexOf(v) === i).join('|')}]` : ''}`);
  return true;
}

// a file host's page instead of the file: the real link inside it (Google Drive's "can't scan" form, MediaFire's button)
export function realLink(html, url) {
  const S_ = (s) => s.replace(/&amp;/g, '&');
  const mf = /href="(https:\/\/download\d*\.mediafire\.com\/[^"]+)"/i.exec(html);
  if (mf) return S_(mf[1]);
  const form = /<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/i.exec(html);
  if (form) {
    const u = new URL(S_(form[1]), url);
    for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) u.searchParams.set(m[1], S_(m[2]));
    return u.toString();
  }
  return null;
}
async function fetchFile(url, dir, fallback, { maxBytes, referer, hops = 0 }) {
  const S = await site(), c = await client();
  const res = await c.raw(url, { referer, accept: '*/*' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type)) {
    const html = await res.text(), next = hops < 2 && realLink(html, res.url);
    if (next) return fetchFile(next, dir, fallback, { maxBytes, referer: res.url, hops: hops + 1 });
    throw new Error(`the link gave a web page, not a file (a sign-in, a wait or a confirm page): open it in a browser and save the file, then: node lab.mjs colony inspect <file> — ${res.url}`);
  }
  const len = Number(res.headers.get('content-length')) || 0;
  if (len && len > maxBytes) { await res.body?.cancel(); throw new Error(`${kb(len)} is over --max-mb ${Math.round(maxBytes / 1e6)} (say a larger --max-mb to take it)`); }
  const name = safeName(S.filenameFrom(res, fallback)), file = path.join(dir, name), tmp = file + '.part';
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const limit = new TransformCount(maxBytes, (k) => { n = k; });
  try { await pipeline(Readable.fromWeb(res.body), limit, fs.createWriteStream(tmp)); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  fs.renameSync(tmp, file);
  return { file, bytes: n, url: res.url };
}
// counts what passes and stops past the limit (a server that sends more than it said, or no length at all)
class TransformCount extends Transform {
  constructor(max, onCount) { super(); this.n = 0; this.max = max; this.onCount = onCount; }
  _transform(chunk, _e, cb) { this.n += chunk.length; this.onCount(this.n); if (this.n > this.max) cb(new Error(`over --max-mb ${Math.round(this.max / 1e6)} while downloading (say a larger --max-mb)`)); else cb(null, chunk); }
}

// a post's file, downloaded and checked: { p, file, bytes, info, check, dir } (kinds: the order of what to take first; got: the
// post already read — harvest's — not asked for again)
async function download(id, { type, maxMb, fresh = false, kinds = null, got: p0 = null } = {}, out = () => {}) {
  // (a post is a number: it names a folder here, and a folder is deleted by it)
  if (!/^\d{1,12}$/.test(String(id))) throw new Error(`post ${String(id).slice(0, 40)} is not a post number`);
  const S = await site(), p = p0 ?? await post(id, fresh);
  if (!p.buttons.length) throw new Error(`post ${id} has no download button (its files are linked in its text: ${p.url})`);
  const want = type && String(type).toLowerCase();
  // a file the site or a known file host serves; .mcworld before .zip (a zip often holds the world one folder down);
  // kinds (harvest): only those, in that order
  const order = (b) => (want && b.kind !== want ? 9 : 0) + (kinds && !kinds.includes(b.kind) ? 9 : 0) + (b.dest && !b.hosted ? 4 : 0) + (kinds ? kinds.indexOf(b.kind) : ['mcworld', 'mcaddon', 'mcpack'].includes(b.kind) ? 0 : b.kind === 'zip' ? 1 : 2);
  const b = [...p.buttons].sort((x, y) => order(x) - order(y))[0];
  if (want && b.kind !== want) throw new Error(`post ${id} has no ${want} button (it has: ${p.buttons.map((x) => x.kind).join(', ')})`);
  if (b.dest && !b.hosted) throw new Error(`its download is on another site (${b.dest}): open it, save the file, then node lab.mjs colony inspect <file>`);
  const dir = path.join(DIR(), id), maxBytes = (Number(maxMb) || 1024) * 1e6;
  out(`get ${id} "${p.title}" — ${b.kind}${b.dest ? ` from ${new URL(b.dest).hostname}` : ' from the site'} …`);
  const got = await fetchFile(b.dest ? S.directUrl(b.dest) : b.dlUrl, dir, `${id}.${['mcworld', 'mcaddon', 'mcpack'].includes(b.kind) ? b.kind : 'zip'}`, { maxBytes, referer: p.url });
  const W = await imp('world.js');
  let check;
  try { check = await W.verify(got.file); } catch (e) { check = { error: e.message }; }
  const info = await W.inspect(got.file).catch((e) => ({ kind: 'unknown', error: e.message }));
  writeJson(path.join(dir, 'info.json'), { post: { id, title: p.title, url: p.url, author: p.author?.name ?? null, cats: p.catNames, info: p.info, description: p.description, rules: p.rules ?? [] }, file: got.file, bytes: got.bytes, from: got.url, at: new Date().toISOString(), sha256: info.sha256 ?? null, kind: info.kind, check });
  return { p, file: got.file, bytes: got.bytes, info, check, dir };
}
async function getCmd({ pos, flags }, out) {
  const id = postId(pos[0]);
  if (!id) { out('usage: node lab.mjs colony get <post> [--type mcworld|mcaddon|mcpack|zip] [--max-mb n]'); return false; }
  // (looked at before by harvest: said, not refused — a person asking for this post gets it)
  const B = await import('./borrow.mjs'), was = B.seenAs(B.seenIndex(B.readSeen()), { post: id });
  if (was) out(`W seen before (${String(was.rec.at).slice(0, 10)}: ${was.rec.result}${was.rec.reason ? ` — ${was.rec.reason}` : ''}; auto/borrowed-seen.jsonl)`);
  const g = await download(id, { type: flags.type, maxMb: flags['max-mb'], fresh: !!flags.fresh }, out);
  out(`OK ${path.relative(process.env.LAB_CALLER_CWD ?? process.cwd(), g.file) || g.file} (${kb(g.bytes)})${g.check.error ? ` — W the zip is damaged: ${g.check.error} (get it again with --fresh, or from the post's page)` : `, ${g.check.entries} entries, CRC ok`}`);
  report(g.info, g.file, out, id);
  return !g.check.error;
}

// what a file is, and the one next step for it
function report(info, file, out, id = null) {
  const ref = id ?? file;
  if (info.kind === 'not-zip') { out(`not a zip (${info.error}): a .rar / .7z needs unpacking first, then inspect the .mcworld / .mcpack inside`); return; }
  if (info.level) {
    const L = info.level;
    out(`${info.kind === 'java-world' ? 'Java Edition' : 'Bedrock'} world "${info.levelName ?? L.name ?? '?'}"${L.version ? ` · saved with ${L.version}` : ''}${L.gameMode != null ? ` · ${L.gameMode}` : ''}${L.experiments?.length ? ` · experiments: ${L.experiments.filter((x) => !/^(experiments_ever_used|saved_with_toggled_experiments)$/.test(x)).join(', ') || 'none'}` : ''}`);
  } else if (info.kind === 'bedrock-world' || info.kind === 'java-world' || info.kind === 'world-unknown') out(`a world, level.dat unreadable: ${info.levelError ?? '?'}`);
  if (info.packs?.length) out(`packs inside: ${info.packs.join(', ')}`);
  if (info.manifest) out(`addon "${String(info.manifest.name ?? '?')}" ${(info.manifest.version ?? []).join?.('.') ?? ''} · modules ${info.manifest.modules.join(', ')}${info.manifest.minEngine ? ` · min engine ${info.manifest.minEngine.join('.')}` : ''}`);
  const next = info.kind === 'java-world' ? javaWorldHint(file)
    : info.nested ? `the world is one folder down (${info.root}): node lab.mjs colony repack ${file}`
    : info.kind === 'bedrock-world' ? `node lab.mjs colony install ${ref}${info.packs?.some((x) => x.startsWith('behavior_packs/')) ? ` · its behavior pack as a unit: node lab.mjs colony import ${ref}` : ''}`
    : info.kind === 'addon' ? `node lab.mjs colony import ${ref} "<what to fix or add>"`
    : `nothing a world or an addon (${info.entries ?? 0} entries): node lab.mjs colony inspect ${file} --list`;
  out(`next: ${next}`);
}
async function inspectCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), W = await imp('world.js');
  const info = await W.inspect(f);
  let check; try { check = await W.verify(f); } catch (e) { check = { error: e.message }; }
  out(`${path.basename(f)}: ${info.kind} · ${kb(info.size)} · ${info.entries ?? 0} entries · ${check.error ? `damaged: ${check.error}` : 'CRC ok'} · sha256 ${String(info.sha256).slice(0, 16)}`);
  if (flags.list) { const Z = await imp('zip.js'); for (const e of Z.listEntries(fs.readFileSync(f)).slice(0, 200)) out(`  ${e.dir ? 'd' : '-'} ${String(e.size).padStart(9)} ${e.name}`); }
  if (flags.json) out(JSON.stringify(info, null, 1));
  report(info, f, out, postId(pos[0]) && !fs.existsSync(where(pos[0])) ? pos[0] : null);
  return !check.error;
}
async function repackCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), W = await imp('world.js');
  const dest = flags.out ? where(flags.out) : f.replace(/\.(zip|mcworld)$/i, '') + '.mcworld';
  if (path.resolve(dest) === path.resolve(f)) throw new Error('--out is the file itself: give another name');
  const r = await W.repack(f, dest);
  out(`OK ${dest} (${r.entries} files, "${r.stripped}" taken off: the world is at the top now, as Minecraft opens it)`);
  return true;
}
async function convertCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), W = await imp('world.js');
  if (!flags.chunker) throw new Error(`--chunker <chunker-cli.jar> is needed (https://github.com/HiveGamesOSS/Chunker/releases)`);
  if (!(await W.hasJava())) throw new Error('java is not on this machine (Chunker runs on Java 17+)');
  out(`convert ${path.basename(f)} with Chunker (Java → ${flags.format ?? 'BEDROCK_1_21_93'}; players' inventories and entities do not carry over) …`);
  const r = await W.convertJavaToBedrock(f, { jar: where(flags.chunker), format: flags.format, outFile: flags.out ? where(flags.out) : undefined, onLog: (l) => { if (/error|warn|exception/i.test(l)) out('  ' + l); } });
  out(`OK ${r.outFile} (${kb(r.size)}); next: node lab.mjs colony install ${r.outFile}`);
  return true;
}
async function installCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), W = await imp('world.js');
  const info = await W.inspect(f);
  if (info.kind === 'java-world') throw new Error(javaWorldHint(f));
  if (info.kind !== 'bedrock-world') throw new Error(`${path.basename(f)} is not a Bedrock world (${info.kind})`);
  const dir = flags.dir ? where(flags.dir) : W.bedrockWorldsDir();
  if (!flags.dir && !fs.existsSync(dir)) out(`W ${dir} does not exist yet (another place? --dir <minecraftWorlds>; candidates: ${W.worldsDirCandidates().join(' | ')})`);
  const r = await W.install(f, { dir, name: flags.name ?? info.levelName ?? undefined });
  out(`OK ${r.dest} (${r.entries} files). Close Minecraft before installing a world and open it after: a running game can overwrite it`);
  return true;
}
async function packsCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), P = await imp('packs.js');
  const dir = path.join(DIR(), 'packs', safeName(path.basename(f).replace(/\.\w+$/, '')));
  fs.rmSync(dir, { recursive: true, force: true });
  const packs = await P.extractPacks(f, dir);
  if (!packs.length) { out(`no packs inside ${path.basename(f)} (a world without addons, or an addon file: node lab.mjs colony import ${pos[0]})`); return true; }
  let runSandbox = null;
  if (flags.sim) ({ runSandbox } = await import(pathToFileURL(path.join(TOP, 'sandbox-be', 'src', 'index.js')).href));
  for (const p of packs) {
    out(`${p.kind === 'behavior' ? 'bp' : 'rp'} "${String(p.name).replace(/§./g, '')}" ${(p.version ?? []).join?.('.') ?? ''}${p.apiVersion.length ? ` · ${p.apiVersion.join(' ')}` : ''}${p.scripts.length ? ` · ${p.scripts.length} script file(s), entry ${p.entry ?? '?'}` : ''} → ${shown(p.dir)}`);
    if (!runSandbox || p.kind !== 'behavior' || !p.hasScript) continue;
    const r = await P.runPack(p, { runSandbox, ticks: Number(flags.ticks) || 200 });
    if (r.skipped) { out(`  sim: ${r.skipped}`); continue; }
    out(`  sim: ${r.verdict}${r.remapped ? ` (ran as ${r.remapped}: the sandbox has no older version; a real BDS still runs the old one)` : ''}${r.unsupported?.length ? ` · not modelled: ${r.unsupported.slice(0, 8).join(', ')}` : ''}${r.chat ? ` · ${r.chat} chat line(s)` : ''}`);
    for (const e of r.errors ?? []) out(`  E ${String(e).split('\n')[0]}`);
  }
  out(`next: node lab.mjs colony import ${pos[0]}${packs.filter((p) => p.kind === 'behavior').length > 1 ? ' --pack <name>' : ''} (a unit to run on a real BDS: go, qa)`);
  return true;
}
async function importCmd({ pos, flags }, out) {
  const arg = pos[0], request = pos.slice(1).join(' ').trim(), f = fileOf(arg), W = await imp('world.js');
  const info = await W.inspect(f);
  const id = postId(arg) && !fs.existsSync(where(arg)) ? postId(arg) : null, meta = id ? readJson(path.join(DIR(), id, 'info.json'))?.post : null;
  const from = meta ? `Crafters Colony ${meta.url} "${meta.title}"${meta.author ? ` by ${meta.author}` : ''}` : path.basename(f);
  const req = request || `(from ${from}: write what to fix or add)`;
  let src = f;
  if (info.kind === 'bedrock-world' || info.kind === 'java-world' || info.kind === 'world-unknown') {
    // a world's own behavior pack (and the resource pack it needs) as one folder: import takes the first of each it finds
    const P = await imp('packs.js'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-colony-'));
    const packs = await P.extractPacks(f, tmp), bps = packs.filter((p) => p.kind === 'behavior');
    if (!bps.length) throw new Error(`${path.basename(f)} is a world with no behavior pack: nothing to import (install it to play: node lab.mjs colony install ${arg})`);
    const bp = flags.pack ? bps.find((p) => [p.folder, String(p.name).replace(/§./g, '')].some((n) => n.toLowerCase() === String(flags.pack).toLowerCase())) : (bps.find((p) => p.hasScript) ?? bps[0]);
    if (!bp) throw new Error(`no behavior pack "${flags.pack}" (it has: ${bps.map((p) => p.folder).join(', ')})`);
    if (bps.length > 1 && !flags.pack) out(`W ${bps.length} behavior packs (${bps.map((p) => p.folder).join(', ')}): importing ${bp.folder}; another with --pack <name>`);
    const man = readJson(path.join(bp.dir, 'manifest.json'), {}), need = new Set((man.dependencies ?? []).map((d) => d.uuid).filter(Boolean));
    const rps = packs.filter((p) => p.kind === 'resource');
    const rp = rps.find((p) => need.has(readJson(path.join(p.dir, 'manifest.json'), {})?.header?.uuid)) ?? (rps.length === 1 ? rps[0] : null);
    src = path.join(tmp, 'pick');
    fs.cpSync(bp.dir, path.join(src, 'bp'), { recursive: true });
    if (rp) fs.cpSync(rp.dir, path.join(src, 'rp'), { recursive: true });
  }
  const args = [path.join(TOP, 'lab.mjs'), 'bds', 'import', src, req, ...(flags.name ? ['--name', String(flags.name)] : [])];
  const r = spawnSync(process.execPath, args, { cwd: TOP, stdio: 'inherit', env: { ...process.env, LAB_CALLER_CWD: TOP } });
  if (src !== f) fs.rmSync(path.dirname(src), { recursive: true, force: true });
  return r.status === 0;
}
async function voxelCmd({ pos, flags }, out) {
  const f = fileOf(pos[0]), V = await imp('tovoxel.js');
  const { loadPlayerPhysics } = await import(pathToFileURL(path.join(TOP, 'sandbox-be', 'src', 'play', 'load.js')).href);
  const radius = Math.min(256, Math.max(4, Number(flags.radius) || 48)), height = Math.min(384, Math.max(8, Number(flags.height) || 48));
  // a post got here: its page's facts go with the course (players, difficulty, the time to clear it as the deadline)
  const meta = postId(pos[0]) && !fs.existsSync(where(pos[0])) ? readJson(path.join(DIR(), postId(pos[0]), 'info.json'))?.post : null;
  const post = meta ? { id: meta.id, url: meta.url, title: meta.title, author: meta.author ? { name: meta.author } : null, info: meta.info ?? {}, description: meta.description } : null;
  const course = await V.buildCourse(f, { radius, height, profile: loadPlayerPhysics(), post, name: post?.title });
  if (post) { const P = await imp('packs.js'), d = P.draftCourse(post); course.meta = d.meta; if (d.goal.deadline) course.goal.deadline = d.goal.deadline; }
  const dest = flags.out ? where(flags.out) : path.join(DIR(), 'courses', safeName(path.basename(f).replace(/\.\w+$/, '')) + '.json');
  writeJson(dest, course);
  const I = course.import;
  out(`OK ${dest}: ${I.blocks} blocks in ${I.runs} boxes around spawn ${course.world.origin.x},${course.world.origin.y},${course.world.origin.z} (radius ${radius}, height ${height}; ${I.subchunks.decoded}/${I.subchunks.total} sub-chunks read)`);
  if (I.spawn) out(`  level.dat puts spawn "on the surface" (SpawnY ${I.spawn.levelDat}): ${I.spawn.y == null ? 'no saved chunk there, y 64 taken' : `the ground is y ${I.spawn.y}${I.spawn.column.x !== course.world.origin.x || I.spawn.column.z !== course.world.origin.z ? ` (read at ${I.spawn.column.x},${I.spawn.column.z}, the nearest saved chunk)` : ''}`}`);
  if (I.db.problems.length) out(`W ${I.db.problems.length} table(s) unreadable: ${I.db.problems.slice(0, 2).join(' | ')}`);
  if (I.unknownBlocks.length) out(`  not measured in the sandbox's physics (the course is inconclusive where a player touches them): ${I.unknownBlocks.slice(0, 8).map(([n, c]) => `${n.replace(/^minecraft:/, '')}×${c}`).join(', ')}`);
  if (I.goalCandidates.length) out(`  goal candidates (far, rare blocks): ${I.goalCandidates.slice(0, 4).map((g) => `${g.type.replace(/^minecraft:/, '')} at ${g.rel.x},${g.rel.y},${g.rel.z}`).join(' · ')} — set goal.reach in the file`);
  if (!I.blocks) out(`W no blocks around spawn: a bigger --radius, or a world whose chunks there were never saved`);
  return true;
}

// ---------------------------------------------------------------- borrowing: harvest, borrowed, diff, borrow (common/borrow.mjs)
const UNITS_DIR = () => path.join(TOP, 'bds', 'addons');
const bdsNow = () => process.env.LAB_BORROW_BDS || (() => { try { return fs.readFileSync(path.join(TOP, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { return null; } })();
// the lab itself, as a child (its own output kept): import, check, sim, test. Then a turn of the event loop: a Ctrl+C that
// stopped the child is handled there (the unit being judged removed), before the next step starts
async function labRun(args, timeout = 600_000) {
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 64e6, env: { ...process.env, LAB_NOTRACE: '1', LAB_CALLER_CWD: TOP, LAB_GO_WHY: 'off' } });
  await new Promise((res) => setImmediate(res));
  return { ok: r.status === 0, lines: `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => l.trim()) };
}
// an .mcaddon of .mcpack files (no manifest.json at its top: a common shape) is an addon too, by the packs inside → info
async function asAddon(file, info) {
  if (info.kind !== 'unknown') return info;
  const B = await import('./borrow.mjs'), packs = await B.packIds(file).catch(() => []);
  return packs.length ? { ...info, kind: 'addon', packed: true } : info;
}
const firstBad = (r) => (r.lines.find((l) => /^(E |✘ |ERR |FAIL|die:)/.test(l)) ?? r.lines.at(-1) ?? '?').slice(0, 220);
/** does this addon file work on the latest BDS, as it is? → { kept, stage, reason, steps, unit }. The four checks, in order of
 *  cost: no module version this BDS lacks (the brief), the packs' JSON (schemas, check), the sandbox (sim: a hint, recorded)
 *  and the draft tests on a fresh real BDS (each way in once; any E line fails) — the real server decides; --sim-only: the
 *  sandbox alone, said so. A risky addon (scan) is dropped before anything runs it unless allowRisk */
async function judge(file, { unit, request, meta = {}, simOnly = false, allowRisk = false, worlds = false }, say = () => {}) {
  const W = await imp('world.js'), SC = await import('./scan.mjs'), B = await import('./borrow.mjs'), steps = {};
  let check; try { check = await W.verify(file); } catch (e) { check = { error: e.message }; }
  if (check.error) return { stage: 'file', reason: `壊れた zip（${String(check.error).slice(0, 120)}）`, steps };
  const info = await asAddon(file, await W.inspect(file).catch((e) => ({ kind: 'unknown', error: e.message })));
  const world = info.kind === 'bedrock-world' && (info.packs ?? []).some((x) => x.startsWith('behavior_packs/'));
  if (!(info.kind === 'addon' || (worlds && world))) return { stage: 'kind', reason: info.kind === 'bedrock-world' ? `ワールド${world ? '（--worlds で、その中のビヘイビアパックも）' : '（ビヘイビアパックなし）'}` : info.kind === 'java-world' ? 'Java 版のワールド' : `アドオンではない（${info.kind}）`, steps };
  const sc = SC.scanPath(file);
  steps.scan = sc.risks.length ? `RISK ${sc.risks.map(([w]) => w.split(':')[0]).join(' ')}` : 'ok';
  if (sc.risks.length && !allowRisk) return { stage: 'scan', reason: `RISK: ${sc.risks.map(([w]) => w).join(' / ').slice(0, 200)}（--allow-risk で試す）`, steps };
  say(`  import → bds/addons/${unit}`);
  const r1 = await labRun(['colony', 'import', file, request, '--name', unit]);
  if (!fs.existsSync(path.join(UNITS_DIR(), unit, 'bp'))) return { stage: 'import', reason: firstBad(r1), steps, unit };
  // (marked at once: while it is judged — minutes — and if this is killed, the guards stop it like a kept one)
  B.markPending(path.join(UNITS_DIR(), unit), meta);
  const miss = r1.lines.find((l) => /✗ not in this BDS/.test(l));
  steps.brief = miss ? miss.replace(/^modules: /, '') : (r1.lines.find((l) => /^on stable /.test(l)) ?? 'ok').slice(0, 200);
  if (miss) return { stage: 'brief', reason: `この BDS に無いモジュールの版: ${miss.replace(/^modules: /, '').slice(0, 180)}`, steps, unit };
  say('  check（パックの JSON・組み立て）');
  const r2 = await labRun(['bds', 'check', '-a', unit]);
  steps.check = r2.ok ? 'OK' : firstBad(r2);
  if (!r2.ok) return { stage: 'check', reason: firstBad(r2), steps, unit };
  say('  sim（サンドボックス: 目安）');
  const r3 = await labRun(['bds', 'sim', '-a', unit], 300_000);
  steps.sim = (r3.lines.find((l) => /^(PASS|FAIL) sim/.test(l)) ?? (r3.ok ? 'PASS' : 'FAIL')).replace(/ \(sandbox.*$/, '');
  if (simOnly) return r3.ok ? { kept: true, stage: 'sim', steps, unit, note: 'sim だけ（本物の BDS では確かめていません）' } : { stage: 'sim', reason: firstBad(r3), steps, unit };
  say('  test（下書きの試験を本物の BDS で）');
  const r4 = await labRun(['bds', 'test', '-a', unit], 900_000);
  steps.real = r4.lines.find((l) => /^(PASS|FAIL) \d+\/\d+/.test(l)) ?? (r4.ok ? 'PASS' : 'FAIL');
  if (!r4.ok && r4.lines.some((l) => /cannot download BDS|no server here|network blocked/i.test(l))) return { stage: 'real', reason: 'この PC に BDS がありません（node lab.mjs bds、または --sim-only）', steps, unit, fatal: true };
  if (!r4.ok) return { stage: 'real', reason: firstBad(r4), steps, unit };
  return { kept: true, stage: 'real', steps, unit };
}
// (only a borrowed unit's own folder, by a name that is one: a unit this run made — never one that was there before it)
const dropUnit = (unit) => { if (unit && /^borrowed_[a-z0-9_]+$/.test(unit)) fs.rmSync(path.join(UNITS_DIR(), unit), { recursive: true, force: true }); };
// Ctrl+C or a kill while a unit is judged: that unit and its download go, the current unit is put back, then the exit
function onStop(state) {
  const h = (sig) => { try { dropUnit(state.unit); if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true }); restoreCurrent(state.was); } finally { process.exit(sig === 'SIGINT' ? 130 : 143); } };
  process.once('SIGINT', h); process.once('SIGTERM', h);
  return () => { process.off('SIGINT', h); process.off('SIGTERM', h); };
}
const currentUnit = () => { try { return fs.readFileSync(path.join(TOP, 'bds', '.lab', 'addon'), 'utf8'); } catch { return null; } };
const restoreCurrent = (was) => { const f = path.join(TOP, 'bds', '.lab', 'addon'); if (was === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, was); };
const verdictLine = (v) => Object.entries(v.steps ?? {}).map(([k, x]) => `${k} ${x}`).join(' · ');

async function harvestCmd({ flags }, out) {
  const B = await import('./borrow.mjs'), S = await site(), c = await client();
  const n = Math.max(1, Number(flags.n) || 5), budget = Math.max(1, Number(flags['max-requests']) || 40);
  const seed = flags.seed && flags.seed !== true ? String(flags.seed) : B.newSeed(), rand = B.rng(seed);
  const mv = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(flags['min-version'] ?? '1.21'));
  if (!mv) throw new Error('--min-version is like 1.21 or 1.21.50');
  const minVersion = [Number(mv[1]), Number(mv[2]), Number(mv[3] ?? 0)], kinds = flags.worlds ? ['mcaddon', 'mcpack', 'zip', 'mcworld'] : ['mcaddon', 'mcpack', 'zip'];
  const bds = bdsNow(), seen = B.readSeen();
  let idx = B.seenIndex(seen);
  // (what this harvest records counts at once: the same file posted twice in one harvest is caught too)
  const remember = (rec) => { seen.push(B.addSeen(rec)); idx = B.seenIndex(seen); };
  // the request budget: every request this harvest makes (pages kept an hour cost nothing), under the site's own pace
  let used = 0;
  const raw0 = c.raw.bind(c);
  c.raw = async (...a) => { if (used >= budget) throw Object.assign(new Error('budget'), { budget: true }); used++; return raw0(...a); };
  out(`harvest: seed ${seed} · ${n} 個まで · アクセス ${budget} 回まで（2.5〜5 秒に 1 回、1 時間に 80 回）· BDS ${bds ?? '?'}${flags['sim-only'] ? ' · sim だけ' : ''}${flags.retry ? ' · --retry: 新しい BDS で落としたものを試し直す' : ''}`);
  const was = currentUnit(), kept = [], dropped = [];
  // (what is being judged now: removed if this is stopped — Ctrl+C, a kill — with the current unit put back)
  const now = { unit: null, dir: null, was }, unhook = onStop(now);
  // the candidates: random pages of the addon categories in the seed's order, each page's posts shuffled; --retry: what
  // a newer BDS may change, in the seed's order
  const cats = [20, 22, 23];
  async function* candidates() {
    if (flags.retry) { for (const r of B.shuffle(B.retryable(seen, bds), rand)) yield { id: String(r.post), title: r.title ?? '', retry: r }; return; }
    const pageOf = (pg) => cached(`harvest-${cats.join('_')}-${pg}`, !!flags.fresh, async () => { const x = await S.restIndex(c, { cat: cats.join(','), page: pg, pages: 1, perPage: 20, fields: 'id,link,date,modified,title,categories' }); return { totalPages: x.totalPages ?? 1, posts: x.posts.map((p) => ({ id: p.id, title: p.title, date: p.date })) }; });
    const first = await pageOf(1);
    for (const pg of B.shuffle(Array.from({ length: Math.max(1, first.totalPages) }, (_, i) => i + 1), rand)) {
      const list = pg === 1 ? first : await pageOf(pg);
      for (const p of B.shuffle(list.posts, rand)) yield p;
    }
  }
  const drop = (id, title, stage, reason, extra = {}) => { dropped.push({ id, title, stage, reason }); remember({ post: id, title, result: 'dropped', stage, reason, bds, ...extra }); out(`DROP ${id} ${title ? `"${title.slice(0, 40)}" ` : ''}— ${stage}: ${reason}`); };
  let stopped = null;
  try {
    for await (const cand of candidates()) {
      if (kept.length >= n) break;
      const id = String(cand.id);
      // (a post is a number: it names folders here that are deleted by it)
      if (!/^\d{1,12}$/.test(id)) continue;
      if (!cand.retry && B.seenAs(idx, { post: id })) continue;
      let p;
      try { p = await post(id, !!flags.fresh); } catch (e) { if (e.budget) throw e; drop(id, cand.title, 'page', String(e.message).slice(0, 120)); continue; }
      const why = B.prefilter(p, { kinds, minVersion });
      if (why) { drop(id, p.title, 'prefilter', why); continue; }
      // (a unit of that name is already here — kept before, maybe with your fixes in it: never replaced)
      const unit = `borrowed_${id}`;
      if (fs.existsSync(path.join(UNITS_DIR(), unit))) { drop(id, p.title, 'exists', `bds/addons/${unit} があります（前に残したもの: そのまま）`); continue; }
      let g;
      now.dir = path.join(DIR(), id);
      try { g = await download(id, { fresh: !!flags.fresh, kinds, got: p }, () => {}); }
      catch (e) { fs.rmSync(path.join(DIR(), id), { recursive: true, force: true }); now.dir = null; if (e.budget) throw e; drop(id, p.title, 'download', String(e.message).split('\n')[0].slice(0, 160)); continue; }
      const info = await asAddon(g.file, g.info), packs = info.kind === 'addon' ? await B.packIds(g.file).catch(() => []) : [];
      // (--retry looks at a post again, never at the same content posted as another one)
      const again = B.seenAs(idx, { sha256: info.sha256, packs }, { except: cand.retry ? id : null });
      if (again) { drop(id, p.title, 'seen', `同じ中身を見ています（記事 ${again.rec.post}、${again.by}）`, { sha256: info.sha256, packs }); fs.rmSync(g.dir, { recursive: true, force: true }); now.dir = null; continue; }
      // (scripts are what there is to debug and learn from: an addon without one only with --any)
      if (info.kind === 'addon' && packs.length && !packs.some((x) => x.script) && !flags.any) { drop(id, p.title, 'kind', 'スクリプトの無いアドオン（--any で残す）', { sha256: info.sha256, packs }); fs.rmSync(g.dir, { recursive: true, force: true }); now.dir = null; continue; }
      out(`TRY  ${id} "${p.title.slice(0, 50)}"${p.author?.name ? ` by ${p.author.name}` : ''} (${kb(g.bytes)})`);
      const request = `借りたアドオン（${p.url}${p.author?.name ? `、作者 ${p.author.name}` : ''}）: 最新の BDS で動かし、壊れたところを直して学ぶ。配り直さない${p.rules?.length ? `（記事の決まり: ${p.rules.slice(0, 3).join(' / ')}）` : '（記事に決まりの記載なし: 手元で使うだけ）'}`;
      now.unit = unit;
      const v = await judge(g.file, { unit, request, meta: { site: 'colony', post: id, url: p.url, title: p.title, author: p.author?.name ?? null }, simOnly: !!flags['sim-only'], allowRisk: !!flags['allow-risk'], worlds: !!flags.worlds }, out);
      if (v.fatal) { dropUnit(v.unit); fs.rmSync(g.dir, { recursive: true, force: true }); now.unit = now.dir = null; stopped = v.reason; break; }
      if (!v.kept) { dropUnit(v.unit); fs.rmSync(g.dir, { recursive: true, force: true }); now.unit = now.dir = null; drop(id, p.title, v.stage, v.reason, { sha256: info.sha256, packs }); continue; }
      B.markUnit(path.join(UNITS_DIR(), unit), { site: 'colony', post: id, url: p.url, title: p.title, author: p.author?.name ?? null, rules: p.rules ?? [], file: g.file, sha256: info.sha256, packs, verdict: { bds, ...v.steps, ...(v.note ? { note: v.note } : {}) } });
      fs.rmSync(g.dir, { recursive: true, force: true });
      now.unit = now.dir = null;
      remember({ post: id, title: p.title, result: 'kept', stage: v.stage, reason: v.note ?? 'latest BDS: brief · check · test', bds, sha256: info.sha256, packs, unit });
      kept.push({ id, title: p.title, unit, author: p.author?.name ?? null, rules: p.rules ?? [], v });
      out(`KEEP ${id} → bds/addons/${unit} — ${verdictLine(v)}${v.note ? `（${v.note}）` : ''}`);
    }
  } catch (e) { if (e.budget) stopped = `アクセスの上限 ${budget} 回`; else throw e; }
  finally { c.raw = raw0; if (now.unit) dropUnit(now.unit); if (now.dir) fs.rmSync(now.dir, { recursive: true, force: true }); restoreCurrent(was); unhook(); }
  out('');
  out(`harvest seed ${seed}: 残した ${kept.length} / 落とした ${dropped.length} · アクセス ${used}/${budget}${stopped ? ` · 止めた理由: ${stopped}` : kept.length >= n ? '' : ' · 候補を見尽くしました'}`);
  for (const k of kept) out(`  KEPT ${k.id.padEnd(7)} bds/addons/${k.unit}  ${k.title.slice(0, 40)}${k.author ? ` (by ${k.author})` : ''}${k.rules.length ? `  決まり: ${k.rules[0].slice(0, 40)}` : ''}`);
  const byStage = dropped.reduce((m, d) => ({ ...m, [d.stage]: (m[d.stage] ?? 0) + 1 }), {});
  if (dropped.length) out(`  落とした理由: ${Object.entries(byStage).map(([k, x]) => `${k} ${x}`).join(' · ')}（auto/borrowed-seen.jsonl に記録: 同じものは二度取りません）`);
  if (kept.length) out(`next: node lab.mjs go -a ${kept[0].unit}（直したところは node lab.mjs colony diff ${kept[0].unit}）。借りたものは配りません: share・ship・publish・bundle・host は止まります`);
  else out(`next: もう一度（別の seed）か --max-requests を増やす${dropped.some((d) => RETRY_HINT.has(d.stage)) ? '。新しい BDS の後は --retry' : ''}`);
  return !stopped || kept.length > 0;
}
const RETRY_HINT = new Set(['brief', 'check', 'sim', 'real']);
async function borrowedCmd(_, out) {
  const B = await import('./borrow.mjs'), list = B.borrowedUnits();
  if (!list.length) { out('借りたユニットはありません（node lab.mjs colony harvest）'); return true; }
  for (const u of list) {
    const v = (() => { try { return JSON.parse(fs.readFileSync(path.join(u.dir, 'borrowed.json'), 'utf8')).verdict ?? {}; } catch { return {}; } })();
    out(`${u.rel}  ${u.mark.title ?? ''}${u.mark.author ? ` by ${u.mark.author}` : ''}  ${u.mark.url ?? u.mark.site}  ${String(u.mark.at).slice(0, 10)}`);
    out(`  決まり: ${u.mark.rules?.length ? u.mark.rules.join(' / ') : '記載なし（手元で使うだけ）'}`);
    out(`  判定: ${Object.entries(v).map(([k, x]) => `${k} ${x}`).join(' · ') || '?'}`);
  }
  out(`${list.length} 個。どれも作者のもの: 手元で動かして直して学ぶだけ（配りません）`);
  return true;
}
async function diffCmd({ pos }, out) {
  const B = await import('./borrow.mjs');
  const name = pos[0] ? (postId(pos[0]) && !fs.existsSync(path.join(UNITS_DIR(), pos[0])) ? `borrowed_${postId(pos[0])}` : pos[0]) : null;
  if (!name || !/^[a-z0-9_]+$/.test(name)) { out('usage: node lab.mjs colony diff <unit|post>'); return false; }
  const dir = path.join(UNITS_DIR(), name), orig = B.originalOf(dir);
  // the original unpacked the way import did (one level of .mcpack inside), its packs matched to bp/ rp/ by UUID. Someone
  // else's zip: every name is checked — nothing absolute, no "..", and each file (a nested pack's too) inside one folder
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-colony-diff-')), Z = await imp('zip.js'), root = path.resolve(tmp, 'orig');
  try {
    const plain = (n) => n && !n.includes('\0') && !path.isAbsolute(n) && !/^[a-zA-Z]:/.test(n) && !/(^|[\\/])\.\.([\\/]|$)/.test(n);
    const inside = (f) => path.resolve(f).startsWith(root + path.sep);
    const unpack = (buf, to, depth = 0) => {
      const list = Z.listEntries(buf);
      for (const e of list) {
        if (e.dir || !plain(e.name)) continue;
        const d = Z.readByName(buf, list, e.name);
        if (depth < 1 && /\.(mcpack|zip)$/i.test(e.name)) { const sub = path.join(to, e.name.replace(/\.(mcpack|zip)$/i, '')); if (inside(sub)) unpack(d, sub, depth + 1); continue; }
        const f = path.join(to, e.name);
        if (!inside(f)) continue;
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d);
      }
    };
    unpack(fs.readFileSync(orig), root);
    const mans = (d) => { const o = []; const w = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else if (e.name === 'manifest.json') o.push(p); } }; w(d); return o; };
    const uuidOf = (f) => { try { return String(JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).header.uuid).toLowerCase(); } catch { return null; } };
    let changed = 0;
    for (const k of ['bp', 'rp']) {
      const mine = path.join(dir, k);
      if (!fs.existsSync(mine)) continue;
      const src = mans(path.join(tmp, 'orig')).find((m) => uuidOf(m) === uuidOf(path.join(mine, 'manifest.json')));
      if (!src) { out(`${k}: 元のファイルに同じ UUID のパックがありません`); continue; }
      // (both sides side by side here, so the diff's paths read a/orig/bp/… b/now/bp/…)
      fs.cpSync(path.dirname(src), path.join(tmp, 'cmp', 'orig', k), { recursive: true });
      fs.cpSync(mine, path.join(tmp, 'cmp', 'now', k), { recursive: true });
      const g = (a) => spawnSync('git', ['diff', '--no-index', ...a, '--', `orig/${k}`, `now/${k}`], { cwd: path.join(tmp, 'cmp'), encoding: 'utf8' });
      const st = g(['--stat']);
      if (st.error) { out(`git がありません: 元のファイルは ${shown(orig)}`); return true; }
      if (!st.stdout.trim()) { out(`${k}: 元のまま`); continue; }
      changed++;
      out(`${k}:`); st.stdout.trim().split('\n').forEach((l) => out('  ' + l));
      g([]).stdout.split('\n').slice(0, 400).forEach((l) => out(l));
    }
    out(changed ? `元: ${shown(orig)}（sha256 一致）` : `元のまま（${shown(orig)}、sha256 一致）`);
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function borrowCmd({ pos, flags }, out) {
  const B = await import('./borrow.mjs'), f = fileOf(pos[0]);
  const W = await imp('world.js'), info = await asAddon(f, await W.inspect(f));
  const packs = info.kind === 'addon' ? await B.packIds(f).catch(() => []) : [];
  const was = B.seenAs(B.seenIndex(B.readSeen()), { sha256: info.sha256, packs });
  if (was && !flags.retry) out(`W 同じ中身を見ています（${String(was.rec.at).slice(0, 10)} ${was.rec.result}${was.rec.reason ? `: ${was.rec.reason}` : ''}）: もう一度試します`);
  // (borrowed_m_…: a file got by hand never takes the name a harvested post would have, borrowed_<post>)
  const unit = `borrowed_m_${String(flags.name && flags.name !== true ? flags.name : info.sha256.slice(0, 10)).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40)}`;
  if (fs.existsSync(path.join(UNITS_DIR(), unit))) throw new Error(`bds/addons/${unit} exists (--name <other>, or remove it first)`);
  const url = flags.url && flags.url !== true ? String(flags.url) : null, author = flags.author && flags.author !== true ? String(flags.author) : null;
  const request = `借りたアドオン（${url ?? path.basename(f)}${author ? `、作者 ${author}` : ''}）: 最新の BDS で動かし、壊れたところを直して学ぶ。配り直さない（手元で使うだけ）`;
  const cur = currentUnit(), now = { unit, dir: null, was: cur }, unhook = onStop(now);
  out(`borrow ${path.basename(f)} → bds/addons/${unit}`);
  let v;
  try { v = await judge(f, { unit, request, meta: { site: 'manual', post: null, url, title: path.basename(f), author }, simOnly: !!flags['sim-only'], allowRisk: !!flags['allow-risk'], worlds: !!flags.worlds }, out); }
  catch (e) { dropUnit(unit); throw e; }
  finally { restoreCurrent(cur); unhook(); }
  const bds = bdsNow();
  if (!v.kept) { dropUnit(v.unit); B.addSeen({ site: 'manual', post: null, title: path.basename(f), result: 'dropped', stage: v.stage, reason: v.reason, bds, sha256: info.sha256, packs }); out(`DROP ${v.stage}: ${v.reason}`); return false; }
  B.markUnit(path.join(UNITS_DIR(), unit), { site: 'manual', post: null, url, title: path.basename(f), author, rules: [], file: f, sha256: info.sha256, packs, verdict: { bds, ...v.steps, ...(v.note ? { note: v.note } : {}) } });
  B.addSeen({ site: 'manual', post: null, title: path.basename(f), result: 'kept', stage: v.stage, reason: v.note ?? 'latest BDS: brief · check · test', bds, sha256: info.sha256, packs, unit });
  out(`KEEP bds/addons/${unit} — ${verdictLine(v)}${v.note ? `（${v.note}）` : ''}`);
  out(`next: node lab.mjs go -a ${unit}。作者のものなので配りません（share・ship・publish・bundle・host は止まります）`);
  return true;
}

export async function colonyCmd(args, out = console.log) {
  const [sub, ...rest] = args;
  const T = { search: searchCmd, new: newCmd, cats: catsCmd, show: showCmd, get: getCmd, inspect: inspectCmd, verify: inspectCmd, repack: repackCmd, convert: convertCmd, install: installCmd, packs: packsCmd, import: importCmd, voxel: voxelCmd, harvest: harvestCmd, borrowed: borrowedCmd, diff: diffCmd, borrow: borrowCmd };
  if (!sub || sub === 'help' || sub === '--help' || !T[sub] || rest.includes('--help')) { out(USAGE); return !sub || sub === 'help' || sub === '--help' || rest.includes('--help'); }
  try { return await T[sub](parse(rest), out); }
  catch (e) { out(`ERR colony ${sub}: ${String(e.message).split('\n')[0]}`); return false; }
}
