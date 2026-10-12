// ghrules: GitHub's own rules for what the panel sends it — each write lib/gh.mjs makes, and what the panel hands GitHub's
// pages (the App's manifest, the fine-grained token page's address, the App's install link) — checked here before GitHub sees
// them (pure: no DOM, no network). Each rule says where it comes from: 実際のエラー (GitHub really answered so), 広く知られた
// 決まり (GitHub's documented, well-known rules) or 推測. strict: true only for the sure ones — lib/gh.mjs stops those before
// sending (a 422 with plain words, lib/rescue.mjs's next step); the rest only the tests' fake GitHubs use (fakeCheck), so a
// right operation is never stopped in earnest by a rule that might be wrong. Problems name what is wrong and, for a secret,
// its name and length only — never a token, a key or a value.

/** a kind: what is sent → [{ id, strict, source, test(payload) → problem | null }]. An API kind's payload is { path: the
 *  values in its address (name, login, number, workflow, file, code, …), body }; a page's is what the page is given (the
 *  manifest object, an address string) */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KB48 = 48 * 1024;
const str = (x) => typeof x === 'string';
const filled = (x) => str(x) && x.trim() !== '';
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const size = (s) => new TextEncoder().encode(String(s ?? '')).length;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const b64ok = (x) => str(x) && B64.test(x.replace(/\s+/g, ''));   // (newlines and spaces between: GitHub's own base64 carries them)
/** an absolute http(s) address (null: fine; else the problem in words) */
const absUrl = (u, what) => { if (!str(u) || !u) return `${what} がありません`; let x; try { x = new URL(u); } catch { return `${what} が URL の形ではありません`; } return /^https?:$/.test(x.protocol) ? null : `${what} は http(s) の URL で`; };
const noFrag = (u, what) => (str(u) && u.includes('#') ? `${what} に #（fragment）は入れられません` : null);
const urlOf = (s) => { try { return new URL(String(s)); } catch { return null; } };
/** a secret's or variable's name (GitHub's rules for both) */
const nameRules = (prefix, what, get) => [
  // 広く知られた決まり: 英数字と _ だけ、数字で始まらない
  { id: `${prefix}.name`, strict: true, source: '広く知られた決まり', test: (p) => (NAME.test(String(get(p) ?? '')) ? null : `${what}の名前は英数字と _ だけで、数字で始めません（${JSON.stringify(String(get(p) ?? '').slice(0, 60))}）`) },
  // 広く知られた決まり: GITHUB_ で始まる名前は GitHub のもの
  { id: `${prefix}.name-github`, strict: true, source: '広く知られた決まり', test: (p) => (/^GITHUB_/i.test(String(get(p) ?? '')) ? `${what}の名前は GITHUB_ で始められません` : null) },
];
const permValue = (v) => v === 'read' || v === 'write';
// (repository_projects and organization_projects take admin too: GitHub's own levels for them)
const permValueOf = (k, v) => permValue(v) || (v === 'admin' && /^(repository|organization)_projects$/.test(k));
/** the permissions an App may ask for (GitHub's names): only the tests' fakes use the list — GitHub adds new ones */
export const APP_PERMISSION_NAMES = Object.freeze(['actions', 'actions_variables', 'administration', 'attestations', 'checks', 'codespaces', 'contents', 'dependabot_secrets', 'deployments', 'environments', 'issues', 'merge_queues', 'metadata', 'packages', 'pages', 'pull_requests', 'repository_custom_properties', 'repository_hooks', 'repository_projects', 'secret_scanning_alerts', 'secrets', 'security_events', 'single_file', 'statuses', 'vulnerability_alerts', 'workflows',
  'members', 'organization_administration', 'organization_custom_roles', 'organization_hooks', 'organization_plan', 'organization_projects', 'organization_secrets', 'organization_self_hosted_runners', 'organization_user_blocking', 'organization_events', 'organization_announcement_banners', 'organization_copilot_seat_management', 'organization_personal_access_tokens', 'organization_personal_access_token_requests', 'organization_packages', 'organization_actions_variables', 'organization_custom_org_roles', 'organization_custom_properties', 'team_discussions',
  'email_addresses', 'followers', 'git_ssh_keys', 'gpg_keys', 'interaction_limits', 'profile', 'starring', 'copilot_messages', 'copilot_editor_context', 'blocking', 'codespaces_lifecycle_admin', 'codespaces_metadata', 'codespaces_secrets', 'codespaces_user_secrets', 'plan']);
