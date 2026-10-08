# サインインのサービス（auth/）

管理パネル（[panel/](../panel/README.md)）の「GitHub でサインイン」を受け持つ、小さなサービスです。ラボの GitHub App の
OAuth（ウェブの流れ）だけをします。App の client secret は置ける場所（Cloudflare の Worker か、自分のサーバー）にだけ置き、
パネルの静的なページには置きません。

- **何も覚えません**: データベースもセッションもありません。サインイン 1 回分のこと（戻る先・nonce・時刻）は署名した 1 つの値
  （`state`）にのせ、同じ値を HttpOnly の cookie にも入れます。
- **トークンを持ちません**: GitHub から受け取ったトークンは、パネルのアドレスの `#` の後ろでパネルに 1 回だけ渡します
  （`#` はどのサーバーにも、ログにも、Referer にも出ません）。パネルは受け取るとすぐアドレスから消します。
- **力を足しません**: パネルはそのあと、その人のユーザーのトークンで GitHub と直接話します。見えるもの・できることは、
  GitHub がその人に（ラボのリポジトリに入れた App を通して）許していることだけです。

コードは [handler.mjs](handler.mjs) の 1 つです（`fetch`・`Request`・`Response`・`URL`・`crypto.subtle`・`TextEncoder` だけ:
Node 22・Workers・ブラウザでそのまま動きます）。[worker.mjs](worker.mjs) が Cloudflare に、[node.mjs](node.mjs) が自分の
サーバーに、同じものを置きます。

## 道

| 道 | すること |
|---|---|
| `GET /health` | `{ ok, clientId, origins, version }`（設定が足りなければ 503 と `missing`: 足りない名前だけ）。パネルの origin には CORS |
| `GET /login?return=<パネルの URL>&select=1&login=<名前>` | `return` の origin が `PANEL_ORIGINS` に無ければ 400。あれば署名した state を cookie（`__Host-bdslab_state`、HttpOnly・Secure・SameSite=Lax・Path=/・10 分）と GitHub へのアドレスの両方に入れ、GitHub の `/login/oauth/authorize` へ 302（PKCE S256。`select=1` でアカウントを選ぶ画面、`login` で名前の候補） |
| `GET /callback` | cookie と state が同じ・署名が正しい・10 分以内を確かめ、code を GitHub でトークンに替え、`<return>#bdslab-auth=<base64url(JSON)>` へ 302（だめなら `#bdslab-auth-error=<短い語>`）。cookie は消す |
| `POST /refresh` `{refresh_token}` | 期限の来るトークンを新しくする（GitHub の `grant_type=refresh_token`）。Origin が `PANEL_ORIGINS` のときだけ、CORS もその origin だけ |
| `POST /logout` `{access_token}` | GitHub の `DELETE /applications/{client_id}/token`（Basic `client_id:client_secret`）でトークンを無効に → 204。同じ Origin の決まり |

受け渡しの JSON は `access_token`・`expires_in`・`refresh_token`・`refresh_token_expires_in`・`token_type` の 5 つだけです。
エラーは `{ "error": "<短い語>" }` だけで、秘密も GitHub の文も入れません（パネルが `panel/lib/session.mjs` の `explainAuth`
で日本語にします）。

## 設定（env）

| 名前 | 中身 |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub App の Client ID（公開してよい値） |
| `GITHUB_CLIENT_SECRET` | GitHub App の client secret（**秘密**） |
| `STATE_SECRET` | state の署名の鍵。32 文字以上のでたらめ（**秘密**。例: `openssl rand -base64 48`）。変えると、途中のサインインだけがやり直しになります |
| `PANEL_ORIGINS` | パネルの origin をカンマ区切りで（例: `https://<owner>.github.io`）。https だけ（http は 127.0.0.1・localhost だけ）。パスは書かない |
| `GITHUB_WEB` | 既定 `https://github.com`（試験で偽物に向けるときだけ） |
| `GITHUB_API` | 既定 `https://api.github.com`（同じ） |
| `PUBLIC_URL` | node.mjs だけ: このサービスの https の origin（GitHub が人を戻す `<PUBLIC_URL>/callback`） |

GitHub App の側: **Callback URL** に `<このサービス>/callback` を入れ、**Expire user authorization tokens** を有効に
（8 時間で切れるトークンと、更新のための refresh token が出ます）。サービスは自分の origin の `/` に置きます（cookie が
`__Host-` なので、パスの下には置けません）。

パネルの側: パネルの config にこのサービスのアドレスを入れ、パネルのページの CSP の `connect-src` にこのサービスの origin を
足します（`/refresh` と `/logout` を呼ぶため。`/login` はページの移動なので要りません）。

## Cloudflare に置く

`.github/workflows/auth-deploy.yml` が [wrangler.toml](wrangler.toml)（name `bds-lab-auth`、main `worker.mjs`）で置きます。
リポジトリに要るもの:

