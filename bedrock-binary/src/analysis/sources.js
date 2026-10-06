// 配布物の中に何が入っていて、そのうち何を使うのかを 1 箇所に書く。
//
// BDS の zip も APK も、解析に使っているのは実際には一部だけで、残りは
// 「公式で公開済み」「運用設定であって仕様ではない」といった理由で見送っている。
// その判断がコードのあちこちに散っていると、新しいファイルが増えたときに
// 気づかないまま取りこぼす。ここに表として置き、実物と突き合わせて報告する。
//
// use の意味
//   adopt  解析に使っている。使い道も書く
//   check  照合にだけ使う（バイナリから出た名前が実在するかの裏取り）
//   skip   使わない。理由を書く
//
// どの規則にも当たらないものは unknown として残す。版が変わって新しいものが
// 増えたら、そこに出てくる。
//
// 採用は「バイナリ（ELF）から読めるもの」に限る。パックや設定ファイルは公開済みで、
// 写して配っても価値が無い。使うとしても、バイナリから出た名前が実在するかの照合まで。

/** @typedef {{key:string, label:string, use:'adopt'|'check'|'skip', why:string, test:(name:string)=>boolean}} Rule */

const ends = (...xs) => (n) => xs.some((x) => n === x || n.endsWith(`/${x}`));
const re = (r) => (n) => r.test(n);

/** BDS の zip（Linux 版） */
export const BDS_SOURCES = [
  {
    key: 'server_binary', label: 'bedrock_server', use: 'adopt',
    why: '解析の本体。文字列・相互参照・enum・コマンドはすべてここから',
    test: ends('bedrock_server', 'bedrock_server.exe'),
  },
  {
    key: 'symbols', label: 'bedrock_server_symbols.debug', use: 'adopt',
    why: 'あれば enum の型名が確定する。cereal の文字列が消えた preview でも名前が付く',
    test: re(/symbols\.debug$|\.pdb$/i),
  },
  {
    key: 'texts', label: 'resource_packs/**/texts/*.lang', use: 'check',
    why: '翻訳キーに文面があるかの裏取りだけに使う。文面そのものは出さない（バイナリ由来ではないため）',
    test: re(/\/texts\/[a-z]{2}_[A-Z]{2}\.lang$/),
  },
  {
    key: 'behavior_packs', label: 'behavior_packs/**', use: 'check',
    why: '中身は bedrock-samples で公開済み。エンティティやアイテムの識別子が実在するかの照合にだけ使う',
    test: re(/^behavior_packs\//),
  },
  {
    key: 'resource_packs', label: 'resource_packs/**（texts 以外）', use: 'check',
    why: '同上。公開済みのものを再配布しても価値が無い',
    test: re(/^resource_packs\//),
  },
  {
    key: 'definitions', label: 'definitions/**', use: 'check',
    why: 'JSON スキーマ側の定義。バイナリからしか分からない情報ではない',
    test: re(/^definitions\//),
  },
  {
    key: 'config', label: 'server.properties / permissions.json / allowlist.json / valid_known_packs.json', use: 'skip',
    why: 'サーバーの運用設定で、仕様の復元とは別物。公式の手引きに載っている',
    test: ends('server.properties', 'permissions.json', 'allowlist.json', 'whitelist.json', 'valid_known_packs.json'),
  },
  {
    key: 'docs', label: 'release-notes.txt / bedrock_server_how_to.html / LICENSE', use: 'skip',
    why: '読み物。版の確認は zip の名前とバイナリの build id で足りる',
    test: re(/release-notes|how_to|LICENSE|\.html$|\.txt$/i),
  },
  {
    key: 'runtime', label: '*.so / *.dll など同梱ライブラリ', use: 'skip',
    why: 'Mojang のコードではない（PhysX や snappy）。復元したい定義は入っていない',
    test: re(/\.(so|dll)(\.\d+)*$/),
  },
];

/** APK 一式（自分の端末から取り出したもの） */
export const APK_SOURCES = [
  {
    key: 'client_lib', label: 'lib/arm64-v8a/libminecraftpe.so', use: 'adopt',
    why: 'クライアント本体。/connect の購読側やクライアントにしか無い enum はここ',
    test: re(/^lib\/(arm64-v8a|x86_64)\/libminecraftpe\.so$/),
  },
  {
    key: 'manifest', label: 'AndroidManifest.xml', use: 'adopt',
    why: '版・versionCode・split の判別。取り出した .so がどの版のものかの根拠',
    test: ends('AndroidManifest.xml'),
  },
  {
    key: 'texts', label: 'assets/**/texts/*.lang', use: 'check',
    why: 'サーバー側と同じ扱い。キーの有無の確認だけに使う',
    test: re(/\/texts\/[a-z]{2}_[A-Z]{2}\.lang$/),
  },
  {
    key: 'assets_data', label: 'assets/**（behavior/resource パック）', use: 'check',
    why: 'BDS 側と同じものが大半。差分（クライアント専用のパック）だけを照合に使う',
    test: re(/^assets\//),
  },
  {
    key: 'other_abi', label: 'lib/**（arm64-v8a 以外）', use: 'skip',
    why: '32bit は ELF32 で未対応。x86_64 は同じ内容',
    test: re(/^lib\//),
  },
  {
    key: 'android', label: 'classes*.dex / resources.arsc / res/** / META-INF/**', use: 'skip',
    why: 'Android のガワ。ゲームの定義は入っていない',
    test: re(/^(classes.*\.dex|resources\.arsc|res\/|META-INF\/|assets\/gametest_metadata)/),
  },
];

/**
 * 実物のエントリを表に当てる。
 * @param {Array<{name:string,size?:number}>} entries
 * @param {'bds'|'apk'} kind
 */
export function inventory(entries, kind = 'bds') {
  const rules = kind === 'apk' ? APK_SOURCES : BDS_SOURCES;
  const groups = rules.map((r) => ({ key: r.key, label: r.label, use: r.use, why: r.why, files: 0, bytes: 0, samples: [] }));
  const unknown = { key: 'unknown', label: '表に無いもの', use: 'skip', why: '規則に当たらなかった。版で増えたものはここに出る', files: 0, bytes: 0, samples: [] };

  for (const e of entries) {
    const i = rules.findIndex((r) => r.test(e.name));
    const g = i < 0 ? unknown : groups[i];
    g.files++;
    g.bytes += e.size ?? 0;
    if (g.samples.length < 3) g.samples.push(e.name);
  }
  return { kind, total: entries.length, groups: [...groups, unknown].filter((g) => g.files || g.use === 'adopt') };
}

/** 人が読む形にする */
export function formatInventory(inv) {
  const mark = { adopt: '採用', check: '照合', skip: '見送り' };
  const mb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const lines = [`${inv.kind === 'apk' ? 'APK' : 'BDS zip'} の中身 ${inv.total} 件`];
  for (const g of inv.groups) {
    const state = g.files ? `${String(g.files).padStart(5)} 件 ${mb(g.bytes).padStart(9)}` : '    なし        ';
    lines.push(`  ${mark[g.use]}  ${state}  ${g.label}`);
    lines.push(`              ${g.why}`);
  }
  return lines;
}
