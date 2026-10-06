// ブラウザ向けの JS ゲームを、そのまま（手を入れずに）1 tick ずつ動かすワールド。
//
// ゲームの側に要るものは何もありません。いつもどおり canvas に描き、keydown/keyup を聞き、
// requestAnimationFrame で回っていれば動きます。サンドボックスは次を差し替えます:
//
//   時計      performance.now / Date.now / setTimeout / setInterval / requestAnimationFrame を仮想の時計に。
//             1 tick = 1 フレーム（既定 1000/60 ms）
//   乱数      Math.random を種つき（mulberry32）に。同じ種・同じテープなら必ず同じ結果
//   入力      テープの 1 tick = 押しているキーの集合 { "ArrowRight": true, "Space": true }。
//             押した・離した tick に keydown / keyup を送る
//   画面      canvas の 2D 描画は受け流す（呼ばれた回数だけ数える）。DOM は最小限
//   例外      ゲームの中の例外（フレームの中・タイマー・イベント）を全部拾って、どの tick か残す
//
// 再現していない DOM / Web API に触れたら issues に積みます（→ 結果は inconclusive）。
// 実ブラウザとの差は tools/play/browser.mjs で同じテープを Chromium に流して確かめます（docs/play.md）。
//
// 状態の保存と復元: ゲームが window.__sandbox = { save(), load(s) } を持っていればそれを使う。
// 無ければ「最初から同じ入力を流し直す」で戻す（決定論なので正しい。遅いだけ）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function mulberry32(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.state = () => a;
  rnd.setState = (v) => { a = v >>> 0; };
  return rnd;
}

/** HTML から、順番どおりの <script> を取り出す（src と中身） */
export function scriptsFromHtml(html, baseDir) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (type === 'module') { out.push({ module: true, file: src ?? '(inline module)' }); continue; }
    if (type && !/javascript|ecmascript/i.test(type)) continue;
    if (src) {
      if (/^(https?:)?\/\//.test(src)) { out.push({ remote: true, file: src }); continue; }
      const file = path.join(baseDir, src);
      out.push({ file: src, code: fs.readFileSync(file, 'utf8') });
    } else out.push({ file: '(inline)', code: m[2] });
  }
  return out;
}

const KEY_CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32, Enter: 13, Escape: 27, ShiftLeft: 16 };
const keyOf = (code) => (code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);

/**
 * @param {object} spec
 *   entry     ゲームの JS（1 本か配列）。または html: 'index.html'
 *   baseDir   相対パスの基準
 *   observe   観測の式（ゲームの文脈で評価。例 "({ x: player.x, won: state.won })"）。
 *             無ければ window.__sandbox.observe()。どちらも無ければ { tick } だけ
 *   keys      探索で使うキー（既定 ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space']）
 *   seed      Math.random の種（既定 1）
 *   frameMs   1 tick の長さ（既定 1000/60）
 *   width, height  canvas の大きさ（既定 800×600）
 */