| 種類 | 名前 | Worker の |
|---|---|---|
| 秘密 | `CLOUDFLARE_API_TOKEN`（Workers を編集できるトークン）・`CLOUDFLARE_ACCOUNT_ID` | （置くためだけ） |
| 秘密 | `APP_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET`（Worker の秘密） |
| 秘密 | `AUTH_STATE_SECRET` | `STATE_SECRET`（Worker の秘密） |
| 変数 | `APP_CLIENT_ID` | `GITHUB_CLIENT_ID`（Worker の変数） |

`PANEL_ORIGINS` もワークフローが Worker の変数にします（GitHub Pages のパネルなら `https://<owner>.github.io`）。
置けたら `https://bds-lab-auth.<あなたの>.workers.dev/health` が `"ok": true` を返します。

手で置くなら（Node と wrangler があるパソコンで）:

```sh
cd auth
npx wrangler deploy --var GITHUB_CLIENT_ID:<Client ID> --var PANEL_ORIGINS:https://<owner>.github.io
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put STATE_SECRET
```

## Docker で自分のサーバーに

```sh
docker build -t bds-lab-auth auth/          # auth/ だけを入れる（node:22-alpine、root でない利用者 node）
docker run -d --name bds-lab-auth --restart unless-stopped -p 127.0.0.1:8787:8787 --env-file auth.env bds-lab-auth
```

`auth.env`（このファイルは自分のサーバーにだけ。リポジトリに入れない）:

```
GITHUB_CLIENT_ID=Iv23...
GITHUB_CLIENT_SECRET=...
STATE_SECRET=...
PANEL_ORIGINS=https://<owner>.github.io
PUBLIC_URL=https://auth.<あなたのドメイン>
```

**TLS の前段の後ろで動かします**: node.mjs は素の HTTP を話すだけです。Caddy・nginx・ロードバランサーなどで
`https://auth.<あなたのドメイン>` を受け、`127.0.0.1:8787` に渡してください（cookie は Secure なので https でしか
働きません）。例（Caddy）: `auth.example.jp { reverse_proxy 127.0.0.1:8787 }`。
Docker なしなら `node auth/node.mjs`（同じ env。`HOST` は既定 127.0.0.1）。

## 守っていること

- **戻る先**: `return` は `PANEL_ORIGINS` の origin だけ（ほかの origin・似た名前・`user@host`・`javascript:`・相対・長すぎるものは
  400）。署名した state の中の戻る先も、戻すときにもう一度確かめます。open redirect にしません。
- **よそで作られた callback**: cookie と state が同じでなければ、トークンを渡しません（ログインの CSRF）。cookie は
  `__Host-`・HttpOnly・Secure・SameSite=Lax・10 分で、callback で消します。パネルの側も、自分が始めたサインインの nonce が
  `#` に戻ってきたときだけ受け取ります（`panel/lib/session.mjs`）。
- **state**: HMAC-SHA256 の署名（鍵は `STATE_SECRET`）。改ざん・別の鍵・切れたものは 400 で、どこにも移りません。10 分を
  過ぎたものは使いません。
- **PKCE**（S256）: verifier はどこにも書きません（state の nonce から `STATE_SECRET` で作り直します）。道の途中で code を
  見た人も、そばにあったものでは code をトークンに替えられません。
- **トークンの受け渡し**: パネルのアドレスの `#` の後ろだけ（クエリにしない）。どの答えにも `Cache-Control: no-store`・
  `Referrer-Policy: no-referrer`・`X-Content-Type-Options: nosniff`・`Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'`。
- **CORS**: `/refresh`・`/logout`・`/health` は `PANEL_ORIGINS` の origin にだけ。cookie は使いません（パネルは
  `credentials: 'omit'` で呼びます）。Origin はブラウザを守る決まりで、本人の確かめではありません: refresh token は
  それ自体が鍵なので、パネルはそのブラウザの中（覚えないときはタブの間だけ）にだけ置き、GitHub は使うたびに新しくします。
- **秘密**: client secret と `STATE_SECRET` は、答え・ログ・エラーに出しません。node.mjs はリクエストを記録しません
  （callback のアドレスには code があるので）。足りない設定は名前だけを言います。
- **権限**: このサービスは GitHub の API をその人として呼びません。パネルのポリシーは見せるものを狭めるだけで、広げるのは
  GitHub の権限（App を入れたリポジトリと、その人の役割）だけです。

## 確かめる

`node tests/auth-offline.mjs`（偽の GitHub で: サインインの流れ・state の改ざん・cookie なし・古い state・ほかの origin・
refresh と logout の CORS・logout の Basic と DELETE・秘密が出ないこと・node.mjs を空いている番号で・worker.mjs の形）。
実際の GitHub でしか分からないこと（PKCE を受けるか、`prompt=select_account`）は [handler.mjs](handler.mjs) の `GITHUB` に
まとめてあります。