/** the permissions the fine-grained token page takes in its address (its names; GitHub ignores the ones it does not know) */
const TOKEN_PERMS = /^(actions|actions_variables|variables|administration|contents|secrets|issues|pages|pull_requests|metadata|workflows|deployments|environments|checks|statuses|members|codespaces|discussions|packages|projects|security_events|webhooks|dependabot_secrets|merge_queues|attestations|custom_properties|repository_hooks|single_file|vulnerability_alerts|secret_scanning_alerts)$/;
const TOKEN_KEYS = new Set(['name', 'description', 'target_name', 'expires_in']);

export const RULES = Object.freeze({
  // ---- the writes (lib/gh.mjs) ----
  'secrets.put': [
    ...nameRules('secrets', '秘密', (p) => p?.path?.name),
    // 広く知られた決まり: 中身は repository の公開鍵で封じた base64 と、その鍵の key_id
    { id: 'secrets.sealed', strict: true, source: '広く知られた決まり', test: (p) => (filled(p?.body?.encrypted_value) && b64ok(p.body.encrypted_value) && filled(String(p?.body?.key_id ?? '')) ? null : `秘密 ${p?.path?.name ?? ''} の中身が封じられていません（encrypted_value と key_id）`) },
    // 広く知られた決まり（どこで量るかは推測）: 秘密は 48 KB まで — 封じたもの（base64、封の 48 バイト込み）から元の大きさを見積もる
    { id: 'secrets.size', strict: false, source: '広く知られた決まり（量り方は推測）', test: (p) => { const n = Math.floor(String(p?.body?.encrypted_value ?? '').replace(/=+$/, '').length * 3 / 4) - 48; return n > KB48 ? `秘密 ${p?.path?.name ?? ''} が大きすぎます（約 ${n} バイト: 48 KB まで）` : null; } },
  ],
  'secrets.delete': nameRules('secrets', '秘密', (p) => p?.path?.name).map((r) => ({ ...r, strict: false })),
  'variables.create': [
    ...nameRules('variables', '変数', (p) => p?.body?.name),
    // 広く知られた決まり: value は文字列（GitHub の JSON の検査）
    { id: 'variables.value', strict: true, source: '広く知られた決まり', test: (p) => (str(p?.body?.value) ? null : `変数 ${p?.body?.name ?? ''} の値は文字列で`) },
    // 広く知られた決まり: 変数は 48 KB まで
    { id: 'variables.size', strict: false, source: '広く知られた決まり', test: (p) => (size(p?.body?.value) > KB48 ? `変数 ${p?.body?.name ?? ''} が大きすぎます（${size(p?.body?.value)} バイト: 48 KB まで）` : null) },
  ],
  'variables.update': [
    ...nameRules('variables', '変数', (p) => p?.path?.name),
    { id: 'variables.value', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.value === undefined || str(p.body.value) ? null : `変数 ${p?.path?.name ?? ''} の値は文字列で`) },
    { id: 'variables.size', strict: false, source: '広く知られた決まり', test: (p) => (size(p?.body?.value) > KB48 ? `変数 ${p?.path?.name ?? ''} が大きすぎます（${size(p?.body?.value)} バイト: 48 KB まで）` : null) },
  ],
  dispatch: [
    // 広く知られた決まり: ref（枝かタグ）は要る
    { id: 'dispatch.ref', strict: true, source: '広く知られた決まり', test: (p) => (filled(p?.body?.ref) ? null : '枝（ref）が空です') },
    // 広く知られた決まり: inputs は名前 → 値の表
    { id: 'dispatch.inputs', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.inputs === undefined || isObj(p.body.inputs) ? null : 'inputs は 名前 → 値 の表で') },
    // 推測: 値は文字列（GitHub は真偽も受けることがある: 本番では止めない）
    { id: 'dispatch.input-strings', strict: false, source: '推測', test: (p) => { const bad = Object.entries(isObj(p?.body?.inputs) ? p.body.inputs : {}).filter(([, v]) => !str(v)).map(([k]) => k); return bad.length ? `inputs の値は文字列で（${bad.join('・')}）` : null; } },
    // 広く知られた決まり（数は変わる: 10 → 2025 年 12 月に 25）: inputs の数の上限
    { id: 'dispatch.input-count', strict: false, source: '広く知られた決まり（上限は変わる）', test: (p) => { const n = Object.keys(isObj(p?.body?.inputs) ? p.body.inputs : {}).length; return n > 25 ? `inputs が多すぎます（${n} 個: 25 個まで）` : null; } },
  ],
  'contents.put': [
    // 広く知られた決まり: path は repository の中のファイル
    { id: 'contents.path', strict: true, source: '広く知られた決まり', test: (p) => { const f = String(p?.path?.file ?? ''); return !f || f.startsWith('/') || f.endsWith('/') || f.split('/').some((x) => x === '' || x === '.' || x === '..') ? `ファイルの場所が正しくありません（${JSON.stringify(f.slice(0, 120))}）` : null; } },
    // 広く知られた決まり: message（commit の文）は要る
    { id: 'contents.message', strict: true, source: '広く知られた決まり', test: (p) => (str(p?.body?.message) && p.body.message.length > 0 ? null : 'commit の文（message）が空です') },
    // 広く知られた決まり: content は base64
    { id: 'contents.content', strict: true, source: '広く知られた決まり', test: (p) => (b64ok(p?.body?.content) ? null : 'ファイルの中身（content）は base64 で') },
    // 広く知られた決まり: 置き換えるときの sha は文字列
    { id: 'contents.sha', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.sha === undefined || filled(p.body.sha) ? null : '置き換えるファイルの sha が正しくありません') },
  ],
  'issues.create': [
    // 広く知られた決まり: title は要る
    { id: 'issues.title', strict: true, source: '広く知られた決まり', test: (p) => (filled(String(p?.body?.title ?? '')) ? null : 'issue の題（title）が空です') },
    // 推測: labels は名前の並び
    { id: 'issues.labels', strict: false, source: '推測', test: (p) => (p?.body?.labels === undefined || (Array.isArray(p.body.labels) && p.body.labels.every(filled)) ? null : 'labels はラベルの名前の並びで') },
    // 広く知られた決まり: 本文は 65536 文字まで
    { id: 'issues.body-size', strict: false, source: '広く知られた決まり', test: (p) => (String(p?.body?.body ?? '').length > 65536 ? 'issue の本文が長すぎます（65536 文字まで）' : null) },
  ],
  'issues.update': [
    // 広く知られた決まり: state は open か closed
    { id: 'issues.state', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.state === undefined || ['open', 'closed'].includes(p.body.state) ? null : `issue の state は open か closed（${String(p.body.state).slice(0, 20)}）`) },
  ],
  'issues.lock': [
    // 広く知られた決まり: 理由は 4 つのどれか（無くてもよい）
    { id: 'issues.lock-reason', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.lock_reason === undefined || ['off-topic', 'too heated', 'resolved', 'spam'].includes(p.body.lock_reason) ? null : 'ロックの理由は off-topic・too heated・resolved・spam のどれか') },
  ],
  'comments.create': [
    // 広く知られた決まり: 本文は要る
    { id: 'comments.body', strict: true, source: '広く知られた決まり', test: (p) => (filled(p?.body?.body) ? null : 'コメントが空です') },
    // 広く知られた決まり: 65536 文字まで
    { id: 'comments.body-size', strict: false, source: '広く知られた決まり', test: (p) => (String(p?.body?.body ?? '').length > 65536 ? 'コメントが長すぎます（65536 文字まで）' : null) },
  ],
  'labels.create': [
    // 広く知られた決まり: 名前は要る
    { id: 'labels.name', strict: true, source: '広く知られた決まり', test: (p) => (filled(p?.body?.name) ? null : 'ラベルの名前が空です') },
    // 広く知られた決まり（# 付きを断るかは推測）: 色は # の無い 16 進 6 桁
    { id: 'labels.color', strict: false, source: '広く知られた決まり', test: (p) => (p?.body?.color === undefined || /^[0-9a-fA-F]{6}$/.test(String(p.body.color)) ? null : 'ラベルの色は # の無い 16 進 6 桁（例 ededed）') },
    // 広く知られた決まり: 説明は 100 文字まで
    { id: 'labels.description', strict: false, source: '広く知られた決まり', test: (p) => (String(p?.body?.description ?? '').length > 100 ? 'ラベルの説明が長すぎます（100 文字まで）' : null) },
  ],
  'collaborators.put': [
    // 広く知られた決まり（組織は自分で作った役割の名前も渡せる: 本番では止めない）: 役割は 5 つ
    { id: 'collaborators.permission', strict: false, source: '広く知られた決まり', test: (p) => (p?.body?.permission === undefined || ['pull', 'triage', 'push', 'maintain', 'admin'].includes(p.body.permission) ? null : `協力者の役割は pull・triage・push・maintain・admin のどれか（${String(p.body.permission).slice(0, 30)}）`) },
    // 広く知られた決まり: GitHub の名前（英数字と -、39 文字まで）
    { id: 'collaborators.login', strict: false, source: '広く知られた決まり', test: (p) => (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(String(p?.path?.login ?? '')) ? null : '協力者の GitHub の名前が正しくありません') },
  ],
  'invitations.accept': [
    // 推測: 招待の id は数
    { id: 'invitations.id', strict: false, source: '推測', test: (p) => (/^\d+$/.test(String(p?.path?.id ?? '')) ? null : '招待の id が正しくありません') },
  ],
  'pages.create': [
    // 広く知られた決まり: build_type は workflow か legacy
    { id: 'pages.build_type', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.build_type === undefined || ['workflow', 'legacy'].includes(p.body.build_type) ? null : 'Pages の build_type は workflow か legacy') },
  ],
  'pages.update': [
    { id: 'pages.build_type', strict: true, source: '広く知られた決まり', test: (p) => (p?.body?.build_type === undefined || ['workflow', 'legacy'].includes(p.body.build_type) ? null : 'Pages の build_type は workflow か legacy') },
  ],
  'merge-upstream': [
    // 広く知られた決まり: branch は要る
    { id: 'merge-upstream.branch', strict: true, source: '広く知られた決まり', test: (p) => (filled(p?.body?.branch) ? null : 'フォークを揃える枝（branch）が空です') },
  ],
  'workflows.enable': [
    // 推測: ワークフローは数の id かファイルの名前
    { id: 'workflows.id', strict: false, source: '推測', test: (p) => (/^(\d+|[^/]+\.ya?ml)$/.test(String(p?.path?.workflow ?? '')) ? null : 'ワークフローは id か .yml の名前で') },
  ],
  'workflows.disable': [
    { id: 'workflows.id', strict: false, source: '推測', test: (p) => (/^(\d+|[^/]+\.ya?ml)$/.test(String(p?.path?.workflow ?? '')) ? null : 'ワークフローは id か .yml の名前で') },
  ],
  'runs.cancel': [
    // 推測: 実行の id は数
    { id: 'runs.id', strict: false, source: '推測', test: (p) => (/^\d+$/.test(String(p?.path?.run ?? '')) ? null : '実行の id が正しくありません') },
  ],
  'runs.rerun': [
    { id: 'runs.id', strict: false, source: '推測', test: (p) => (/^\d+$/.test(String(p?.path?.run ?? '')) ? null : '実行の id が正しくありません') },
  ],
  'app-manifests.conversions': [
    // 推測: GitHub が戻した code（英数字・_・-）
    { id: 'app-manifests.code', strict: false, source: '推測', test: (p) => (/^[A-Za-z0-9_-]{1,200}$/.test(String(p?.path?.code ?? '')) ? null : 'App の code の形が違います') },
  ],

  // ---- what the panel hands GitHub's pages (lib/setup.mjs) ----
  appManifest: [
    // 広く知られた決まり（GitHub の「Name is too long (maximum is 34 characters)」）: 名前は 1〜34 文字
    { id: 'manifest.name', strict: true, source: '広く知られた決まり', test: (m) => (m?.name === undefined || (str(m.name) && m.name.trim().length >= 1 && [...m.name].length <= 34) ? null : `App の名前は 1〜34 文字で（${[...String(m?.name ?? '')].length} 文字）`) },   // (no name: GitHub's page asks for one; counted in characters, not UTF-16 units)
    // 広く知られた決まり: url（App のページ）は要る、http(s) の絶対 URL
    { id: 'manifest.url', strict: true, source: '広く知られた決まり', test: (m) => absUrl(m?.url, 'url') },
    // 推測: url に #fragment
    { id: 'manifest.url-fragment', strict: false, source: '推測', test: (m) => noFrag(m?.url, 'url') },
    // 実際のエラー（「"url" wasn't supplied」）: hook_attributes には url が要る（active: false でも）
    { id: 'manifest.hook-url', strict: true, source: '実際のエラー', test: (m) => (m?.hook_attributes === undefined ? null : !isObj(m.hook_attributes) ? 'hook_attributes は表で' : absUrl(m.hook_attributes.url, 'hook_attributes.url') && `${absUrl(m.hook_attributes.url, 'hook_attributes.url')}（GitHub:「"url" wasn't supplied」）`) },
    // 推測: hook_attributes が無いとき（受け付けるかは要実測）
    { id: 'manifest.hook', strict: false, source: '推測', test: (m) => (isObj(m?.hook_attributes) ? null : 'hook_attributes（url と active）がありません') },
    // 推測: hook_attributes.url の #fragment
    { id: 'manifest.hook-fragment', strict: false, source: '推測', test: (m) => noFrag(m?.hook_attributes?.url, 'hook_attributes.url') },
    // 広く知られた決まり: redirect_url は http(s) の絶対 URL
    { id: 'manifest.redirect', strict: true, source: '広く知られた決まり', test: (m) => (m?.redirect_url === undefined ? null : absUrl(m.redirect_url, 'redirect_url')) },
    // 実際のエラー（「redirect_url must be a valid URL」）: redirect_url に #fragment は入れられない
    { id: 'manifest.redirect-fragment', strict: true, source: '実際のエラー', test: (m) => (noFrag(m?.redirect_url, 'redirect_url') && `${noFrag(m.redirect_url, 'redirect_url')}（GitHub:「redirect_url must be a valid URL」）`) },
    // 広く知られた決まり: setup_url は http(s) の絶対 URL
    { id: 'manifest.setup', strict: true, source: '広く知られた決まり', test: (m) => (m?.setup_url === undefined ? null : absUrl(m.setup_url, 'setup_url')) },
    // 推測: setup_url の #fragment（redirect_url と同じく断ると見る）
    { id: 'manifest.setup-fragment', strict: false, source: '推測', test: (m) => noFrag(m?.setup_url, 'setup_url') },
    // 広く知られた決まり: callback_urls は URL の並びで 10 個まで
    { id: 'manifest.callbacks', strict: true, source: '広く知られた決まり', test: (m) => (m?.callback_urls === undefined ? null : !Array.isArray(m.callback_urls) ? 'callback_urls は URL の並びで' : m.callback_urls.length > 10 ? `callback_urls は 10 個まで（${m.callback_urls.length} 個）` : m.callback_urls.map((u, i) => (urlOf(u) ? null : `callback_urls[${i}] が URL の形ではありません`)).find(Boolean) ?? null) },
    // 推測: callback_urls は http(s)（独自スキームを GitHub が受けるかは要実測: 本番では止めない）
    { id: 'manifest.callbacks-http', strict: false, source: '推測', test: (m) => (Array.isArray(m?.callback_urls) ? m.callback_urls.map((u, i) => absUrl(u, `callback_urls[${i}]`)).find(Boolean) ?? null : null) },
    // 広く知られた決まり（OAuth の戻り先に #fragment は使えない）
    { id: 'manifest.callback-fragment', strict: true, source: '広く知られた決まり', test: (m) => (Array.isArray(m?.callback_urls) ? m.callback_urls.map((u, i) => noFrag(u, `callback_urls[${i}]`)).find(Boolean) ?? null : null) },
    // 広く知られた決まり: 権限の値は read か write
    { id: 'manifest.permission-values', strict: true, source: '広く知られた決まり', test: (m) => { if (m?.default_permissions === undefined) return null; if (!isObj(m.default_permissions)) return 'default_permissions は 名前 → read / write の表で'; const bad = Object.entries(m.default_permissions).filter(([k, v]) => !permValueOf(k, v)).map(([k]) => k); return bad.length ? `権限の値は read か write（${bad.join('・')}）` : null; } },
    // 広く知られた決まり（一覧は GitHub が増やす: 本番では止めない）: 権限の名前
    { id: 'manifest.permission-names', strict: false, source: '広く知られた決まり', test: (m) => { const bad = Object.keys(isObj(m?.default_permissions) ? m.default_permissions : {}).filter((k) => !APP_PERMISSION_NAMES.includes(k)); return bad.length ? `GitHub に無い権限の名前です（${bad.join('・')}）` : null; } },
    // 広く知られた決まり: public は真偽
    { id: 'manifest.public', strict: false, source: '広く知られた決まり', test: (m) => (m?.public === undefined || typeof m.public === 'boolean' ? null : 'public は true か false') },
    // 広く知られた決まり: default_events は名前の並び
    { id: 'manifest.events', strict: false, source: '広く知られた決まり', test: (m) => (m?.default_events === undefined || (Array.isArray(m.default_events) && m.default_events.every(filled)) ? null : 'default_events はイベントの名前の並びで') },
  ],
  tokenUrl: [
    // 広く知られた決まり: fine-grained トークンを作る GitHub の画面
    { id: 'token.page', strict: true, source: '広く知られた決まり', test: (s) => { const u = urlOf(s); return u && u.origin === 'https://github.com' && u.pathname === '/settings/personal-access-tokens/new' && !u.hash ? null : 'トークンの画面の URL ではありません（https://github.com/settings/personal-access-tokens/new）'; } },
    // 実際のエラー（Variables が variables だけでは入らなかった）: 変数の権限は actions_variables の名前でも渡す
    { id: 'token.variables', strict: true, source: '実際のエラー', test: (s) => { const q = urlOf(s)?.searchParams; return q && q.has('variables') && !q.has('actions_variables') ? '変数（Variables）の権限は actions_variables でも渡してください（variables だけでは入りません）' : null; } },
    // 広く知られた決まり: 権限の値は read か write
    { id: 'token.permission-values', strict: true, source: '広く知られた決まり', test: (s) => { const q = urlOf(s)?.searchParams; if (!q) return null; const bad = [...q].filter(([k, v]) => !TOKEN_KEYS.has(k) && !permValue(v)).map(([k]) => k); return bad.length ? `トークンの権限の値は read か write（${bad.join('・')}）` : null; } },
    // 推測: 画面の受ける権限の名前（知らない名前は GitHub が黙って捨てる）
    { id: 'token.permission-names', strict: false, source: '推測', test: (s) => { const q = urlOf(s)?.searchParams; if (!q) return null; const bad = [...q.keys()].filter((k) => !TOKEN_KEYS.has(k) && !TOKEN_PERMS.test(k)); return bad.length ? `トークンの画面が知らない権限の名前です（${bad.join('・')}）` : null; } },
    // 広く知られた決まり: 期限は 1〜366 日
    { id: 'token.expires', strict: false, source: '広く知られた決まり', test: (s) => { const e = urlOf(s)?.searchParams.get('expires_in'); return e === null || e === undefined || (/^\d+$/.test(e) && Number(e) >= 1 && Number(e) <= 366) ? null : 'トークンの期限（expires_in）は 1〜366 日'; } },
    // 広く知られた決まり: トークンの名前は 40 文字まで
    { id: 'token.name', strict: false, source: '広く知られた決まり', test: (s) => { const n = urlOf(s)?.searchParams.get('name'); return n && n.length > 40 ? 'トークンの名前は 40 文字まで' : null; } },
  ],
  installLink: [
    // 広く知られた決まり: App を入れる GitHub の画面（/apps/<slug>/installations/new、選んだ先つきは /permissions）
    { id: 'install.page', strict: true, source: '広く知られた決まり', test: (s) => { const u = urlOf(s); return u && u.origin === 'https://github.com' && /^\/apps\/[^/]+\/installations\/new(\/permissions)?$/.test(u.pathname) && !u.hash ? null : 'App を入れる画面の URL ではありません'; } },
    // 推測: App の slug の文字（英小文字・数字・-）: 本番では止めない
    { id: 'install.slug', strict: false, source: '推測', test: (s) => { const u = urlOf(s); return !u || /^\/apps\/[a-z0-9][a-z0-9-]{0,99}\//.test(u.pathname) ? null : 'App の slug は英小文字・数字・-'; } },
    // 推測: 選んだ先（suggested_target_id）と repository_ids[] は数で、/permissions の画面と一緒に
    { id: 'install.ids', strict: false, source: '推測', test: (s) => { const u = urlOf(s); if (!u) return null; const t = u.searchParams.get('suggested_target_id'), r = u.searchParams.getAll('repository_ids[]'); if (t === null && !r.length) return null; return /\/permissions$/.test(u.pathname) && /^\d+$/.test(t ?? '') && r.length && r.every((x) => /^\d+$/.test(x)) ? null : 'suggested_target_id と repository_ids[] は数で、/installations/new/permissions に'; } },
  ],
});
/** the kinds there are rules for */
export const kinds = Object.freeze(Object.keys(RULES));

