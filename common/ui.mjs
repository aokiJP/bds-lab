// node lab.mjs ui [--port n] [--no-open]: the lab in a browser tab, for people who would rather click than type.
// Every addon / plugin / mod with its last test result, and buttons for what is done most: make (a request box), test, go,
// undo, maintain (newest release / preview of the next one), apidiff, login status, doctor. The output streams into the page.
// Only this machine can open it: 127.0.0.1, a random key in the address, the Host header checked (no other site can drive it).
// One command at a time; each is the same `node lab.mjs ...` a person would type (shown above its output).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = process.env.LAB_LABS_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
// what the page may run: the first word, and for make its request as one argument
const ALLOWED = new Set(['test', 'go', 'check', 'undo', 'checkpoint', 'maintain', 'apidiff', 'login', 'doctor', 'make', 'pack', 'selftest', 'maint', 'flaky', 'release', 'bisect', 'mutate', 'scan', 'optimize', 'i18n', 'auto', 'share']);

function state() {
  const labs = [];
  for (const [k, dir] of Object.entries(UNITS)) {
    let names = []; try { names = fs.readdirSync(path.join(TOP, k, dir)).filter((n) => !n.startsWith('.') && fs.statSync(path.join(TOP, k, dir, n)).isDirectory()).sort(); } catch { continue; }
    const rep0 = readJ(path.join(TOP, k, '.lab', 'report.json')), repOf = (n) => readJ(path.join(TOP, k, '.lab', 'reports', n + '.json')) ?? (rep0?.addon === n ? rep0 : null);
    labs.push({ lab: k, bds: read(path.join(TOP, k, '.lab', 'bds', 'VERSION')).trim() || null, units: names.map((n) => {
      const d = path.join(TOP, k, dir, n), f = readJ(path.join(d, 'features.json'));
      const title = /^# (.+)$/m.exec(read(path.join(d, 'TASK.md')))?.[1] ?? n;
      let cps = 0; try { cps = fs.readdirSync(path.join(TOP, k, '.lab', 'checkpoints', n)).length; } catch { /* none */ }
      const rep = repOf(n);
      return { name: n, title, last: rep ? { ok: rep.ok, pass: rep.pass, total: rep.total, at: rep.at, bds: rep.bds } : null, off: Object.keys(f?.off ?? {}), checkpoints: cps, tests: (read(path.join(d, 'tests.txt')).match(/^## /gm) ?? []).length };
    }) });
  }
  const cur = read(path.join(TOP, '.lab-kind')).trim() || 'bds';
  return { labs, current: cur, maintain: read(path.join(TOP, cur, '.lab', 'maintain', 'report.md')) || read(path.join(TOP, 'bds', '.lab', 'maintain', 'report.md')) };
}

export async function uiCmd(args, out = console.log) {
  const port0 = Number(args[args.indexOf('--port') + 1]) || Number(process.env.LAB_UI_PORT ?? 7780);
  const key = crypto.randomBytes(12).toString('hex');
  let job = null;   // { id, cmd, lines, done, code, subs }
  const html = PAGE.replace('__KEY__', key);
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x'), host = String(q.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(host)) { s.writeHead(403); return s.end('this machine only'); }
    if (u.pathname === '/' ) { if (u.searchParams.get('k') !== key) { s.writeHead(403); return s.end('open the address the terminal printed'); } s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(html); }
    if (q.headers['x-lab-key'] !== key && u.searchParams.get('k') !== key) { s.writeHead(403); return s.end('no key'); }
    const json = (o, c = 200) => { s.writeHead(c, { 'content-type': 'application/json' }); s.end(JSON.stringify(o)); };
    if (u.pathname === '/api/state') return json({ ...state(), job: job && { id: job.id, cmd: job.cmd, done: job.done, code: job.code } });
    if (u.pathname === '/api/run' && q.method === 'POST') {
      let b = ''; q.on('data', (d) => { b += d; if (b.length > 1e5) q.destroy(); });
      q.on('end', () => {
        let a; try { a = JSON.parse(b).args; } catch { return json({ error: 'bad json' }, 400); }
        if (!Array.isArray(a) || !a.length || !a.every((x) => typeof x === 'string') || !ALLOWED.has(a[0]) && !(Object.keys(UNITS).includes(a[0]) && ALLOWED.has(a[1]))) return json({ error: 'not allowed from the page' }, 400);
        if (job && !job.done) return json({ error: `busy: ${job.cmd}` }, 409);
        const id = Date.now().toString(36);
        job = { id, cmd: 'node lab.mjs ' + a.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' '), lines: [], done: false, code: null, subs: new Set() };
        const j = job, c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...a], { cwd: TOP, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let part = '';
        const push = (d) => { part += d; const ls = part.split('\n'); part = ls.pop(); for (const l of ls) { j.lines.push(l); for (const w of j.subs) w.write(`data: ${JSON.stringify(l)}\n\n`); } };
        c.stdout.on('data', push); c.stderr.on('data', push);
        c.on('close', (code) => { if (part) push('\n'); j.done = true; j.code = code; for (const w of j.subs) { w.write(`event: done\ndata: ${code}\n\n`); w.end(); } j.subs.clear(); });
        json({ id, cmd: job.cmd });
      });
      return;
    }
    if (u.pathname === '/api/log') {
      if (!job) return json({ error: 'no job' }, 404);
      s.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const l of job.lines) s.write(`data: ${JSON.stringify(l)}\n\n`);
      if (job.done) { s.write(`event: done\ndata: ${job.code}\n\n`); return s.end(); }
      job.subs.add(s); q.on('close', () => job?.subs.delete(s));
      return;
    }
    s.writeHead(404); s.end();
  });
  await new Promise((r, j) => { srv.once('error', j); srv.listen(port0, '127.0.0.1', r); }).catch(async () => { await new Promise((r) => srv.listen(0, '127.0.0.1', r)); });
  const url = `http://127.0.0.1:${srv.address().port}/?k=${key}`;
  out(`bds-lab ui: ${url}\n(このPCだけで開けます。止めるときは Ctrl+C)`);
  if (!args.includes('--no-open') && !process.env.LAB_UI_NO_OPEN) {
    const [c, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    try { spawn(c, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* print only */ }
  }
  await new Promise(() => {});
}

const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>bds-lab</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c2230;--mut:#667085;--line:#e3e6eb;--acc:#2f6fed;--ok:#1f9d55;--bad:#d64545;--warn:#c98a00;--log:#0f1320;--logfg:#d7dcea}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--card:#1a1e27;--fg:#e6e9ef;--mut:#98a2b3;--line:#2a303c;--acc:#6b9bff;--log:#0b0e14;--logfg:#cfd6e6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
header{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:1}
h1{font-size:16px;margin:0}main{display:grid;grid-template-columns:minmax(300px,1fr) minmax(320px,1.2fr);gap:16px;padding:16px 20px;max-width:1400px;margin:auto}
@media (max-width:860px){main{grid-template-columns:1fr;padding:12px 16px}}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}h2{font-size:13px;margin:0 0 10px;color:var(--mut);font-weight:600;letter-spacing:.02em}
textarea{width:100%;min-height:64px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;resize:vertical}
button{font:inherit;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:7px;padding:5px 10px;cursor:pointer}button:hover{border-color:var(--acc)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}button:disabled{opacity:.45;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.unit{border-top:1px solid var(--line);padding:9px 0;display:grid;grid-template-columns:1fr auto;gap:6px}
.unit:first-of-type{border-top:0}.name{font-weight:600}.meta{color:var(--mut);font-size:12px}.b{display:inline-block;border-radius:99px;padding:0 7px;font-size:12px;font-weight:600}
.b.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}.b.bad{background:color-mix(in srgb,var(--bad) 16%,transparent);color:var(--bad)}.b.off{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.b.none{color:var(--mut);border:1px solid var(--line)}
pre{margin:0;background:var(--log);color:var(--logfg);border-radius:8px;padding:10px;min-height:260px;max-height:62vh;overflow:auto;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.cmd{color:var(--mut);font:12px ui-monospace,monospace;margin:0 0 6px}.sp{flex:1}select{font:inherit;padding:4px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
@media (max-width:520px){.unit{grid-template-columns:1fr}.unit .row{justify-content:flex-start!important}header{padding:10px 16px}header button{padding:4px 8px}}
h1{white-space:nowrap}.mr{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:13px;margin-top:8px}.mr .how{color:var(--mut);font-size:12px;overflow-wrap:anywhere}
.l-E,.l-x{color:#ff8f8f}.l-ok{color:#7ee2a0}.l-W{color:#f3c969}
</style></head><body>
<header><h1>bds-lab</h1><span class="meta" id="bds"></span><span class="sp"></span><button onclick="run(['login','status'])">ログイン状況</button><button onclick="run(['maint','--fix'])">健康診断</button><button onclick="run(['doctor'])">環境チェック</button></header>
<main><div style="display:grid;gap:16px;align-content:start">
<section><h2>作る</h2><textarea id="req" placeholder="例: ルビーを追加して /lab:shop でダイヤと交換できるようにして"></textarea>
<div class="row" style="margin-top:8px"><label class="meta"><input type="checkbox" id="play"> AI プレイテストも</label><span class="sp"></span><button class="pri" onclick="make()">AI に作らせる</button></div></section>
<section><h2>自動操縦（AI が次にやることを自分で決める）</h2><div class="row"><button onclick="run(['auto'])">次にやること</button><button class="pri" onclick="run(['auto','run','--ticks','1'])">1 件進める</button><button onclick="run(['auto','log'])">台帳</button><button onclick="run(['share'])">bds-lab を配布用 zip に</button><span class="sp"></span><button onclick="run(['auto','stop'])">止める</button><button onclick="run(['auto','resume'])">再開</button></div></section>
<section><h2>最新版への追従</h2><div class="row"><button onclick="run(['maintain'])">最新版で点検して直す</button><button onclick="run(['maintain','--to','preview'])">次のアップデートを予告（戻す）</button><button onclick="run(['apidiff','--preview'])">API の差分</button></div><div class="meta" id="mhead" style="margin-top:8px"></div><div class="mr" id="mrep"></div></section>
<section><h2>アドオン</h2><div class="row" style="margin-bottom:6px"><select id="lab" onchange="draw()"></select></div><div id="units"></div></section>
</div>
<section><h2>出力</h2><div class="cmd" id="cmd">（ボタンを押すと、ここにコマンドとその出力が出ます）</div><pre id="log"></pre></section></main>
<script>
const K='__KEY__';let S=null,busy=false;
const api=(p,o={})=>fetch(p,{...o,headers:{'x-lab-key':K,'content-type':'application/json'}}).then(r=>r.json());
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function load(){S=await api('/api/state');const sel=document.getElementById('lab');if(!sel.options.length){for(const l of S.labs){const o=document.createElement('option');o.value=l.lab;o.textContent={bds:'BDS アドオン',end:'Endstone プラグイン',ll:'LeviLamina mod'}[l.lab]+' ('+l.units.length+')';sel.appendChild(o)}sel.value=S.labs.some(l=>l.lab===S.current)?S.current:(S.labs[0]||{}).lab}
draw();const md=S.maintain||'',rows=md.split('\\n').filter(l=>/^\\| (bds|end|ll) \\|/.test(l)).map(l=>l.split('|').slice(1,-1).map(x=>x.trim()));
const ic={OK:'✔',FIXED:'🔧',LIMITED:'🟡',RESTORED:'♻',BROKEN:'✘',WAIT:'⏳',LABERR:'✘'};
document.getElementById('mhead').textContent=md?'前回の点検: '+(md.split('\\n')[2]||'').replace(/T(\\d\\d:\\d\\d)[^ ]*/,' $1'):'まだ点検していません';
document.getElementById('mrep').innerHTML=rows.map(r=>'<span>'+(ic[r[2]]||'')+' '+esc(r[2])+'</span><span><b>'+esc(r[1])+'</b> <span class="how">'+esc(r[3]||'')+'</span></span>').join('');busy=S.job&&!S.job.done;setBusy(busy)}
function draw(){const k=document.getElementById('lab').value,l=S.labs.find(x=>x.lab===k);document.getElementById('bds').textContent=l&&l.bds?'BDS '+l.bds:'';
document.getElementById('units').innerHTML=(l?l.units:[]).map(u=>{const st=u.last?(u.last.ok?'<span class="b ok">PASS '+u.last.pass+'/'+u.last.total+'</span>':'<span class="b bad">FAIL '+u.last.pass+'/'+u.last.total+'</span>'):'<span class="b none">未テスト</span>';
const off=u.off.length?' <span class="b off">制限中: '+esc(u.off.join(', '))+'</span>':'';
return '<div class="unit"><div><div class="name">'+esc(u.title)+'</div><div class="meta">'+esc(u.name)+' · テスト '+u.tests+' 件'+(u.checkpoints?' · 戻せる '+u.checkpoints+' 回':'')+'</div><div style="margin-top:3px">'+st+off+'</div></div>'
+'<div class="row" style="justify-content:flex-end"><button data-a="test">テスト</button><button data-a="go">仕上げ</button><button data-a="maintain">点検</button><button data-a="release">配布</button><button data-a="scan">安全確認</button><button data-a="mutate">テスト診断</button>'+(u.checkpoints?'<button data-a="bisect">原因さがし</button><button data-a="undo">戻す</button>':'')+'</div></div>'}).join('')||'<div class="meta">まだありません。上の「作る」から。</div>';
document.querySelectorAll('#units .unit').forEach((el,i)=>el.querySelectorAll('button').forEach(b=>b.onclick=()=>{const u=l.units[i].name,a=b.dataset.a;run(a==='maintain'?[k,'maintain','--to','current','-a',u]:[k,a,'-a',u])}));setBusy(busy)}
function setBusy(v){busy=v;document.querySelectorAll('button').forEach(b=>b.disabled=v)}
function make(){const r=document.getElementById('req').value.trim();if(!r)return;const k=document.getElementById('lab').value;run([k,'make',r,...(document.getElementById('play').checked?['--playtest']:[])])}
async function run(args){if(busy)return;const r=await api('/api/run',{method:'POST',body:JSON.stringify({args})});if(r.error){alert(r.error);return}
setBusy(true);document.getElementById('cmd').textContent='$ '+r.cmd;const log=document.getElementById('log');log.innerHTML='';
const es=new EventSource('/api/log?k='+K);es.onmessage=e=>{const t=JSON.parse(e.data),c=/^(E |ERR|✘|FAIL|BROKEN)/.test(t)?'l-E':/^(OK|PASS|DONE|MADE|✔|🔧)/.test(t)?'l-ok':/^W /.test(t)?'l-W':'';log.insertAdjacentHTML('beforeend','<div class="'+c+'">'+esc(t)+'</div>');log.scrollTop=log.scrollHeight};
es.addEventListener('done',e=>{es.close();log.insertAdjacentHTML('beforeend','<div class="'+(e.data==='0'?'l-ok':'l-E')+'">— 終了 (exit '+e.data+')</div>');load()})}
load();setInterval(()=>{if(!busy)load()},15000);
</script></body></html>`;
