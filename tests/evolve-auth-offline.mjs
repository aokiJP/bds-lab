// OAuth must finish when GitHub or a streaming client stalls; malformed tokens never become a session.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test as nodeTest } from 'node:test';
import { handler, tokensOf } from '../auth/handler.mjs';
import { server } from '../auth/node.mjs';
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const env = { GITHUB_CLIENT_ID: 'app', GITHUB_CLIENT_SECRET: 'not-for-output', STATE_SECRET: 'a'.repeat(32), PANEL_ORIGINS: 'https://panel.example/lab/' };
const req = (body) => new Request('https://auth.example/refresh', { method: 'POST', headers: { origin: 'https://panel.example' }, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
test('OAuth exchange and response-body stalls end with a safe gateway error', async () => {
  for (const headersArrive of [false, true]) {
    let signal, calls = 0;
    const h = handler(env, { requestTimeoutMs: 20, fetchImpl: async (_u, o) => { calls++; signal = o.signal; return headersArrive ? { json: () => new Promise(() => {}) } : new Promise(() => {}); } });
    const r = await h(req(JSON.stringify({ refresh_token: 'refresh' })));
    assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'github' });
    assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(r.headers.get('access-control-allow-origin'), 'https://panel.example');
  }
});
test('revocation does not hang or get repeated after a timeout', async () => {
  let calls = 0, signal;
  const h = handler(env, { requestTimeoutMs: 20, fetchImpl: async (_u, o) => { calls++; signal = o.signal; return new Promise(() => {}); } });
  const r = await h(new Request('https://auth.example/logout', { method: 'POST', headers: { origin: 'https://panel.example' }, body: JSON.stringify({ access_token: 'access' }) }));
  assert.equal(r.status, 502); assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('unknown-length oversized input is cancelled before it is fully read', async () => {
  let cancelled = false, reads = 0;
  const body = new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  const r = await handler(env)(req(body));
  assert.equal(r.status, 400); assert.ok(cancelled); assert.ok(reads < 10);
});
test('a client that never finishes its body gets a bounded error', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const r = await handler(env, { bodyTimeoutMs: 20 })(req(body));
  assert.equal(r.status, 400); assert.ok(cancelled);
});
test('tokens must be strings rather than values with a string representation', () => {
  for (const access_token of [1234, ['fake-token'], { toString: () => 'fake-token' }]) assert.equal(tokensOf({ access_token }), null);
  assert.equal(tokensOf({ access_token: 'real-token', refresh_token: ['fake-refresh'] }).refresh_token, null);
});
test('the Node server returns 413 for oversized chunked bodies and stays usable', async () => {
  const s = server(env); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    const r = await fetch(`${base}/refresh`, { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20 * 1024)); c.close(); } }), duplex: 'half' });
    assert.equal(r.status, 413); assert.deepEqual(await r.json(), { error: 'body' });
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
});

test('the Node adapter bounds a client that starts but never finishes a request', async () => {
  const s = server(env, { bodyTimeoutMs: 25 }); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  let request;
  try {
    const response = await new Promise((resolve, reject) => {
      request = http.request({ hostname: '127.0.0.1', port: s.address().port, path: '/refresh', method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, (r) => { let body = ''; r.on('data', (b) => { body += b; }); r.on('end', () => resolve({ code: r.statusCode, body })); });
      request.on('error', reject); request.flushHeaders();
    });
    assert.equal(response.code, 408); assert.deepEqual(JSON.parse(response.body), { error: 'request_timeout' });
  } finally { request?.destroy(); s.closeAllConnections(); await new Promise((r) => s.close(r)); }
});
