// 版の比較と、記録（ログ・使った API の集計）

// ---- 版の比較 ---------------------------------------------------------------

const ver = (s) => $String(s).split('.').map((x) => $Number(x) || 0);
const verLE = (a, b) => {
  const x = ver(a);
  const y = ver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};

// ---- 記録 -------------------------------------------------------------------

const S = {
  tick: 0,
  mode: 'early', // early / normal / readonly
  running: null, // いま動いているコールバックの名前（ハングしたときの手がかり）
  log: [],
  usage: new $Map(),
  unsupported: new $Map(),
  chat: [],
  effects: [], // 音・パーティクル・タイトルなど、世界の状態に残らない出力
  commands: [],
  uncaught: 0,
  inconclusive: 0,
};

const MAX_LOG = CFG.limits?.maxLogLines ?? 2000;
function log(level, message, extra) {
  if (S.log.length >= MAX_LOG) { if (S.log.length === MAX_LOG) S.log.push({ tick: S.tick, level: 'warn', message: `ログが ${MAX_LOG} 行を超えたので、以降は捨てます` }); return; }
  const rec = { tick: S.tick, level, message: $String(message) };
  if (extra) $Object.assign(rec, extra);
  S.log.push(rec);
}
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

function fmt(v, depth = 0) {
  if (typeof v === 'string') return qjsText(v);
  if (v instanceof $Error) return `${v.name}: ${qjsMessage(v.message)}`;
  if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
  if (typeof v !== 'object' || v === null) return $String(v);
  if (depth > 2) return '[…]';
  try {
    if ($Array.isArray(v)) return `[${v.map((x) => fmt(x, depth + 1)).join(', ')}]`;
    return `{${$Object.keys(v).map((k) => `${k}: ${fmt(v[k], depth + 1)}`).join(', ')}}`;
  } catch { return '[object]'; }
}

// 実機の JS エンジンは QuickJS。Node（V8）の組み込みエラーの文言を QuickJS の書き方に直す
const QJS_MSG = [
  [/^(?:.*\.)?[^ ]* is not a function$/, () => 'not a function'],
  [/^.* is not a constructor$/, () => 'not a constructor'],
  [/^Cannot read properties of (undefined|null) \(reading '(.+)'\)$/, (m) => `cannot read property '${m[2]}' of ${m[1]}`],
  [/^Cannot set properties of (undefined|null) \(setting '(.+)'\)$/, (m) => `cannot set property '${m[2]}' of ${m[1]}`],
  [/^Cannot read property '(.+)' of (undefined|null)$/, (m) => `cannot read property '${m[1]}' of ${m[2]}`],
  [/^(.+) is not defined$/, (m) => `'${m[1]}' is not defined`],
  [/^(.*) is not iterable$/, () => 'value is not iterable'],
  [/^Cannot convert (undefined|null) to object$/, (m) => `cannot convert ${m[1]} to object`],
  [/^Cannot convert undefined or null to object$/, () => 'cannot convert undefined to object'],
  [/^Assignment to constant variable\.$/, () => 'invalid assignment to const variable'],
];
// ログの文字列に混ざった V8 の文言も直す（try/catch して自分で書き出す作りのため）
const QJS_TEXT = [
  [/\b(TypeError): [^\s:,;)'"]+ is not a function/g, 'TypeError: not a function'],
  [/\b(TypeError): [^\s:,;)'"]+ is not a constructor/g, 'TypeError: not a constructor'],
  [/\b(TypeError): Cannot read properties of (undefined|null) \(reading '([^']+)'\)/g, (m, a, b, c) => `TypeError: cannot read property '${c}' of ${b}`],
  [/\b(TypeError): Cannot set properties of (undefined|null) \(setting '([^']+)'\)/g, (m, a, b, c) => `TypeError: cannot set property '${c}' of ${b}`],
  [/\b(ReferenceError): ([A-Za-z_$][\w$]*) is not defined/g, (m, a, b) => `ReferenceError: '${b}' is not defined`],
];
function qjsText(str) {
  let out = str;
  for (const [re, to] of QJS_TEXT) out = out.replace(re, to);
  return out;
}

function qjsMessage(msg) {
  for (const [re, to] of QJS_MSG) { const m = re.exec(msg); if (m) return to(m); }
  return msg;
}

function errInfo(e) {
  if (e && typeof e === 'object') {
    return { name: $String(e.name ?? 'Error'), message: qjsMessage($String(e.message ?? '')), stack: typeof e.stack === 'string' ? e.stack : undefined };
  }
  return { name: 'Error', message: $String(e) };
}
