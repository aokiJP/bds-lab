// The machine the emulator runs on: load, memory, swap, free disk and the biggest processes, sampled while a run goes.
// A run stopped from outside (on GitHub the runner was stopped mid-step: exit 143, every later step skipped, no artifact)
// leaves only what was printed before it: so the samples go to host.txt in the run folder, and at each stage into the
// log and a GitHub notice (readable through the API), with the worst values in the report.
import fs from 'node:fs';
import os from 'node:os';

const GB = 2 ** 30;
/** one sample: {at, cpus, load1, memTotal, memAvail, memExact, swapUsed|null, diskFree|null, top: [{name, rss}]} (bytes).
 *  memExact: memAvail is Linux's MemAvailable (elsewhere os.freemem(), which on macOS leaves out the cache: too low to warn on) */
export function hostStats({ dir = process.cwd(), top = 3, proc = '/proc' } = {}) {
  const s = { at: Date.now(), cpus: os.cpus().length || 1, load1: os.loadavg()[0], memTotal: os.totalmem(), memAvail: os.freemem(), memExact: false, swapUsed: null, diskFree: null, top: [] };
  try {
    const m = fs.readFileSync(`${proc}/meminfo`, 'utf8'), kb = (k) => { const v = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(m)?.[1]; return v === undefined ? null : Number(v) * 1024; };
    if (kb('MemAvailable') !== null) { s.memAvail = kb('MemAvailable'); s.memExact = true; }
    if (kb('SwapTotal') !== null && kb('SwapFree') !== null) s.swapUsed = kb('SwapTotal') - kb('SwapFree');
  } catch { /* not Linux */ }
  try { const f = fs.statfsSync(dir); s.diskFree = f.bavail * f.bsize; } catch { /* no statfs */ }
  if (top > 0 && fs.existsSync(`${proc}/self/status`)) {
    const all = [];
    for (const p of fs.readdirSync(proc)) {
      if (!/^\d+$/.test(p)) continue;
      try { const t = fs.readFileSync(`${proc}/${p}/status`, 'utf8'), rss = /^VmRSS:\s+(\d+)/m.exec(t)?.[1]; if (rss) all.push({ name: /^Name:\s+(.*)$/m.exec(t)?.[1]?.trim() ?? p, rss: Number(rss) * 1024 }); } catch { /* gone */ }
    }
    s.top = all.sort((a, b) => b.rss - a.rss).slice(0, top);
  }
  return s;
}
const gb = (b) => (b / GB).toFixed(1);
/** "load 7.9/4 · mem 2.1/15.6 GB 空き · swap 1.2 GB · disk 12.0 GB 空き · qemu-system-x86 5.1, java 0.8 GB" (pure) */
export function fmtStats(s) {
  return [`load ${s.load1.toFixed(1)}/${s.cpus}`, `mem ${gb(s.memAvail)}/${gb(s.memTotal)} GB 空き`, ...(s.swapUsed !== null ? [`swap ${gb(s.swapUsed)} GB`] : []),
    ...(s.diskFree !== null ? [`disk ${gb(s.diskFree)} GB 空き`] : []), ...(s.top.length ? [`${s.top.map((p) => `${p.name} ${gb(p.rss)}`).join(', ')} GB`] : [])].join(' · ');
}
/** what the worst moment says, for the report (pure): [] when nothing was short */
export function hostNotes(w) {
  const n = [];
  if (w.memExact && w.memAvail < 1.5 * GB) n.push(`パソコン（CI のランナー）のメモリの空きが ${gb(w.memAvail)} GB まで減りました: 足りなくなると、実行ごと止められます（APP_RAM を減らす、APP_SCREEN で画面を小さく）`);
  if (w.diskFree !== null && w.diskFree < 3 * GB) n.push(`ディスクの空きが ${gb(w.diskFree)} GB まで減りました（APP_DISK を減らす、使い終えたイメージを消す）`);
  if (w.load1 > 2 * w.cpus) n.push(`パソコンの負荷が ${w.load1.toFixed(1)}（CPU ${w.cpus} 個）まで上がりました: 端末の描画と翻訳で手いっぱいです`);
  return n;
}
/** samples every everyMs into file (one line each); stop() takes a last one. worst: the lowest memory/disk, highest load */
export function startMonitor(file, { everyMs = 15_000, dir, sample = () => hostStats({ dir }) } = {}) {
  const worst = { load1: 0, cpus: os.cpus().length || 1, memAvail: Infinity, memExact: false, memTotal: os.totalmem(), diskFree: null, swapUsed: 0 };
  let last = null;
  const tick = () => {
    try {
      const s = sample(); last = s;
      worst.load1 = Math.max(worst.load1, s.load1); worst.cpus = s.cpus; worst.memAvail = Math.min(worst.memAvail, s.memAvail); worst.memExact = Boolean(s.memExact); worst.memTotal = s.memTotal;
      if (s.diskFree !== null) worst.diskFree = Math.min(worst.diskFree ?? Infinity, s.diskFree);
      if (s.swapUsed !== null) worst.swapUsed = Math.max(worst.swapUsed, s.swapUsed);
      fs.appendFileSync(file, `${new Date(s.at).toISOString().slice(11, 19)} ${fmtStats(s)}\n`);
    } catch { /* a sample never stops a run */ }
    return last;
  };
  tick();
  const h = setInterval(tick, everyMs); h.unref?.();
  return { worst, last: () => last, now: tick, stop: () => { clearInterval(h); tick(); } };
}
