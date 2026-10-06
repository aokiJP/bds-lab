/**
 * クラフターズコロニー (minecraft-mcworld.com) クライアント。
 *
 * ── 実装した操作 (すべて読み取り) ─────────────────────────
 *   一覧    /category/<path>/page/N/?sort=
 *   検索    /?s=<kw>&cat=<id>&sort=<s>&paged=N
 *   記事    /<postid>/
 *   タグ    /tag/<slug>/
 *   投稿者  /author/<hash>/
 *   新着    /feed/  (RSS。watch用。1リクエストで最新20件)
 *   DL      /dl/?postid=&type=   type=2:zip  type=3:mcworld
 *
 * ── 意図的に実装しない操作 ────────────────────────────────
 *   いいね     wp-admin/admin-ajax.php action=postratings
 *   閲覧カウント wp-json/cc-popular-counter/v1/track
 *   通報 / コメント投稿 / つぶやき投稿 / 掲示板 / アカウント作成
 *   → いずれもサイトの公開統計や他人の運用を書き換える。
 *     人気順・DL数・閲覧数は利用者が作品を選ぶ判断材料なので汚さない。
 */

// COLONY_ORIGIN: 別の場所（試験の偽サイト）。ふだんは本物のサイト
export const ORIGIN = (typeof process !== 'undefined' && process.env?.COLONY_ORIGIN) || 'https://minecraft-mcworld.com';
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

export const CATS = {
  19: 'BE(統合版)',
  2: 'BE 配布ワールド', 3: 'BE 脱出・謎解き', 4: 'BE 建築・造形', 5: 'BE アスレチック',
  6: 'BE ミニゲーム', 7: 'BE PvP', 8: 'BE アドベンチャー・RPG', 14: 'BE その他',
  233: 'BE スカイブロック',
  20: 'BE アドオン', 21: 'BE リソースパック', 22: 'BE ビヘイビアパック',
  23: 'BE ビヘイビア＆リソース', 144: 'BE シェーダー',
  139: 'BE サーバー', 140: 'BE サーバー/サバイバル', 141: 'BE サーバー/クリエイティブ',
  142: 'BE サーバー/PvP', 143: 'BE サーバー/その他',
  208: 'BE スキン',
  24: 'JE(PC版)',
  10: 'JE 配布ワールド', 11: 'JE 脱出・謎解き', 12: 'JE 建築・造形', 13: 'JE ミニゲーム',
  15: 'JE アドベンチャー・RPG', 16: 'JE アスレチック', 17: 'JE PvP', 18: 'JE その他',
  234: 'JE スカイブロック',
  26: 'JE MOD', 27: 'JE リソースパック', 28: 'JE データパック', 209: 'JE スキン',
  640: 'JE サーバー', 641: 'JE サーバー/PvP', 642: 'JE サーバー/サバイバル',
  643: 'JE サーバー/クリエイティブ', 644: 'JE サーバー/その他',
  885: 'ブログ',
};

export const SORTS = ['new', 'newer', 'modified', 'weekly', 'monthly', 'all', 'dl', 'rating'];

/** JE側のカテゴリID。ここに入る記事はJava版ワールド = 変換対象 */
export const JE_CATS = new Set([24, 10, 11, 12, 13, 15, 16, 17, 18, 234, 26, 27, 28, 209, 640, 641, 642, 643, 644]);

const TYPE_NAME = { 1: 'other', 2: 'zip', 3: 'mcworld' };

// ================================================================ throttle

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Throttle {
  constructor({ perHour = 80, minDelay = 2500, maxDelay = 5000 } = {}) {
    Object.assign(this, { perHour, minDelay, maxDelay });
    this.stamps = [];
    this.last = 0;
  }
  async gate() {
    const wait = this.minDelay + Math.random() * (this.maxDelay - this.minDelay);
    const since = Date.now() - this.last;
    if (this.last && since < wait) await sleep(wait - since);

    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 3600_000);
    if (this.stamps.length >= this.perHour) {
      const w = 3600_000 - (now - this.stamps[0]) + 1000;
      console.log(`  …時間あたり上限(${this.perHour}req/h)。${Math.ceil(w / 1000)}秒待機`);
      await sleep(w);
      return this.gate();
    }
    this.stamps.push(Date.now());
    this.last = Date.now();
  }
}

