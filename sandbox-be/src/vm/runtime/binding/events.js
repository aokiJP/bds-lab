// イベントの配送とスケジューラ

// ---- イベント ---------------------------------------------------------------

const handlers = new $Map(); // signal 名 → [{ fn, opts }]
const afterQueue = [];

const SIGNAL = {
  subscribe(h, fn, opts) {
    const list = handlers.get(h.signal) ?? [];
    list.push({ fn, opts });
    handlers.set(h.signal, list);
    return fn;
  },
  unsubscribe(h, fn) {
    const list = handlers.get(h.signal) ?? [];
    const i = list.findIndex((x) => x.fn === fn);
    if (i >= 0) list.splice(i, 1);
  },
};

const signalEvent = new $Map(); // "world.afterEvents.playerJoin" → イベントのクラス名
const signalCache = new $Map();
function signalObj(owner, prop, cls) {
  const k = `${owner}.${prop}`;
  signalEvent.set(k, cls.replace(/Signal$/, ''));
  if (!signalCache.has(k)) signalCache.set(k, inst(cls, { signal: k }));
  return signalCache.get(k);
}

function eventClassOf(signal) {
  const c = signalEvent.get(signal);
  return c && CLASSES[c] ? c : null;
}

function call(label, fn, args, mode = 'normal') {
  const prevRun = S.running;
  S.running = label;
  try {
    return withMode(mode, () => {
      const r = $apply(fn, undefined, args);
      if (r && typeof r.then === 'function') {
        r.then(undefined, (e) => {
          if (e instanceof SandboxNotImplemented) { notImplemented(e); return; }
          S.uncaught++;
          log('error', `${label}: 捕まえられていない Promise の失敗: ${errInfo(e).name}: ${errInfo(e).message}`, { error: errInfo(e) });
        });
      }
      return r;
    });
  } catch (e) {
    if (e instanceof SandboxNotImplemented) { notImplemented(e); return undefined; }
    S.uncaught++;
    log('error', `${label}: ${errInfo(e).name}: ${errInfo(e).message}`, { error: errInfo(e) });
    return undefined;
  } finally {
    S.running = prevRun;
  }
}

/** before イベントは同期で配る（読み取り専用）。戻り値は data（cancel を見る） */
function fireBefore(owner, name, data) {
  const signal = `${owner}.${name}`;
  const list = handlers.get(signal);
  if (!list?.length) return data;
  const cls = eventClassOf(signal);
  const ev = cls ? inst(cls, { data }) : data;
  for (const { fn } of [...list]) call(`${signal}`, fn, [ev], 'readonly');
  return data;
}

/** after イベントは tick の終わりにまとめて配る */
// after イベントは種類ごとにまとめて配られる（BDS で実測した順。載っていない種類は後ろに起きた順）
// 実測: 同じ tick に重なったイベントは、この順にまとめて配られる
const EVENT_ORDER = ['gameRuleChange', 'weatherChange', 'entitySpawn', 'entityHurt', 'entityHealthChanged', 'entityDie', 'entityRemove'];
let afterSeq = 0;
function fireAfter(owner, name, data) {
  const rank = EVENT_ORDER.indexOf(name);
  afterQueue.push({ owner, name, data, rank: rank < 0 ? EVENT_ORDER.length : rank, seq: afterSeq++ });
}

function flushAfter() {
  while (afterQueue.length) {
    const { owner, name, data } = afterQueue.shift();
    const signal = `${owner}.${name}`;
    const list = handlers.get(signal);
    if (!list?.length) continue;
    const cls = eventClassOf(signal);
    const ev = cls ? inst(cls, { data }) : data;
    for (const { fn, opts } of [...list]) {
      if (opts && !filterOk(opts, data)) continue;
      call(signal, fn, [ev]);
    }
  }
}

function filterOk(opts, data) {
  if (opts.namespaces && data.id !== undefined) return opts.namespaces.some((n) => $String(data.id).startsWith(`${n}:`));
  if (opts.entityTypes && data.entity) return opts.entityTypes.includes(H.get(data.entity)?.e?.typeId);
  return true;
}

// ---- スケジューラ -----------------------------------------------------------

const runs = new $Map(); // id → { fn, due, every, label }
let nextRun = 1;
const jobs = new $Map();
const waits = [];

// 実機（BDS で実測）: system.run はその tick の run の番で動く。runTimeout(0) も同じ tick。
function schedule(fn, delay, every, label) {
  const id = nextRun++;
  runs.set(id, { fn, due: S.tick + $Math.max(0, delay), every, label });
  return id;
}
