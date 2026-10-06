// 配布物に入っている翻訳ファイル（*.lang）を読む。
//
// バイナリから取れるのは翻訳キー（commands.<名前>.description）までで、
// 文面そのものは入っていない。.lang を併せて読むと
//   - コマンドの説明文が付く
//   - 「バイナリに登録はあるが .lang に文面が無い」コマンドが分かる
// の 2 つが得られる。後者は、表に出ていないコマンドかどうかの、もう 1 本の根拠になる。
//
// ただし文面そのものは出力しない。このツールが出すのは「バイナリから復元した事実」だけで、
// 配布物に元から入っている文章を写して配る意味は無い。ここで使うのは
// 「そのキーに文面があるか」という 1 ビットだけにする。
//
// 形式は 1 行 1 件の `キー=値`。`#` 以降はコメント、空行は無視。

export function parseLang(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    // 値の後ろにタブ区切りの訳注がつくことがある
    const value = s.slice(eq + 1).split('\t')[0].trim();
    if (key) out.set(key, value);
  }
  return out;
}

/**
 * 「翻訳表に文面があるか」だけをコマンドに付ける。commands を直接書き換える。
 * 文面が無い = 表に出す気が無いコマンド。公式メタデータとは別の角度からの裏取りになる。
 * @param {Array<{name:string, descriptionKey:string}>} commands
 * @param {Map<string,string>} lang
 */
export function attachCommandTexts(commands, lang) {
  let withText = 0;
  for (const c of commands) {
    c.hasText = lang.has(c.descriptionKey);
    if (c.hasText) withText++;
  }
  return { total: commands.length, withText, withoutText: commands.length - withText };
}