// ================================================================ http

export class Client {
  constructor(throttle = new Throttle()) { this.t = throttle; this.reqCount = 0; }

  async raw(url, { referer = ORIGIN, accept = 'text/html,application/xhtml+xml' } = {}) {
    await this.t.gate();
    this.reqCount++;
    for (let a = 0; a < 4; a++) {
      let res;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent': UA, Accept: accept,
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
            'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
            Referer: referer,
          },
          redirect: 'follow',
        });
      } catch (e) {
        if (a === 3) throw e;
        const back = 5000 * 2 ** a;
        console.log(`  …通信エラー(${e.message})。${back / 1000}秒後に再試行`);
        await sleep(back); continue;
      }
      if (res.status === 429 || res.status === 503) {
        const ra = parseInt(res.headers.get('retry-after') || '', 10);
        const back = Number.isFinite(ra) ? ra * 1000 : 30_000 * 2 ** a;
        console.log(`  …HTTP ${res.status}。${Math.ceil(back / 1000)}秒待機`);
        await sleep(back); continue;
      }
      return res;
    }
    throw new Error('再試行上限');
  }

  async html(url, referer) {
    const res = await this.raw(url, { referer });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }
}

// ================================================================ URL

export function listUrl({ url, search, cat, sort, tag, author }) {
  if (url) return url;
  if (tag) return `${ORIGIN}/tag/${encodeURIComponent(tag)}/${sort ? `?sort=${sort}` : ''}`;
  if (author) return `${ORIGIN}/author/${author}/`;
  const u = new URL(ORIGIN + '/');
  if (search) u.searchParams.set('s', search);
  if (cat) u.searchParams.set('cat', String(cat));
  u.searchParams.set('sort', sort || 'new');
  return u.toString();
}

export function pageUrl(base, page) {
  const u = new URL(base);
  if (page <= 1) return u.toString();
  if (u.searchParams.has('s') || u.searchParams.has('cat')) {
    u.searchParams.set('paged', String(page));
  } else {
    u.pathname = u.pathname.replace(/\/(page\/\d+\/)?$/, '/') + `page/${page}/`;
  }
  return u.toString();
}

// ================================================================ parse

export const ent = (s) => s
  .replace(/&#0?38;|&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

const strip = (s) => ent(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function extractPostIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/href=["'](?:https?:\/\/minecraft-mcworld\.com)?\/(\d{3,})\/?["']/g)) ids.add(m[1]);
  return [...ids];
}

export const noResults = (html) => /NOT FOUND|投稿が見つかりませんでした/.test(html);

/** RSS (/feed/) から {id,title,link,date} を抜く。1リクエストで最新分が取れる */
export function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const link = (item.match(/<link>([^<]+)<\/link>/) || [])[1];
    const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1];
    const date = (item.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1];
    const cats = [...item.matchAll(/<category><!\[CDATA\[([\s\S]*?)\]\]><\/category>/g)].map((c) => c[1]);
    const id = link && (link.match(/\/(\d{3,})\/?$/) || [])[1];
    if (id) out.push({ id, title: title ? ent(title.trim()) : '', link, date, cats });
  }
  return out;
}