export function createJsGameWorld(spec) {
  const baseDir = spec.baseDir ?? process.cwd();
  let sources;
  if (spec.html) sources = scriptsFromHtml(fs.readFileSync(path.join(baseDir, spec.html), 'utf8'), path.dirname(path.join(baseDir, spec.html)));
  else sources = [].concat(spec.entry ?? spec.files ?? []).map((f) => ({ file: f, code: fs.readFileSync(path.join(baseDir, f), 'utf8') }));
  if (!sources.length) throw new Error('js ワールドには entry（JS）か html が要ります');
  const htmlTags = new Map(); // id → タグ名（HTML に書いてあるもの）
  if (spec.html) {
    const html = fs.readFileSync(path.join(baseDir, spec.html), 'utf8');
    for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bid\s*=\s*["']([^"']+)["']/g)) htmlTags.set(m[2], m[1].toLowerCase());
  }
  const frameMs = spec.frameMs ?? 1000 / 60;
  const keys = spec.keys ?? ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

  let rt; // いまの実行環境
  const observeScript = spec.observe ? new vm.Script(`(${spec.observe})`, { filename: 'observe' }) : null;
  const errors = [];
  const issues = new Map();
  let history = []; // reset からの入力（スナップショットが無いゲームを戻すのに使う）

  function boot() {
    const clock = { now: 0 };
    const timers = [];
    let timerId = 1;
    let raf = [];
    let rafId = 1;
    const listeners = { window: {}, document: {}, canvas: {} };
    const logs = [];
    const draws = { calls: 0 };
    const store = new Map();
    const signals = [];
    const signal = (kind, text) => {
      const t = String(text ?? '').trim();
      if (!t) return;
      const last = signals[signals.length - 1];
      if (last && last.kind === kind && last.text === t) { last.until = rt?.tick ?? 0; return; } // 毎フレーム同じ文字を描くのは 1 つに数える
      signals.push({ tick: rt?.tick ?? 0, kind, text: t.slice(0, 200) });
    };
    const report = (where, e) => {
      errors.push({ tick: rt?.tick ?? 0, where, name: e?.name ?? 'Error', message: String(e?.message ?? e), stack: String(e?.stack ?? '').split('\n').slice(0, 6).join('\n') });
    };
    const safe = (where, fn, ...a) => { try { return fn(...a); } catch (e) { report(where, e); return undefined; } };
    const missing = (what) => { issues.set(what, `${what} は再現していません（実ブラウザと違う可能性）`); };

    const on = (bucket) => (type, fn) => { (listeners[bucket][type] ??= []).push(fn); };
    const off = (bucket) => (type, fn) => { listeners[bucket][type] = (listeners[bucket][type] ?? []).filter((f) => f !== fn); };

    const ctx2d = new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
        if (typeof k === 'symbol') return undefined;
        if (k === 'fillText' || k === 'strokeText') return (text) => { draws.calls++; signal('canvas', text); };
        return (..._a) => { draws.calls++; };
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    const makeCanvas = () => ({
      width: spec.width ?? 800, height: spec.height ?? 600, style: {},
      getContext: (kind) => (kind === '2d' ? ctx2d : (missing(`canvas.getContext('${kind}')`), null)),
      addEventListener: on('canvas'), removeEventListener: off('canvas'),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: spec.width ?? 800, height: spec.height ?? 600 }),
      focus() {}, setAttribute() {}, appendChild() {},
    });
    const canvas = makeCanvas();
    const byId = new Map();
    let canvasTaken = false;
    const takeCanvas = () => { canvasTaken = true; return canvas; };
    const firstCanvasTaken = () => canvasTaken;
    // 画面に出した文字は「合図」として残す（目標を自動で見つけるのに使う。discover.js）
    const element = () => {
      const el = { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } };
      for (const prop of ['textContent', 'innerText', 'innerHTML', 'value']) {
        let v = '';
        Object.defineProperty(el, prop, { get: () => v, set: (x) => { v = String(x); signal('dom', v); }, enumerable: true });
      }
      return el;
    };
    const docRaw = {
      body: element(),
      // HTML に書いてある要素は、その id と種類のとおりに返す（同じ id なら同じもの）
      getElementById: (id) => {
        if (!byId.has(id)) {
          const tag = htmlTags.get(id) ?? (/canvas/i.test(id) ? 'canvas' : null);
          byId.set(id, tag === 'canvas' ? (byId.size === 0 || !firstCanvasTaken() ? takeCanvas() : makeCanvas()) : element());
        }
        return byId.get(id);
      },
      querySelector: (q) => (/canvas/i.test(q) ? takeCanvas() : q.startsWith('#') ? docRaw.getElementById(q.slice(1)) : element()),
      createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : element()),
      addEventListener: on('document'), removeEventListener: off('document'),
      readyState: 'complete',
      hidden: false,
    };
    const document = new Proxy(docRaw, {
      get(t, k) { if (!(k in t) && typeof k === 'string' && !/^on/.test(k)) missing(`document.${k}`); return t[k]; },
    });

    const Math2 = Object.create(Math);
    Math2.random = mulberry32(spec.seed ?? 1);
    const DateV = class extends Date {
      constructor(...a) { super(...(a.length ? a : [Date.UTC(2020, 0, 1) + clock.now])); }
      static now() { return Date.UTC(2020, 0, 1) + Math.floor(clock.now); }
    };
    const g = {
      console: {
        log: (...a) => { logs.push({ tick: rt?.tick ?? 0, level: 'log', text: a.map(String).join(' ') }); signal('console', a.map(String).join(' ')); },
        info: (...a) => logs.push({ tick: rt?.tick ?? 0, level: 'info', text: a.map(String).join(' ') }),
        warn: (...a) => logs.push({ tick: rt?.tick ?? 0, level: 'warn', text: a.map(String).join(' ') }),
        error: (...a) => logs.push({ tick: rt?.tick ?? 0, level: 'error', text: a.map(String).join(' ') }),
        debug() {},
      },
      document,
      Math: Math2,
      Date: DateV,
      performance: { now: () => clock.now },
      requestAnimationFrame: (fn) => { raf.push({ id: rafId, fn }); return rafId++; },
      cancelAnimationFrame: (id) => { raf = raf.filter((r) => r.id !== id); },
      setTimeout: (fn, ms = 0, ...a) => { timers.push({ id: timerId, at: clock.now + Math.max(0, ms), fn, a }); return timerId++; },
      setInterval: (fn, ms = 0, ...a) => { timers.push({ id: timerId, at: clock.now + Math.max(1, ms), every: Math.max(1, ms), fn, a }); return timerId++; },
      clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
      clearInterval: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
      addEventListener: on('window'), removeEventListener: off('window'),
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
      innerWidth: spec.width ?? 800, innerHeight: spec.height ?? 600, devicePixelRatio: 1,
      navigator: { userAgent: 'sandbox-be', getGamepads: () => [] },
      location: { href: 'about:sandbox', search: '', hash: '' },
      Image: class { constructor() { this.complete = true; this.width = 0; this.height = 0; } set src(v) { this._src = v; if (this.onload) g.setTimeout(() => this.onload(), 0); } get src() { return this._src; } },
      Audio: class { play() { return Promise.resolve(); } pause() {} },
      AudioContext: undefined,
      fetch: () => { missing('fetch'); return Promise.reject(new Error('fetch はサンドボックスで使えません')); },
      alert: (m) => signal('alert', m),
      KeyboardEvent: class { constructor(type, init = {}) { Object.assign(this, init, { type }); } preventDefault() {} stopPropagation() {} },
    };
    g.window = g; g.self = g; g.globalThis = g;
    const context = vm.createContext(g, { name: 'sandbox-js-game', codeGeneration: { strings: true, wasm: false } });
    rt = { context, g, docRaw, signals, clock, timers, raf: () => raf, setRaf: (x) => { raf = x; }, listeners, logs, draws, safe, report, held: new Set(), tick: 0, canvas };

    for (const s of sources) {
      if (s.module) { issues.set(`module:${s.file}`, `<script type="module">（${s.file}）はまだ読めません`); continue; }
      if (s.remote) { issues.set(`remote:${s.file}`, `外部の script（${s.file}）は読み込みません`); continue; }
      try { new vm.Script(s.code, { filename: s.file }).runInContext(context, { timeout: 5000 }); } catch (e) { rt.report(`load ${s.file}`, e); }
    }
    // 読み込み完了のイベント
    for (const type of ['DOMContentLoaded', 'load']) {
      for (const fn of listeners.document[type] ?? []) safe(type, fn, { type });
      for (const fn of listeners.window[type] ?? []) safe(type, fn, { type });
    }
    if (typeof g.onload === 'function') safe('onload', g.onload, { type: 'load' });
  }

  function dispatchKey(type, code) {
    const ev = new rt.g.KeyboardEvent(type, { key: keyOf(code), code, keyCode: KEY_CODES[code] ?? (code.startsWith('Key') ? code.charCodeAt(3) : 0), repeat: false });
    ev.which = ev.keyCode;
    // 実ブラウザと同じ順: 何もフォーカスしていなければ body → document → window へ泡立つ
    if (rt.listeners.canvas[type]?.length) issues.set(`canvas.${type}`, `canvas の ${type} は、フォーカスが無いと実ブラウザでは届きません（サンドボックスも送りません）`);
    for (const fn of rt.listeners.document[type] ?? []) rt.safe(`${type} ${code}`, fn, ev);
    if (typeof rt.docRaw[`on${type}`] === 'function') rt.safe(`${type} ${code}`, rt.docRaw[`on${type}`], ev);
    for (const fn of rt.listeners.window[type] ?? []) rt.safe(`${type} ${code}`, fn, ev);
    if (typeof rt.g[`on${type}`] === 'function') rt.safe(`${type} ${code}`, rt.g[`on${type}`], ev);
  }

  function stepRaw(input = {}) {
    const want = new Set(Object.entries(input ?? {}).filter(([, v]) => v === true).map(([k]) => k));
    for (const k of rt.held) if (!want.has(k)) dispatchKey('keyup', k);
    for (const k of want) if (!rt.held.has(k)) dispatchKey('keydown', k);
    rt.held = want;
    const end = rt.clock.now + frameMs;
    // タイマー（時刻の順に）
    for (let guard = 0; guard < 10000; guard++) {
      rt.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = rt.timers[0];
      if (!t || t.at > end) break;
      rt.clock.now = Math.max(rt.clock.now, t.at);
      if (t.every) t.at += t.every; else rt.timers.shift();
      rt.safe('timer', t.fn, ...t.a);
    }
    rt.clock.now = end;
    const frame = rt.raf();
    rt.setRaf([]);
    for (const r of frame) rt.safe('requestAnimationFrame', r.fn, rt.clock.now);
    rt.tick++;
  }

  const hook = () => rt.g.__sandbox;
  function reset() { errors.length = 0; issues.clear(); history = []; boot(); }
  function step(input) { history.push(input ?? {}); stepRaw(input); }

  function observe() {
    let o;
    if (spec.observe) {
      try { o = observeScript.runInContext(rt.context); } catch (e) { o = { observeError: String(e.message) }; }
    } else if (typeof hook()?.observe === 'function') {
      o = rt.safe('__sandbox.observe', hook().observe);
    } else o = {};
    let plain;
    try { plain = JSON.parse(JSON.stringify(o ?? {})); } catch { plain = { observeError: '観測が JSON にできません' }; }
    return { tick: rt.tick, ...plain, errors: errors.length };
  }

  // spec.state: ゲームの状態を持つ大域の名前（例 ["player", "state"]）。書いてあれば、その中身を
  // 写して戻す（同じ文脈の中なので、タイマーや requestAnimationFrame の関数もそのまま戻せる）。
  // 書き漏らした状態があると戻し方が狂うので、checkSnapshot（run.js）で確かめてから使う。
  const declared = spec.state ?? null;
  const stateScripts = (declared ?? []).map((n) => new vm.Script(n));
  const assignDeep = (dst, src) => {
    for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && dst[k] && typeof dst[k] === 'object' && Array.isArray(v) === Array.isArray(dst[k])) {
        if (Array.isArray(v)) dst[k].length = v.length;
        assignDeep(dst[k], v);
      } else dst[k] = v && typeof v === 'object' ? structuredClone(v) : v;
    }
  };
  function snapshot() {
    if (declared) {
      const vals = stateScripts.map((sc) => structuredClone(sc.runInContext(rt.context)));
      return { kind: 'declared', vals, tick: rt.tick, clock: rt.clock.now, held: [...rt.held], timers: rt.timers.map((t) => ({ ...t })), raf: rt.raf().slice(), history: history.slice(), errors: errors.length, signals: rt.signals.length, rng: rt.g.Math.random.state?.() };
    }
    if (typeof hook()?.save === 'function' && typeof hook()?.load === 'function') {
      return { kind: 'hook', tick: rt.tick, data: JSON.stringify(hook().save()), held: [...rt.held], clock: rt.clock.now, history: history.slice(), errors: errors.length };
    }
    return { kind: 'replay', history: history.slice(), errors: errors.length };
  }
  // errors は「いまの道筋で起きた例外」。戻したら、その道筋で起きたぶんだけになる
  function restore(snap) {
    if (snap.kind === 'declared') {
      declared.forEach((name, i) => {
        const cur = stateScripts[i].runInContext(rt.context);
        if (cur && typeof cur === 'object') assignDeep(cur, structuredClone(snap.vals[i]));
        else { rt.g.__sbxRestore = structuredClone(snap.vals[i]); vm.runInContext(`${name} = globalThis.__sbxRestore`, rt.context); delete rt.g.__sbxRestore; }
      });
      rt.tick = snap.tick; rt.clock.now = snap.clock; rt.held = new Set(snap.held);
      rt.timers.length = 0; rt.timers.push(...snap.timers.map((t) => ({ ...t })));
      rt.setRaf(snap.raf.slice());
      if (snap.rng !== undefined) rt.g.Math.random.setState(snap.rng);
      history = snap.history.slice();
      errors.length = Math.min(errors.length, snap.errors);
      rt.signals.length = Math.min(rt.signals.length, snap.signals);
      return;
    }
    if (snap.kind === 'hook') {
      hook().load(JSON.parse(snap.data));
      rt.tick = snap.tick; rt.clock.now = snap.clock; rt.held = new Set(snap.held); history = snap.history.slice();
      errors.length = Math.min(errors.length, snap.errors);
      return;
    }
    // 途中までが同じなら続きだけ流す。違えば最初から流し直す（例外も流し直しで同じものが出る）
    const same = history.length <= snap.history.length && history.every((h, i) => JSON.stringify(h) === JSON.stringify(snap.history[i]));
    if (!same) { errors.length = 0; history = []; boot(); }
    for (let i = history.length; i < snap.history.length; i++) step(snap.history[i]);
  }

  reset();
  const combos = spec.actions ?? null;
  return {
    kind: 'js',
    reset,
    step,
    observe,
    snapshot,
    restore,
    fingerprint: () => (typeof hook()?.fingerprint === 'function' ? String(hook().fingerprint()) : JSON.stringify({ ...observe(), tick: undefined, errors: undefined })),
    issues: () => [...issues.entries()].map(([id, why]) => ({ id, why })),
    errors: () => errors.slice(),
    logs: () => rt.logs.slice(),
    /** 画面・DOM・console・alert に出した文字（{ tick, kind, text }）。いまの道筋のぶんだけ */
    signals: () => rt.signals.slice(),
    /** 探索の候補: 1 つのキー（とその組み合わせ）を hold tick 押す */
    actions: () => combos ?? [
      { input: {}, hold: 4 },
      ...keys.flatMap((k) => [1, 4, 12].map((hold) => ({ input: { [k]: true }, hold }))),
      ...keys.filter((k) => k !== 'Space').flatMap((k) => (keys.includes('Space') ? [4, 12].map((hold) => ({ input: { [k]: true, Space: true }, hold })) : [])),
    ],
    get tick() { return rt.tick; },
  };
}
