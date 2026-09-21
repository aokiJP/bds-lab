import fs from 'node:fs';
import path from 'node:path';
import * as childProcess from 'node:child_process';

const ANSI = /\u001b\[[0-9;]*m/g;
const ACTION = /\[Scripting\]\s*lab:action\s+(\{.*\})\s*$/;
const STACK = /at\s+(?:.*?\s+\()?(?:file:\/\/)?([^\s():]+\.js):(\d+):(\d+)\)?/g;

export class Bridge {
  constructor({ ROOT, addonDir, send, say = () => {}, allowShell = false }) {
    this.ROOT = ROOT;
    this.addonDir = addonDir;
    this.send = send;
    this.say = say;
    this.allowShell = allowShell;
    this.notes = [];
    this.metrics = {};
    this.failures = [];
    this.maps = new Map();
  }

  reset() { this.notes = []; this.metrics = {}; this.failures = []; }

  clean(line) { return line.replace(ANSI, ''); }

  resolve(line) {
    return line.replace(STACK, (whole, file, ln, col) => {
      const at = this.lookup(file, Number(ln), Number(col));
      return at ? `at ${at}` : whole;
    });
  }

  lookup(file, line, col) {
    const rel = file.replace(/^.*behavior_packs\/[^/]+\//, '');
    const mapFile = path.join(this.addonDir, `${rel}.map`);
    if (!this.maps.has(mapFile)) {
      let map = null;
      try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { map = null; }
      this.maps.set(mapFile, map ? decode(map) : null);
    }
    const decoded = this.maps.get(mapFile);
    if (!decoded) return null;
    const hit = nearest(decoded, line, col);
    return hit ? `${hit.source}:${hit.line}:${hit.column}` : null;
  }

  handle(line) {
    const m = ACTION.exec(line);
    if (!m) return false;
    let req;
    try { req = JSON.parse(m[1]); } catch { return false; }
    const reply = (ok, payload) => { if (req.id) this.send(`scriptevent lab:reply ${JSON.stringify({ id: req.id, ok, payload })}`); };

    switch (req.op) {
      case 'note': this.notes.push(String(req.text ?? '')); reply(true); return true;
      case 'metric': this.metrics[req.key] = req.value; reply(true); return true;
      case 'fail': this.failures.push(String(req.reason ?? '')); reply(true); return true;
      case 'command': this.send(String(req.command ?? '')); reply(true); return true;
      case 'reload': this.send('reload'); reply(true); return true;
      case 'save': {
        const dir = path.join(this.ROOT, '.bds-lab', 'from-addon');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, String(req.name ?? 'data.txt').replace(/[^\w.-]/g, '_'));
        fs.appendFileSync(file, `${req.text ?? ''}\n`);
        reply(true, { file: path.relative(this.ROOT, file) });
        return true;
      }
      case 'shell': {
        if (!this.allowShell) { reply(false, '外のコマンドは止めてあります（--allow-shell で許可）'); return true; }
        const { spawnSync } = childProcess;
        const r = spawnSync(req.command, req.args ?? [], { encoding: 'utf8', timeout: 60000 });
        reply(r.status === 0, { status: r.status, out: (r.stdout ?? '').slice(0, 2000) });
        return true;
      }
      default: reply(false, `知らない op: ${req.op}`); return true;
    }
  }
}

function decode(map) {
  const out = [];
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let line = 1;
  let src = 0;
  let srcLine = 1;
  let srcCol = 0;
  for (const group of (map.mappings ?? '').split(';')) {
    let col = 0;
    for (const seg of group.split(',')) {
      if (!seg) continue;
      const v = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        if (d < 0) break;
        value += (d & 31) << shift;
        if (d & 32) { shift += 5; continue; }
        const neg = value & 1;
        let n = value >> 1;
        if (neg) n = -n;
        v.push(n);
        value = 0;
        shift = 0;
      }
      col += v[0] ?? 0;
      if (v.length >= 4) {
        src += v[1];
        srcLine += v[2];
        srcCol += v[3];
        out.push({ line, column: col, source: (map.sources ?? [])[src] ?? '?', srcLine, srcCol });
      }
    }
    line++;
  }
  return out.map((e) => ({ line: e.line, column: e.column, source: e.source, srcLine: e.srcLine, srcCol: e.srcCol }));
}

function nearest(entries, line, col) {
  let best = null;
  for (const e of entries) {
    if (e.line !== line) continue;
    if (e.column > col) continue;
    if (!best || e.column > best.column) best = e;
  }
  return best ? { source: best.source, line: best.srcLine, column: best.srcCol } : null;
}
