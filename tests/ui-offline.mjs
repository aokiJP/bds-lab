#!/usr/bin/env node
// The two front doors for people: `node lab.mjs ui` (the lab in a browser tab) and `node lab.mjs start` (the first time on a
// machine). ui: only this machine with the key in its address (another Host header, no key, a command the page may not run:
// refused), the state of every lab, one command run and its output streamed. start: not at a terminal it prints the steps,
// each a command the lab has.   node tests/ui-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const env = { ...process.env, LAB_UI_NO_OPEN: '1', LAB_DOTENV: 'off', LAB_NETENV: 'off', NO_COLOR: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };

// ---- ui
const ui = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'ui', '--no-open', '--port', String(40000 + (process.pid % 20000))], { cwd: TOP, env });
let printed = ''; ui.stdout.on('data', (d) => { printed += d; }); ui.stderr.on('data', (d) => { printed += d; });
for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+\/\?k=\w+/.test(printed); i++) await new Promise((r) => setTimeout(r, 100));
const url = /http:\/\/127\.0\.0\.1:(\d+)\/\?k=(\w+)/.exec(printed);
// (http.request: fetch would not let a test set its own Host header)
const req = (p, { method = 'GET', host, key, body } = {}) => new Promise((res) => {
  const r = http.request({ host: '127.0.0.1', port: Number(url[1]), path: p, method, headers: { ...(host ? { host } : {}), ...(key ? { 'x-lab-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, (s) => {
    let t = ''; s.on('data', (d) => { t += d; }); s.on('end', () => res({ status: s.statusCode, type: s.headers['content-type'] ?? '', text: t }));
  });
  r.on('error', (e) => res({ status: 0, text: e.message })); if (body) r.write(JSON.stringify(body)); r.end();
});
try {
  ok(!!url, 'ui: prints its address (this machine, a key in it)', printed);
  if (url) {
    const [, , key] = url;
    let r = await req(`/?k=${key}`);
    ok(r.status === 200 && /text\/html/.test(r.type) && /<title>bds-lab<\/title>/.test(r.text) && r.text.includes(key), 'ui: the page with the key', r.status);
    r = await req('/');
    ok(r.status === 403, 'ui: without the key the page is refused', r.status);
    r = await req(`/?k=${key}`, { host: 'evil.example:80' });
    ok(r.status === 403 && /this machine only/.test(r.text), 'ui: another Host header (a web page rebinding its name to 127.0.0.1) is refused', r.status + ' ' + r.text);
    r = await req('/api/state');
    ok(r.status === 403, 'ui: the API without the key is refused', r.status);
    r = await req('/api/state', { key });
    const st = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
    ok(r.status === 200 && st?.labs?.some((l) => l.lab === 'bds' && l.units.some((u) => u.name === 'lamp')), 'ui: /api/state lists the labs and their units', r.text.slice(0, 300));
    // (never a real run of anything long or outward here: share, up …; only refusals and one quick read-only check)
    const no = await Promise.all([['bash', '-c', 'echo x'], ['up'], ['bds', 'down'], [], ['make', 1]].map((args) => req('/api/run', { method: 'POST', key, body: { args } })));
    ok(no.every((x) => x.status === 403 || x.status === 400), 'ui: a command the page may not run, or arguments that are not strings, are refused', no.map((x) => `${x.status} ${x.text}`).join(' | '));
    r = await req('/api/run', { method: 'POST', key, body: { args: ['maint', '--only', 'locks'] } });
    ok(r.status === 200 && /node lab\.mjs maint --only locks/.test(r.text), 'ui: a listed command starts (the same `node lab.mjs …` a person would type)', r.status + ' ' + r.text);
    let done = null;
    for (let i = 0; i < 300 && !done; i++) { const s = JSON.parse((await req('/api/state', { key })).text); if (s.job?.done) done = s.job; else await new Promise((z) => setTimeout(z, 100)); }
    r = await req(`/api/log?k=${key}`);
    ok(done?.code === 0 && /text\/event-stream/.test(r.type) && /data: "OK maint/.test(r.text) && /event: done\ndata: 0/.test(r.text), 'ui: its output streams to the page, then done with the exit code', r.text.slice(-400));
  }
} finally { ui.kill(); }

// ---- start, not at a terminal (an AI, CI): the steps as commands
const s = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'start'], { cwd: TOP, env, encoding: 'utf8', input: '' });
const t = (s.stdout ?? '') + (s.stderr ?? '');
const cmds = [...t.matchAll(/node lab\.mjs ([a-z]+)/g)].map((m) => m[1]);
ok(s.status === 0 && /順番に:/.test(t) && cmds.includes('doctor') && cmds.includes('login') && cmds.includes('setup'), 'start (not at a terminal): the steps printed as commands, none asked', t);
// (a command of the lab: in lab.mjs's table, or one the labs' core takes)
const src = fs.readFileSync(path.join(TOP, 'lab.mjs'), 'utf8') + fs.readFileSync(path.join(TOP, 'common', 'core.mjs'), 'utf8');
const known = (c) => new RegExp(`\\b${c}: \\['|A\\[0\\] === '${c}'|cmd === '${c}'|'${c}'`).test(src);
ok(cmds.length && cmds.every(known), 'start: every command it prints is one the lab has', cmds.filter((c) => !known(c)).join(' ') || cmds.join(' '));
console.log(`${fails ? 'FAIL' : 'PASS'} ui-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