/** 記事ページを丸ごと構造化する */
export function parsePost(html, id) {
  const meta = (p) => (html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')) || [])[1];
  const metaN = (n) => (html.match(new RegExp(`<meta[^>]+name=["']${n}["'][^>]+content=["']([^"']*)["']`, 'i')) || [])[1];

  const title = ent(meta('og:title') || '').trim() || 'untitled';

  // 投稿者。リンク内に<img>が入るので title="○○ の投稿" 属性を優先する
  let author = null;
  // コメント欄にも /author/ リンクが出るので、記事本文〜プロフィール欄までで切る
  const cut = html.search(/<div[^>]+class=["'][^"']*\b(comment-area|comments)\b|id=["']comments["']|class=["']st-comment/i);
  const head = cut > 0 ? html.slice(0, cut) : html;
  const guest = /\bauthor-guest\b/.test(html);
  const ah = guest ? null : head.match(/\/author\/([0-9a-f]{20,})\//i);
  if (ah) {
    const hash = ah[1];
    const byTitle = head.match(new RegExp(`author\\/${hash}\\/["'][^>]*title=["']([^"']+?)\\s*の投稿["']`, 'i'));
    let name = byTitle ? ent(byTitle[1]).trim() : '';
    if (!name) {
      // <a …>…<img …>名前</a> の最後のテキストノードを拾う
      const block = head.match(new RegExp(`<a[^>]+author\\/${hash}\\/[\\s\\S]{0,400}?<\\/a>`, 'i'));
      if (block) {
        const texts = strip(block[0]).split(' ').filter(Boolean);
        name = texts.length ? ent(texts[texts.length - 1]) : '';
      }
    }
    author = { hash, name };
  }

  // カテゴリ / タグ
  const catIds = [...html.matchAll(/class="cat-label cat-label-(\d+)"/g)].map((m) => +m[1]);
  const bodyCat = (html.match(/class="[^"]*\bcategoryid-(\d+)\b/) || [])[1];
  if (bodyCat) catIds.unshift(+bodyCat);
  const tags = [...new Set([...html.matchAll(/href=["']https:\/\/minecraft-mcworld\.com\/tag\/([^"'\/]+)\/?["']/g)]
    .map((m) => decodeURIComponent(m[1])))];

  // 閲覧数 / DL数 / いいね (記事上部の数字列)
  const stats = html.match(/([\d,]+)\(週:([\d,]+)\s*月:([\d,]+)\)/);
  const num = (s) => (s ? +s.replace(/,/g, '') : null);

  // 公開日 / 更新日
  const published = meta('article:published_time') || null;
  const modified = meta('article:modified_time') || null;

  // サムネ・スクショ
  const thumb = meta('og:image') || metaN('thumbnail') || null;
  const shots = [...new Set([...html.matchAll(/href=["'](https:\/\/minecraft-mcworld\.com\/wp-content\/uploads\/[^"']+\.(?:jpe?g|png|webp))["']/gi)]
    .map((m) => m[1]))].slice(0, 12);

  // インフォメーション表 (想定クリア時間 / 人数 / マルチ / 難易度 / ホラー / バージョン …)
  const info = {};
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
    if (cells.length !== 2) continue;
    const [k, v] = cells;
    if (k && v && k.length <= 24) info[k] = v;
  }

  // 本文の説明 (meta descriptionで代用。HTML本文は広告混じりで汚い)
  const description = metaN('description') ? ent(metaN('description')) : null;

  return {
    id,
    url: `${ORIGIN}/${id}/`,
    title,
    author,
    catIds: [...new Set(catIds)],
    catNames: [...new Set(catIds)].map((c) => CATS[c]).filter(Boolean),
    isJava: [...new Set(catIds)].some((c) => JE_CATS.has(c)),
    tags,
    views: stats ? num(stats[1]) : null,
    viewsWeek: stats ? num(stats[2]) : null,
    viewsMonth: stats ? num(stats[3]) : null,
    published, modified,
    thumb, shots, info, description,
    buttons: extractButtons(html),
  };
}

export function extractButtons(html) {
  const out = [];
  const re = /<div[^>]*class=["'][^"']*download-bt[^"']*["'][^>]*onclick=["']\s*download_bt_func\(\s*(\d+)\s*,\s*(\d+)\s*\)[^>]*>([\s\S]*?)<\/div>/gi;
  for (const m of html.matchAll(re)) {
    const [, postid, type, inner] = m;
    const destRaw = (inner.match(/移動先\s*(https?:\/\/[^\s<"']+)/) || [])[1];
    const dest = destRaw ? ent(destRaw) : null;
    const label = strip(inner);
    // ボタンの文字で種類を決める（「ダウンロード (mcpack/mcaddon) [DL:5]」のように type=1 でもアドオンのことがある）
    let kind = TYPE_NAME[type] || `type${type}`;
    if (/mcworld/i.test(label)) kind = 'mcworld';
    else if (/mcaddon/i.test(label)) kind = 'mcaddon';
    else if (/mcpack/i.test(label)) kind = 'mcpack';
    else if (/zip/i.test(label)) kind = 'zip';
    out.push({
      postid, type: +type, kind, label, dest,
      count: +((label.match(/\[DL:(\d+)\]/) || [])[1] || 0),
      hosted: dest ? isHosted(dest) : false,
      dlUrl: `${ORIGIN}/dl/?postid=${postid}&type=${type}`,
    });
  }
  return out;
}

export const isHosted = (u) =>
  /(^|\/\/|\.)(dropbox\.com|dropboxusercontent\.com|drive\.google\.com|mediafire\.com|onedrive\.live\.com|1drv\.ms|minecraft-mcworld\.com)/i.test(u);

/**
 * 移動先URLをホップの少ない形へ。
 * Dropbox www→dl.dropboxusercontent で302を1つ削れる。
 */
export function directUrl(dest) {
  try {
    const u = new URL(dest);
    if (/(^|\.)dropbox\.com$/i.test(u.hostname)) {
      u.hostname = 'dl.dropboxusercontent.com';
      u.searchParams.set('dl', '1');
      return u.toString();
    }
    const gd = dest.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (gd) return `https://drive.google.com/uc?export=download&id=${gd[1]}`;
    return dest;
  } catch { return dest; }
}

export function filenameFrom(res, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  let m = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1]); } catch {} }
  m = cd.match(/filename=["']?([^"';]+)["']?/i);
  if (m && !/^\?+\./.test(m[1])) return m[1];
  try {
    const base = decodeURIComponent(new URL(res.url).pathname).split('/').pop();
    if (/\.(mcworld|zip|mcaddon|mcpack)$/i.test(base)) return base;
  } catch {}
  return fallback;
}

// ================================================================ REST API

/**
 * WordPress REST API での索引取得。
 *   GET /wp-json/wp/v2/posts?categories=<id>&per_page=100&page=N
 * 応答ヘッダ X-WP-Total / X-WP-TotalPages に総数が入る。
 *
 * HTMLの一覧は1ページ12件なので、984件の索引に82リクエスト要る。
 * RESTなら100件/回で10リクエスト。ただし配布ボタンはテーマが描画するので
 * content.rendered には入らない → DLリンクだけは記事ページを見る必要がある。
 */
export async function restIndex(client, { cat, search, page = 1, pages = 1, perPage = 100, after, orderby, fields = 'id,link,date,modified,title,excerpt,content,author,categories,tags,featured_media,comment_status' } = {}) {
  const out = [];
  let total = null, totalPages = null;
  for (let p = page; p < page + pages; p++) {
    const u = new URL(`${ORIGIN}/wp-json/wp/v2/posts`);
    if (cat) u.searchParams.set('categories', String(cat));
    if (search) u.searchParams.set('search', search);
    if (after) u.searchParams.set('after', after);          // ISO日時。差分取得に使う
    if (orderby) u.searchParams.set('orderby', orderby);    // date | modified | title
    u.searchParams.set('per_page', String(perPage));
    u.searchParams.set('page', String(p));
    u.searchParams.set('_fields', fields);   // 一覧だけなら本文を外すと応答が数十分の一

    const res = await client.raw(u.toString(), { accept: 'application/json' });
    if (res.status === 400) break;                          // ページ範囲外
    if (!res.ok) throw new Error(`REST HTTP ${res.status}`);
    if (total === null) {
      total = +(res.headers.get('x-wp-total') || 0) || null;
      totalPages = +(res.headers.get('x-wp-totalpages') || 0) || null;
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) break;
    for (const r of arr) {
      out.push({
        id: String(r.id),
        url: r.link,
        title: ent(String(r.title?.rendered ?? '')).trim(),
        date: r.date, modified: r.modified,
        authorId: r.author,
        catIds: r.categories || [],
        catNames: (r.categories || []).map((c) => CATS[c]).filter(Boolean),
        isJava: (r.categories || []).some((c) => JE_CATS.has(c)),
        tagIds: r.tags || [],
        body: stripTags(String(r.content?.rendered ?? '')),
        excerpt: stripTags(String(r.excerpt?.rendered ?? '')),
        commentsOpen: r.comment_status === 'open',
      });
    }
    if (totalPages && p >= totalPages) break;
  }
  return { posts: out, total, totalPages };
}

const stripTags = (s) => ent(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, ''))
  .replace(/\n{3,}/g, '\n\n').trim();

/** RESTが使えるか1回だけ試す。落ちていればHTML一覧に自動で戻す */
export async function restAvailable(client) {
  try {
    const res = await client.raw(`${ORIGIN}/wp-json/wp/v2/posts?per_page=1&_fields=id`, { accept: 'application/json' });
    return res.ok;
  } catch { return false; }
}
