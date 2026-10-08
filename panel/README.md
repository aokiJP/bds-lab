# 管理パネル（panel/）

作者と、GitHub Actions の時間を貸し借りする人（ホスト: [docs/guide/host.md](../docs/guide/host.md)）のためのページです。
サーバーは要りません: 1 枚の静的なページが、見る人のトークンで GitHub の API と話すだけです。

## 開く

- **GitHub Pages**（スマホから）: リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に。
  あとは既定の枝で `panel/` が変わるたびに `.github/workflows/pages.yml` が `https://<owner>.github.io/<リポジトリ>/` に置きます
  （Actions → pages → Run workflow で今すぐ）。ページ自体は誰でも開けますが、トークンなしでは何も読まず、何もできません。
- **手元**: `node lab.mjs panel`（`http://127.0.0.1:8787/`、このパソコンだけ。`--port` で番号を変える）。

## 入る

GitHub の Settings → Developer settings → Personal access tokens → **Fine-grained tokens** で作ります（パネルの「トークンを作る」
が入れ物を開きます）。Repository access: ラボのリポジトリと、貸し借りのホストだけ。Repository permissions:

| 権限 | 使うところ |
|---|---|
| Actions: Read and write | 進み具合・実行・止める・やり直す |
| Contents: Read and write | ワークフローの入力・ホストの `.lab-host.json`（貸し手が条件を変える） |
| Secrets: Read and write | 秘密の名前の一覧・登録・消す（値は GitHub も返しません） |
| Issues: Read and write | 端末（ライブの issue に命令を書き、返事を読む） |
| Pull requests: Read | 概要の開いている PR |

足りない権限の操作だけ「権限がありません」と出ます（Read だけのトークンなら見るだけのパネルになります）。

**入れる人**: ラボのリポジトリに書き込める人（Write / Maintain / Admin）か、ホストの持ち主（貸し手）か、ホストに書き込める人
（借り手）。ほかのトークンでは「使えません」で止まり、何も読みません。

## 守っていること

- トークンは、そのブラウザの中（「覚える」なら localStorage、外せばそのタブの間だけ）。送り先は `api.github.com` だけです:
  ページの CSP（`connect-src https://api.github.com`）がほかへの通信を止めます。スクリプトはページ自身のものだけ、文字は
  文字として置き（HTML として読まない）、インラインのスクリプトもスタイルもありません。
- 秘密の値は、その場でリポジトリの公開鍵で封じてから送ります（libsodium の sealed box と同じ。`lib/seal.mjs` を libsodium の
  出力で試験）。表示も保存もしません。
- 公開リポジトリの端末: 命令と返事は vault の鍵（`APP_CACHE_KEY`）で封じたまま issue に書かれます。パネルの設定にその鍵を
  入れると、パネルがその場で封じ・開きます（WebCrypto。`lib/vault.mjs` はランナーの app/lib/vault.mjs と同じ形）。
- 端末の命令が効くのは、その実行を始めた人のコメントだけ（ランナーの側で決まっています）。

## 中身

| ファイル | |
|---|---|
| `index.html` `panel.css` `panel.js` | 画面（スマホが先。明るい・暗いどちらも） |
| `lib/model.mjs` | 誰が使えるか・それぞれの設定でできること・ワークフローの入力・進み具合・ホストの条件と分（common/hosts.mjs と同じ判定） |
| `lib/gh.mjs` | GitHub の API（その人のトークンで） |
| `lib/seal.mjs` | 秘密を封じる（X25519・XSalsa20-Poly1305・BLAKE2b、ライブラリなし） |
| `lib/vault.mjs` `lib/livefmt.mjs` | ライブの issue の行（封じる・開く・読む） |
| `lib/pages.mjs` | 端末のボタン（Discord の DM と同じ表: app/lib/live.mjs も使う） |

試験: `node tests/panel-offline.mjs`（部品）・`node tests/panel-browser.mjs`（本物のブラウザで: CI の verify が走らせます）。