/** what is wrong with what is sent (pure) → [problems in words] (empty: fine). strictOnly: only the sure rules (the panel's
 *  own check before sending) */
export function check(kind, payload, { strictOnly = false } = {}) {
  const out = [];
  for (const r of RULES[kind] ?? []) {
    if (strictOnly && !r.strict) continue;
    let m = null; try { m = r.test(payload); } catch (e) { m = `${r.id}: ${e?.message ?? e}`; }
    if (m) out.push(m);
  }
  return out;
}

const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const R = '/repos/[^/]+/[^/]+';
// (method, the address's pattern, the kind, the names of its captured parts)
const ROUTES = [
  ['PUT', `${R}/actions/secrets/([^/]+)`, 'secrets.put', ['name']],
  ['DELETE', `${R}/actions/secrets/([^/]+)`, 'secrets.delete', ['name']],
  ['POST', `${R}/actions/variables`, 'variables.create', []],
  ['PATCH', `${R}/actions/variables/([^/]+)`, 'variables.update', ['name']],
  ['POST', `${R}/actions/workflows/([^/]+)/dispatches`, 'dispatch', ['workflow']],
  ['PUT', `${R}/actions/workflows/([^/]+)/enable`, 'workflows.enable', ['workflow']],
  ['PUT', `${R}/actions/workflows/([^/]+)/disable`, 'workflows.disable', ['workflow']],
  ['POST', `${R}/actions/runs/([^/]+)/cancel`, 'runs.cancel', ['run']],
  ['POST', `${R}/actions/runs/([^/]+)/rerun-failed-jobs`, 'runs.rerun', ['run']],
  ['PUT', `${R}/contents/(.+)`, 'contents.put', ['file']],
  ['POST', `${R}/issues`, 'issues.create', []],
  ['PATCH', `${R}/issues/([^/]+)`, 'issues.update', ['number']],
  ['PUT', `${R}/issues/([^/]+)/lock`, 'issues.lock', ['number']],
  ['POST', `${R}/issues/([^/]+)/comments`, 'comments.create', ['number']],
  ['POST', `${R}/labels`, 'labels.create', []],
  ['PUT', `${R}/collaborators/([^/]+)`, 'collaborators.put', ['login']],
  ['PATCH', '/user/repository_invitations/([^/]+)', 'invitations.accept', ['id']],
  ['POST', `${R}/pages`, 'pages.create', []],
  ['PUT', `${R}/pages`, 'pages.update', []],
  ['POST', `${R}/merge-upstream`, 'merge-upstream', []],
  ['POST', '/app-manifests/([^/]+)/conversions', 'app-manifests.conversions', ['code']],
].map(([m, re, kind, names]) => [m, new RegExp(`^${re}$`), kind, names]);
/** a write's method and address → { kind, path: its parts (decoded) } | null (a read, or one there are no rules for) (pure) */
export function kindOf(method, address) {
  const p = String(address ?? '').split('?')[0].replace(/^https:\/\/api\.github\.com/, ''), m = String(method ?? '').toUpperCase();
  for (const [mm, re, kind, names] of ROUTES) {
    if (mm !== m) continue;
    const x = re.exec(p);
    if (x) return { kind, path: Object.fromEntries(names.map((n, i) => [n, n === 'file' ? x[i + 1].split('/').map(dec).join('/') : dec(x[i + 1])])) };
  }
  return null;
}
/** for the tests' fake GitHubs: every rule, sure or not → { status: 422, message } as GitHub would answer, or null (pure) */
export function fakeCheck(method, address, body) {
  const k = kindOf(method, address);
  if (!k) return null;
  const problems = check(k.kind, { path: k.path, body: body ?? undefined });
  return problems.length ? { status: 422, message: problems.join('・') } : null;
}
