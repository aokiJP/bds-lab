// GitHub requests recover from transient read failures, bound the whole response, and never repeat writes.
import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
import { gh } from '../panel/lib/gh.mjs';

const hung = (seen) => async (_url, opts) => { seen.push(opts); return new Promise(() => {}); };
test('a stalled request is aborted and a write is sent only once', async () => {
  const seen = [], api = gh({ token: 'private-token', fetchImpl: hung(seen), timeoutMs: 20, retryDelayMs: 1 });
  await assert.rejects(api.call('POST', '/repos/o/lab/actions/runs/1/cancel'), (e) => e.status === 0 && /時間/.test(e.message) && !e.message.includes('private-token'));
  assert.equal(seen.length, 1); assert.equal(seen[0].signal.aborted, true);
});
test('the deadline includes reading the response body', async () => {
  let signal;
  const api = gh({ timeoutMs: 20, readRetries: 0, fetchImpl: async (_u, o) => { signal = o.signal; return { ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) }; } });
  await assert.rejects(api.me(), (e) => e.status === 0 && /時間/.test(e.message));
  assert.equal(signal.aborted, true);
});
test('a transient GET recovers once and reports the final outcome', async () => {
  let calls = 0; const events = [];
  const api = gh({ retryDelayMs: 1, onCall: (e) => events.push(e), fetchImpl: async () => ++calls === 1 ? new Response('upstream down', { status: 503 }) : Response.json({ login: 'aoki' }) });
  assert.deepEqual(await api.me(), { login: 'aoki' }); assert.equal(calls, 2); assert.equal(events.length, 1); assert.equal(events[0].status, 200);
});
test('writes, permission failures and rate limits are not automatically retried', async () => {
  for (const [method, status] of [['POST', 503], ['GET', 403], ['GET', 429], ['GET', 401], ['GET', 404]]) {
    let calls = 0;
    const api = gh({ retryDelayMs: 1, fetchImpl: async () => { calls++; return Response.json({ message: 'refused' }, { status }); } });
    await assert.rejects(api.call(method, '/repos/o/lab/actions/runs/1/cancel'), (e) => e.status === status);
    assert.equal(calls, 1);
  }
});
test('malformed success responses fail explicitly and network errors cannot expose credentials', async () => {
  const invalid = gh({ fetchImpl: async () => new Response('<html>proxy error</html>') });
  await assert.rejects(invalid.me(), (e) => e.status === 502);
  const offline = gh({ retryDelayMs: 1, fetchImpl: async () => { throw new Error('private-token'); } });
  await assert.rejects(offline.me(), (e) => e.status === 0 && !e.message.includes('private-token'));
});
