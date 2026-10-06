// 仮想の乱数・時計と、実機と同じ形のエラー

// ---- 乱数・時計（すべて仮想） ------------------------------------------------

let seed = (CFG.seed ?? 1) >>> 0;
function random() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const EPOCH = $Date.parse(CFG.clock ?? '2026-01-01T00:00:00Z');
const now = () => EPOCH + S.tick * 50 + (S.clockShift ?? 0);   // clockShift: the `clock` action (a test's clock +1d)

// ---- エラー ---------------------------------------------------------------

const ERR = {};
function errorClass(name, Base = $Error) {
  if (ERR[name]) return ERR[name];
  const C = class extends Base {
    constructor(message) { super(message); this.name = name; }
  };
  $Object.defineProperty(C, 'name', { value: name });
  ERR[name] = C;
  return C;
}
function notImplemented(e) {
  S.inconclusive++;
  log('warn', `${e.message}（この先の結果は実機と違う可能性があります）`, { api: e.api, inconclusive: true });
}
class SandboxNotImplemented extends $Error {
  constructor(api) {
    super(`[sandbox] ${api} は実機にありますが、サンドボックスではまだ再現していません`);
    this.name = 'SandboxNotImplemented';
    this.api = api;
  }
}
const fail = (name, message) => (name === 'Error' ? new $Error(message) : new (ERR[name] ?? errorClass(name))(message));
