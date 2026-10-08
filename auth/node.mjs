// auth/node.mjs: the sign-in service on your own server — the same handler as the Worker, over node:http on PORT (HOST:
// 127.0.0.1 unless set; the Dockerfile sets 0.0.0.0). It speaks plain HTTP: put it behind TLS (a reverse proxy — Caddy,
// nginx, a load balancer) at the root of its own https origin, and set PUBLIC_URL to that origin (GitHub sends people back
// to <PUBLIC_URL>/callback; its cookie is Secure). It logs no request: a callback's address carries a code.
//   node auth/node.mjs        (env: GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET PANEL_ORIGINS STATE_SECRET PUBLIC_URL [PORT HOST])
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handler, config, HEADERS } from './handler.mjs';

const LIMIT = 16 * 1024;
/** env → a node:http server of the handler (not listening yet) */
export function server(env = process.env, opts = {}) {
  const h = handler(env, opts);
  // (the address people and GitHub see: PUBLIC_URL's origin; else what the request says it reached — fine on this machine)
  let pub = null; try { pub = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : null; } catch { /* not an address: the request's own */ }
  return http.createServer(async (req, res) => {
    try {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > LIMIT) { res.writeHead(413, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' }); res.end('{"error":"body"}'); req.destroy(); return; } chunks.push(c); }
      // (only the path and query of what was asked: an absolute address in the request line names no other origin)
      const rel = new URL(req.url ?? '/', 'http://localhost'), url = `${pub ?? `http://${req.headers.host ?? '127.0.0.1'}`}${rel.pathname}${rel.search}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== 'host') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const r = await h(new Request(url, { method: req.method, headers, body }));
      const out = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const sc = r.headers.getSetCookie?.() ?? []; if (sc.length) out['set-cookie'] = sc;
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(400, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"request"}');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env, c = config(env);
  if (c.missing.length) console.log(`bds-lab-auth: 設定が足りません: ${c.missing.join(' ')}（/health も知らせます）`);
  if (!env.PUBLIC_URL) console.log('bds-lab-auth: PUBLIC_URL がありません（TLS の前段の後ろでは、その https の origin を）');
  const s = server(env);
  s.listen(Number(env.PORT ?? 8787), env.HOST || '127.0.0.1', () => console.log(`bds-lab-auth: listening on ${s.address().port}`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => s.close(() => process.exit(0)));
}
