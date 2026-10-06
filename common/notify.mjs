// Results to the person's phone: LAB_NOTIFY_WEBHOOK in .env (or a CI secret) = a Discord or Slack webhook URL, an ntfy.sh
// topic URL, or any URL that takes a JSON POST. make, maintain and the newest-version check send one message when they end.
//   node lab.mjs notify "text"   sends a test message
// Best-effort: no URL → nothing; a failure is one W line, never a failed command.
export async function notify(title, lines = [], { ok = true, url = process.env.LAB_NOTIFY_WEBHOOK, out = () => {} } = {}) {
  if (!url) return false;
  const text = [`${ok ? '✅' : '⚠️'} ${title}`, ...lines].join('\n').slice(0, 1900);
  let body, headers = { 'content-type': 'application/json' };
  if (/discord(app)?\.com\/api\/webhooks/.test(url)) body = JSON.stringify({ username: 'bds-lab', content: text });
  else if (/hooks\.slack\.com/.test(url)) body = JSON.stringify({ text });
  else if (/ntfy\./.test(url)) { body = lines.join('\n') || title; headers = { title: encodeURIComponent(`bds-lab: ${title}`).slice(0, 200), tags: ok ? 'white_check_mark' : 'warning' }; }
  else body = JSON.stringify({ source: 'bds-lab', title, ok, text, lines });
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { out(`W notify: HTTP ${r.status}`); return false; }
    return true;
  } catch (e) { out(`W notify: ${e.cause?.code ?? e.message}`); return false; }
}
export async function notifyCmd(args, out = console.log) {
  if (!process.env.LAB_NOTIFY_WEBHOOK) { out('LAB_NOTIFY_WEBHOOK がありません: .env に LAB_NOTIFY_WEBHOOK=<Discord / Slack の Webhook URL か https://ntfy.sh/<トピック>> と書いてください'); return false; }
  const ok = await notify(args.join(' ') || 'bds-lab からのテスト通知です', [], { out });
  out(ok ? 'OK 送りました' : 'FAIL 送れませんでした');
  return ok;
}
