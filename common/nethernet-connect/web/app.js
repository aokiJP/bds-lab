'use strict';
// nethernet-connect の Web 画面。外部ライブラリなし。受け取った文字列は必ず esc() してから入れる。
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const PHASES = ['Signaling', 'SdpExchange', 'IceGathering', 'IceChecking', 'Dtls', 'Sctp', 'Connected'];
  const TR = { lan: 'LAN方式', http: 'HTTP(BDS)', raknet: 'RakNet' };
  const TR_LONG = { lan: 'LAN方式（ローカルワールド）', http: 'NetherNet・HTTP（BDS）', raknet: 'RakNet（サーバー）' };

  // ---- トークン: URL の #t=... → sessionStorage（URL からは消す）
  let token = '';
  try {
    const h = new URLSearchParams(location.hash.slice(1)).get('t');
    if (h) { sessionStorage.setItem('nc-token', h); history.replaceState(null, '', location.pathname); }
    token = sessionStorage.getItem('nc-token') || '';
  } catch { token = new URLSearchParams(location.hash.slice(1)).get('t') || ''; }

  let S = null; // 最新の状態
  let filter = 'all';
  const logs = new Map(); // session id -> lines
  const boxes = new Map(); // session id -> element

  const toast = (text) => {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 4500);
  };

  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-NC-Token': token }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { showToken(); throw new Error(j.error || 'トークンが必要です'); }
    if (!r.ok) throw new Error(j.error || `エラー ${r.status}`);
    return j;
  }

  function showToken() { $('#token-box').hidden = false; }
  $('#token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('#token-input').value.trim();
    try { sessionStorage.setItem('nc-token', token); } catch {}
    $('#token-box').hidden = true;
    connectEvents();
  });

  // ---- 確認ダイアログ
  function confirmBox(title, body) {
    return new Promise((resolve) => {
      const d = $('#confirm-dlg');
      $('#c-title').textContent = title; $('#c-body').textContent = body;
      d.returnValue = ''; d.showModal();
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    });
  }

  // ---- 描画
  function chips() {
    const out = [];
    const lan = (S.scope || []).filter((l) => /許可 LAN/.test(l)).map((l) => l.replace(/^\s*許可 LAN:\s*/, ''));
    for (const l of lan) out.push(`<span class="chip ok">LAN <b>${esc(l)}</b></span>`);
    if (S.tailscale.enabled) {
      const n = S.tailscale.peers.filter((p) => p.allowed).length;
      out.push(`<span class="chip info">Tailscale <b>${n}台</b></span>`);
    } else out.push(`<span class="chip" title="${esc(S.tailscale.reason)}">Tailscale なし</span>`);
    out.push(`<span class="chip">${S.offline ? `オフライン名 <b>${esc(S.offlineName)}</b>` : 'オンライン認証'}</span>`);
    $('#net').innerHTML = out.join('');
    $('#scope').textContent = (S.scope || []).join('\n');
  }

  function viaBadge(e) {
    if (e.via === 'this-host') return '<span class="chip">このマシン</span>';
    if (e.via === 'tailscale') return `<span class="chip info">Tailscale: ${esc(e.device || '')}</span>`;
    return '<span class="chip ok">LAN</span>';
  }

  function card(e) {
    const kind = e.kind === 'world' ? 'world' : 'server';
    const title = e.kind === 'world' ? e.levelName || e.motd : e.motd || e.levelName;
    const sub = [e.kind === 'world' ? `ホスト ${e.motd}` : e.levelName ? `ワールド ${e.levelName}` : '', e.gameVersion ? `v${e.gameVersion}` : e.protocol ? `protocol ${e.protocol}` : '', e.address].filter(Boolean).join(' · ');
    const trs = ['lan', 'http', 'raknet'].filter((t) => e[t]).map((t) => `<span class="chip${t === e.preferred ? ' ok' : ''}" title="${t === e.preferred ? '元の方式' : ''}">${TR[t]}</span>`).join('');
    const pct = e.playersMax ? Math.min(100, Math.round((e.playerCount / e.playersMax) * 100)) : 0;
    const el = document.createElement('div');
    el.className = 'card' + (e.decision.allowed ? '' : ' off');
    el.innerHTML = `
      <div class="icon ${kind}" aria-hidden="true">${kind === 'world' ? '' : ''}</div>
      <div class="title">${esc(title || '(名前なし)')}</div>
      <div class="act">${e.decision.allowed ? '<button class="primary" data-join>参加</button>' : ''}<span class="muted">${esc(e.playerCount)}/${esc(e.playersMax)}人</span><span class="bar"><i style="width:${pct}%"></i></span></div>
      <div class="meta">${esc(sub)}</div>
      <div class="badges"><span class="chip">${kind === 'world' ? 'ワールド' : 'サーバー'}</span>${viaBadge(e)}${trs}</div>
      ${(e.warnings || []).map((w) => `<div class="note">注意: ${esc(w)}</div>`).join('')}
      ${e.decision.allowed ? '' : `<div class="reason">${esc(e.decision.reason)}</div>`}`;
    const b = el.querySelector('[data-join]');
    if (b) b.addEventListener('click', () => openJoin(e));
    return el;
  }

  function renderEndpoints() {
    const list = S.endpoints.filter((e) => filter === 'all' || (filter === 'world') === (e.kind === 'world'));
    const ok = list.filter((e) => e.decision.allowed);
    const ng = list.filter((e) => !e.decision.allowed);
    const box = $('#endpoints');
    box.replaceChildren(...ok.map(card));
    if (!ok.length) {
      box.innerHTML = `<div class="empty">${S.discovering ? '<span class="spin"></span> 探しています…' : S.lastDiscovery ? '参加できるワールド・サーバーは見つかりませんでした。ホスト側で「LANプレイヤーに表示」がONか、同じネットワークにいるか確認してください。' : '「探す」を押すと、同じLANと自分の Tailscale の端末からワールド・サーバーを探します。'}</div>`;
    }
    $('#denied').hidden = !ng.length;
    $('#denied-sum').textContent = `接続できない相手 (${ng.length})`;
    $('#denied-list').replaceChildren(...ng.map(card));
    $('#scanned').textContent = S.discovering ? '探しています…' : S.lastDiscovery ? `最終: ${new Date(S.lastDiscovery).toLocaleTimeString()}` : '';
    const sc = $('#scan');
    sc.disabled = S.discovering;
    sc.innerHTML = S.discovering ? '<span class="spin"></span> 探しています' : '探す';
  }

  function lineClass(l) {
    if (/\[guard:拒否|\[error\]|キック/.test(l)) return 'deny';
    if (/\[chat\]/.test(l)) return 'chat';
    if (/\[phase\]|\[route\]|ログイン完了/.test(l)) return 'phase';
    return '';
  }

  function sessionBox(s) {
    const el = document.createElement('div');
    el.className = 'box';
    const idx = PHASES.indexOf(s.phase);
    const failed = s.phase === 'Failed' || (s.state === 'closed' && idx < PHASES.length - 1 && s.phase !== 'Connected');
    const steps = s.transport === 'raknet' ? '' : `<div class="steps" title="${esc(s.phase)}">${PHASES.map((p, i) => `<span class="${i <= idx ? 'done' : failed && i === idx + 1 ? 'fail' : ''}"></span>`).join('')}</div><div class="steplabel">${esc(s.phase)}</div>`;
    const state = s.state === 'connected' ? '<span class="chip ok">接続中</span>' : s.state === 'connecting' ? '<span class="chip warn"><span class="spin"></span> 接続中…</span>' : '<span class="chip">切断</span>';
    el.innerHTML = `
      <div class="row"><b class="grow">${esc(s.title)}</b>${state}</div>
      <div class="badges"><span class="chip">${TR[s.transport]}</span><span class="chip">${s.account ? esc(s.account) : 'オフライン'}</span>${s.observe ? `<span class="chip info">観戦${s.allowChat ? '・チャット可' : ''}</span>` : '<span class="chip">通常</span>'}</div>
      ${steps}
      <pre class="log" data-log></pre>
      ${s.state !== 'closed' ? `<form class="chat"><input type="text" maxlength="256" placeholder="${s.observe && !s.allowChat ? '観戦モード（チャット不可）' : 'チャット'}" ${s.observe && !s.allowChat ? 'disabled' : ''}><button ${s.observe && !s.allowChat ? 'disabled' : ''}>送信</button></form>` : ''}
      <div class="row" style="margin-top:8px"><span class="grow muted">${s.outcome ? esc(s.outcome) : ''}</span>
        ${s.snapshotId ? `<button class="small" data-restore="${esc(s.snapshotId)}">元に戻す</button>` : ''}
        ${s.state !== 'closed' ? '<button class="small danger" data-leave>退出</button>' : '<button class="small" data-remove>消す</button>'}</div>`;
    const pre = el.querySelector('[data-log]');
    const lines = logs.get(s.id) || s.log || [];
    logs.set(s.id, lines);
    pre.innerHTML = lines.map((l) => `<span class="${lineClass(l)}">${esc(l)}</span>`).join('\n');
    requestAnimationFrame(() => (pre.scrollTop = pre.scrollHeight));
    const f = el.querySelector('form.chat');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = f.querySelector('input');
      try { await api('POST', `/api/sessions/${s.id}/chat`, { text: inp.value }); inp.value = ''; } catch (err) { toast(err.message); }
    });
    el.querySelector('[data-leave]')?.addEventListener('click', () => api('POST', `/api/sessions/${s.id}/leave`).catch((e) => toast(e.message)));
    el.querySelector('[data-remove]')?.addEventListener('click', () => api('DELETE', `/api/sessions/${s.id}`).catch((e) => toast(e.message)));
    el.querySelector('[data-restore]')?.addEventListener('click', () => restore(s.snapshotId));
    boxes.set(s.id, el);
    return el;
  }

  function renderSessions() {
    const box = $('#sessions');
    const list = S.sessions.slice().reverse();
    boxes.clear();
    box.replaceChildren(...list.map(sessionBox));
    if (!list.length) box.innerHTML = '<div class="empty">まだ誰も参加していません</div>';
  }

  // 1つのセッションだけ描き直す（入力途中のチャットは残す）
  function updateSession(s) {
    const old = boxes.get(s.id);
    if (!old || !old.isConnected) return renderSessions();
    const oi = old.querySelector('form.chat input');
    const focused = document.activeElement === oi;
    const nw = sessionBox(s);
    const ni = nw.querySelector('form.chat input');
    if (oi && ni) ni.value = oi.value;
    old.replaceWith(nw);
    if (focused && ni) ni.focus();
  }

  function appendLog(id, line) {
    const el = boxes.get(id);
    const pre = el?.querySelector('[data-log]');
    if (!pre) return;
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
    const span = document.createElement('span');
    span.className = lineClass(line);
    span.textContent = line;
    if (pre.childNodes.length) pre.append('\n');
    pre.append(span);
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }

  async function restore(id) {
    const snap = S.snapshots.find((x) => x.id === id);
    const ok = await confirmBox('元に戻しますか？', `${snap ? snap.label : id} の時点に戻します。BDS は止めてから、ワールドは閉じてから実行してください。戻す前の状態も別に保存されます。`);
    if (!ok) return;
    try { const r = await api('POST', `/api/snapshots/${id}/restore`, {}); toast(`元に戻しました（戻す前: ${r.backup}）`); } catch (e) { toast(e.message); }
  }

  function renderRestore() {
    const box = $('#restore');
    const parts = [];
    if (!S.restoreTargets.length) parts.push('<div class="empty">このマシンの BDS やワールドのフォルダを設定の restore.targets に登録すると、ここで取っておいて元に戻せます。別の端末のワールドは、観戦モードで「何も変えない」ことで元の状態を保ちます。</div>');
    for (const t of S.restoreTargets) parts.push(`<div class="box"><div class="row"><div class="grow"><b>${esc(t.name)}</b><div class="muted">${t.kind === 'bds' ? 'BDS' : 'ワールド'} · ${esc(t.path)}</div></div><button class="small" data-snap="${esc(t.name)}">今の状態を取っておく</button></div></div>`);
    for (const s of S.snapshots.slice(0, 20)) parts.push(`<div class="box"><div class="row"><div class="grow"><b>${esc(s.label)}</b><div class="muted">${new Date(s.created).toLocaleString()} · ${s.files} ファイル</div></div><button class="small" data-restore="${esc(s.id)}">元に戻す</button><button class="small danger" data-del="${esc(s.id)}">削除</button></div></div>`);
    box.innerHTML = parts.join('');
    box.querySelectorAll('[data-snap]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('POST', '/api/snapshots', { target: b.dataset.snap }); toast('取っておきました'); } catch (e) { toast(e.message); }
    }));
    box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restore(b.dataset.restore)));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmBox('スナップショットを削除しますか？', '削除すると、その時点には戻せなくなります。')) api('DELETE', `/api/snapshots/${b.dataset.del}`).catch((e) => toast(e.message));
    }));
  }

  function renderAccounts() {
    const box = $('#accounts');
    const rows = S.accounts.map((a) => `<div class="box"><div class="row"><div class="grow"><b>${esc(a.name)}</b>${a.name === S.defaultAccount ? ' <span class="chip ok">既定</span>' : ''}<div class="muted">${a.gamertag ? esc(a.gamertag) : 'ゲーマータグは初回接続後に表示'}${a.lastUsed ? ' · 最終 ' + new Date(a.lastUsed).toLocaleDateString() : ''}</div></div><button class="small danger" data-rm="${esc(a.name)}">削除</button></div></div>`);
    box.innerHTML = rows.join('') + `<form class="row box" id="acc-form"><input type="text" class="grow" id="acc-name" placeholder="新しいアカウント名（英数字）" pattern="[A-Za-z0-9_-]{1,32}" required><button>サインイン</button></form>` + (S.offline ? '<div class="muted" style="margin-top:6px">いまはオフライン設定です（auth.offline=true）。アカウントはオンライン時に使います。</div>' : '');
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmBox(`アカウント ${b.dataset.rm} を削除しますか？`, 'このマシンに保存したサインイン情報も消えます。')) api('DELETE', `/api/accounts/${b.dataset.rm}`).catch((e) => toast(e.message));
    }));
    $('#acc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/accounts', { name: $('#acc-name').value.trim() }); toast('サインインを始めました。表示されるコードを入力してください'); } catch (err) { toast(err.message); }
    });
  }

  function render() {
    if (!S) return;
    chips(); renderEndpoints(); renderSessions(); renderRestore(); renderAccounts();
    $('#glog').textContent = (S.log || []).join('\n');
  }

  // ---- 参加ダイアログ
  function openJoin(e) {
    const d = $('#join-dlg');
    $('#join-title').textContent = `${e.kind === 'world' ? e.levelName || e.motd : e.motd || e.levelName} に参加`;
    $('#join-sub').textContent = `${e.address}${e.device ? `（Tailscale: ${e.device}）` : ''} · 元の方式: ${TR_LONG[e.preferred]}`;
    const tr = $('#j-transport');
    tr.innerHTML = ['lan', 'http', 'raknet'].filter((t) => e[t]).map((t) => `<option value="${t}" ${t === e.preferred ? 'selected' : ''}>${TR_LONG[t]}${t === e.preferred ? '（元の方式）' : ''}</option>`).join('');
    const acc = $('#j-account');
    $('#j-account-wrap').hidden = S.offline;
    acc.innerHTML = S.accounts.map((a) => `<option value="${esc(a.name)}" ${a.name === S.defaultAccount ? 'selected' : ''}>${esc(a.name)}${a.gamertag ? `（${esc(a.gamertag)}）` : ''}</option>`).join('') || '<option value="">（未登録: 接続時にサインイン）</option>';
    const obs = S.defaultObserve === 'on' || (S.defaultObserve === 'auto' && e.kind === 'world');
    $('#j-observe').checked = obs;
    $('#j-chat').checked = S.allowChat;
    const snap = $('#j-snap');
    $('#j-snap-wrap').hidden = !S.restoreTargets.length;
    snap.innerHTML = '<option value="">取らない</option>' + S.restoreTargets.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('');
    d.returnValue = '';
    d.showModal();
    d.addEventListener('close', async () => {
      if (d.returnValue !== 'ok') return;
      try {
        await api('POST', '/api/join', { endpointId: e.id, transport: tr.value, account: acc.value || undefined, observe: $('#j-observe').checked, allowChat: $('#j-chat').checked, snapshotTarget: snap.value || undefined });
      } catch (err) { toast(err.message); }
    }, { once: true });
  }

  // ---- 操作
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderEndpoints();
  }));
  $('#scan').addEventListener('click', () => api('POST', '/api/discover', {}).catch((e) => toast(e.message)));

  // ---- サーバーからの通知（SSE）
  let es = null;
  async function connectEvents() {
    if (!token) { showToken(); return; }
    try { S = await api('GET', '/api/state'); render(); } catch { return; } // 401 ならトークン入力を出す
    es?.close();
    es = new EventSource(`/api/events?t=${encodeURIComponent(token)}`);
    es.addEventListener('state', (ev) => { S = JSON.parse(ev.data); for (const s of S.sessions) if (!logs.has(s.id)) logs.set(s.id, s.log); render(); });
    es.addEventListener('session', (ev) => {
      const s = JSON.parse(ev.data);
      if (!S) return;
      const i = S.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) S.sessions[i] = s; else S.sessions.push(s);
      if (!logs.has(s.id)) logs.set(s.id, s.log);
      if (i >= 0) updateSession(s); else renderSessions();
    });
    es.addEventListener('log', (ev) => {
      const { id, line } = JSON.parse(ev.data);
      const l = logs.get(id) || []; l.push(line); if (l.length > 300) l.shift(); logs.set(id, l);
      appendLog(id, line);
    });
    es.addEventListener('note', (ev) => { if (!S) return; S.log = [...(S.log || []), JSON.parse(ev.data).line].slice(-100); $('#glog').textContent = S.log.join('\n'); });
    es.addEventListener('auth', (ev) => {
      const a = JSON.parse(ev.data);
      const box = $('#auth-box');
      box.hidden = false;
      box.innerHTML = `<div>アカウント <b>${esc(a.name)}</b> のサインイン: <b>${esc(a.verification_uri)}</b> を開いて、次のコードを入力してください。</div><div class="code" style="margin-top:6px">${esc(a.user_code)}</div><div class="muted" style="margin-top:6px">サインインが終わると一覧に追加されます。 <button class="small" id="auth-close">閉じる</button></div>`;
      $('#auth-close').addEventListener('click', () => (box.hidden = true));
    });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setTimeout(connectEvents, 3000); };
  }
  connectEvents();
})();
