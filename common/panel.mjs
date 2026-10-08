// node lab.mjs panel [--port 8787]: the management panel (panel/) on this machine — the same page GitHub Pages serves
// (.github/workflows/pages.yml), for use before Pages is on or without it. Only on 127.0.0.1; every answer carries the
// page's own CSP (it may talk to api.github.com alone). The panel works with the person's own GitHub token: README「管理パネル」.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = path.join(TOP, 'panel');
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8' };

/** the request handler for a folder: its files only (nothing above it, no dot-files), GET / HEAD only */
export function panelHandler(root = ROOT) {
  return (req, res) => {
    const head = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, head); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, head); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const f = path.resolve(root, `.${rel}`);
    if ((f !== root && !f.startsWith(root + path.sep)) || rel.split('/').some((p) => p.startsWith('.')) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, { ...head, 'content-type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { ...head, 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  };
}
export async function panelCmd(args = [], out = console.log) {
  const i = args.indexOf('--port'), port = i >= 0 ? Number(args[i + 1]) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { out('ERR --port <1〜65535>'); return false; }
  const server = http.createServer(panelHandler());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch((e) => { out(`ERR ${port} 番で開けません: ${e.message}（--port <別の番号>）`); return null; });
  if (!server.listening) return false;
  out(`OK 管理パネル: http://127.0.0.1:${server.address().port}/  （このパソコンだけ。止めるのは Ctrl+C）`);
  out('   入るには GitHub のトークン（Fine-grained: ラボと自分のホストだけ）。スマホからは GitHub Pages の方で（README「管理パネル」）');
  await new Promise(() => {});
}
