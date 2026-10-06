// 実行の文脈（early / normal / readonly）と、メタデータからのバインディングの組み立て

// ---- 実行の文脈（early / normal / readonly） ---------------------------------

function withMode(mode, fn) {
  const prev = S.mode;
  S.mode = mode;
  try { return fn(); } finally { S.mode = prev; }
}

function checkPriv(label, priv, kind) {
  if (S.mode === 'normal') return;
  if (S.mode === 'readonly' && !priv.includes('r')) {
    throw new $ReferenceError(`Native ${kind} [${label}] does not have required privileges.`);
  }
  if (S.mode === 'early' && !priv.includes('e')) {
    throw new $ReferenceError(`Native ${kind} [${label}] cannot be used in early execution.`);
  }
}

// ---- バインディングの組み立て ------------------------------------------------

const H = new $WeakMap(); // バインディングのオブジェクト → 中身
const CLASSES = {};
const TOKEN = $Symbol('internal');
const CN = $Symbol('class'); // インスタンスの実際のクラス名（実装はサブクラスから探す）
const IMPL = {};
const EXT_ACTIONS = {};
const END_HOOKS = [];
const CUSTOM = { END: $Symbol('end') };
const RULES_BY_LOWER = {};
const copyItemRef = {};
const DEATH_DROPS = {};
const itemComponentRef = {};
const componentOfRef = {};
const customDispatchRef = {}; // カスタムコンポーネントの処理を呼ぶ口（features/custom-components.js が入れる）
const targetVersion = {};

function typeName(t) {
  if (typeof t === 'string') return t;
  if (t.o) return typeName(t.o);
  if (t.a) return `Array<${typeName(t.a)}>`;
  if (t.v) return t.v.map(typeName).join(' | ');
  if (t.m) return 'Record';
  if (t.c) return 'function';
  if (t.p) return 'Promise';
  return 'any';
}

const INTS = { int8: 1, int16: 1, int32: 1, int64: 1, uint8: 1, uint16: 1, uint32: 1, uint64: 1 };
const NUMS = { float: 1, double: 1, ...INTS };

/** 実機の型変換に通るか。true / false */
function accepts(t, v, mod) {
  if (typeof t === 'object') {
    if (t.o) return v === undefined || v === null || accepts(t.o, v, mod);
    if (t.a) return $Array.isArray(v) && v.every((x) => accepts(t.a, x, mod));
    if (t.v) return t.v.some((x) => accepts(x, v, mod));
    if (t.m) return typeof v === 'object' && v !== null;
    if (t.c) return typeof v === 'function';
    return true;
  }
  if (t === 'any' || t === 'undefined' && v === undefined) return true;
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (NUMS[t]) return typeof v === 'number' && $isFinite(v);
  if (t === 'undefined') return v === undefined;
  const cls = CLASSES[t];
  if (cls) return typeof v === 'object' && v !== null && v instanceof cls;
  const iface = findIface(t, mod);
  if (iface) return typeof v === 'object' && v !== null && ifaceOk(iface, v, mod);
  if (findEnum(t, mod)) return typeof v === 'string' || typeof v === 'number';
  return true;
}

function findIface(name, mod) {
  return mod?.interfaces?.[name] ?? API.modules['@minecraft/server'].interfaces[name] ?? API.modules['@minecraft/common'].interfaces[name];
}
function findEnum(name, mod) {
  return mod?.enums?.[name] ?? API.modules['@minecraft/server'].enums[name];
}
function ifaceOk(iface, v, mod) {
  for (const [k, p] of $Object.entries(iface.props)) {
    const val = v[k];
    if (val === undefined && p.opt) continue;
    if (!accepts(p.t, val, mod)) return false;
  }
  if (iface.base) {
    const b = findIface(iface.base, mod);
    if (b && !ifaceOk(b, v, mod)) return false;
  }
  return true;
}

const jsType = (t) => (NUMS[t] ? 'number' : t);
/**
 * 実機の型変換エラー。実測した形は
 *   <頭> <どこが> expected type: <型>[ (failed parsing <経路>)]
 * で、配列やインターフェースの中に入るほど経路が連なる。
 */
function convError(t, v, i, mod, where, desc, chain) {
  if (typeof t === 'object' && t.o) return convError(t.o, v, i, mod, where, desc, chain);
  const at = desc ?? (where === 'arg' ? `Function argument [${i}]` : `Property [${i}]`);
  const trail = chain && chain.length ? ` (failed parsing ${chain.join(', failed parsing ')}).` : '';
  // 実測: 配列の中身が悪いときは「どの要素か」から経路を連ねる
  if (typeof t === 'object' && t.a && $Array.isArray(v)) {
    for (let j = 0; j < v.length; j++) {
      if (accepts(t.a, v[j], mod)) continue;
      return convError(t.a, v[j], j, mod, where, `Array element [${j}]`, [`array to ${at}`, ...(chain ?? [])]);
    }
  }
  if (typeof t === 'object' && t.v) {
    const hasIface = t.v.some((x) => typeof x === 'string' && findIface(x, mod));
    if (hasIface) return new $TypeError('Native variant type conversion failed.');
    return new $TypeError(`Native variant type conversion failed. ${at} expected type: ${typeName(t)}${trail}`);
  }
  if (typeof t === 'string' && typeof v === 'object' && v !== null) {
    const iface = findIface(t, mod);
    if (iface) {
      const props = { ...(iface.base ? findIface(iface.base, mod)?.props : {}), ...iface.props };
      for (const [k, pm] of $Object.entries(props)) {
        const val = v[k];
        if (val === undefined && pm.opt) continue;
        if (accepts(pm.t, val, mod)) continue;
        const pt = jsType(typeof pm.t === 'object' && pm.t.o ? pm.t.o : pm.t);
        const head = val === undefined || val === null ? 'Native setter cannot be assigned null or undefined.' : 'Native type conversion failed.';
        return new $TypeError(`${head} Interface property ['${k}'] expected type: ${typeName(pt)} (failed parsing ${['interface to ' + at, ...(chain ?? [])].join(', failed parsing ')}).`);
      }
    }
    // 実測: クラスを受けるところに「ただのオブジェクト」を渡すと、この文言になる
    if (CLASSES[t] || H.get(v) === undefined) return new $TypeError(`Object did not have a native handle. ${at} expected type: ${typeName(t)}${trail}`);
  }
  // 実測: クラスを受ける引数に別の値（undefined など）を渡すと InvalidArgumentError
  if (where === 'arg' && typeof t === 'string' && CLASSES[t] && !desc) return fail('InvalidArgumentError', `Invalid type passed to argument [${i}]. Expected type: ${t}`);
  return new $TypeError(`Native type conversion failed. ${at} expected type: ${typeName(t)}${trail}`);
}
const UINT_MAX = 4294967295;
/** 実機の範囲外エラー（3 通りの書き方を実測） */
function outOfBounds(i, v, min, max, label) {
  const head = `Unsupported or out of bounds value passed to function argument [${i}]${label ? `: ${label},` : '.'} Value: ${v}, `;
  const tail = min !== undefined && max !== undefined ? `Argument bounds: [${boundText(min)}, ${boundText(max)}]`
    : min !== undefined ? `Argument min: ${boundText(min)}` : `Argument max: ${boundText(max)}`;
  return fail('ArgumentOutOfBoundsError', head + tail);
}
const boundText = (n) => (n > 2147483647 ? n.toFixed(2) : $String(n));
/**
 * 実機が返すインターフェース（ただのオブジェクト）は、キーが名前の逆順に並ぶ
 * （Vector3 → z,y,x、AABB → extent,center を実測）。入れ子も同じ。
 */
// 色だけは名前の逆順ではない（実測: green, red, blue, alpha）
const RGB_ORDER = { RGB: [['green', 'float'], ['red', 'float'], ['blue', 'float']], RGBA: [['green', 'float'], ['red', 'float'], ['blue', 'float'], ['alpha', 'float']] };
const ifaceKeys = new $Map();
function keysOfIface(name, mod) {
  if (ifaceKeys.has(name)) return ifaceKeys.get(name);
  const iface = findIface(name, mod);
  if (!iface) { ifaceKeys.set(name, null); return null; }
  const props = { ...(iface.base ? findIface(iface.base, mod)?.props : {}), ...iface.props };
  const list = $Object.keys(props).sort().reverse().map((k) => [k, props[k].t]);
  ifaceKeys.set(name, list);
  return list;
}
const LIVE = new WeakSet(); // そのまま返す配列（実機でも同じ配列が返るもの）
function shapeOut(t, v, mod, depth = 0) {
  if (v === null || typeof v !== 'object' || depth > 6 || !t || LIVE.has(v)) return v;
  if (typeof t === 'object') {
    if (t.o) return shapeOut(t.o, v, mod, depth);
    if (t.a) return $Array.isArray(v) ? v.map((x) => shapeOut(t.a, x, mod, depth + 1)) : v;
    if (t.v) { const ifs = t.v.filter((x) => typeof x === 'string' && findIface(x, mod)); return ifs.length === 1 ? shapeOut(ifs[0], v, mod, depth) : v; }
    return v;
  }
  if ($Object.getPrototypeOf(v) !== OBJ_PROTO) return v;
  const keys = RGB_ORDER[t] ?? keysOfIface(t, mod);
  if (!keys) return v;
  const out = {};
  for (const [k, kt] of keys) if (k in v && v[k] !== undefined) out[k] = shapeOut(kt, v[k], mod, depth + 1);
  for (const k of $Object.keys(v)) if (!(k in out) && v[k] !== undefined && !keys.some(([kk]) => kk === k)) out[k] = v[k];
  return out;
}

// 実測で分かった、同梱メタデータと実機の引数の数の食い違い（1.26.51.1 で確認）
const ARITY = { 'Camera::setFov': [0, 1], 'Camera::addShake': [1, 1], 'Camera::attachToEntity': [0, 1] };

function checkArgs(label, meta, args, mod) {
  const fixed = ARITY[label];
  if (fixed) {
    if (args.length < fixed[0] || args.length > fixed[1]) {
      const exp = fixed[0] === fixed[1] ? `${fixed[1]}` : `${fixed[0]}-${fixed[1]}`;
      throw new $TypeError(`Incorrect number of arguments to function. Expected ${exp}, received ${args.length}`);
    }
    return;
  }
  const total = meta.args.length;
  let required = 0;
  for (const a of meta.args) if (!a.opt) required++;
  if (args.length < required || args.length > total) {
    const exp = required === total ? `${total}` : `${required}-${total}`;
    throw new $TypeError(`Incorrect number of arguments to function. Expected ${exp}, received ${args.length}`);
  }
  for (let i = 0; i < meta.args.length; i++) {
    const a = meta.args[i];
    const v = args[i];
    if (v === undefined && a.opt) continue;
    if (!accepts(a.t, v, mod)) throw convError(a.t, v, i, mod, 'arg');
    if (typeof v === 'number') {
      const base = typeof a.t === 'object' && a.t.o ? a.t.o : a.t;
      let min = a.min;
      let max = a.max;
      if (base === 'uint32' || base === 'uint64') { min ??= 0; max ??= UINT_MAX; }
      if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
        throw outOfBounds(i, v, min, max);
      }
    }
  }
}

function findImpl(cn, kind, name) {
  let c = cn;
  while (c) {
    const f = IMPL[c]?.[kind]?.[name];
    if (f) return f;
    c = CLASSES[c]?.__meta?.base ?? null;
  }
  return null;
}

const INVALID = { Entity: 'InvalidEntityError', Player: 'InvalidEntityError', Container: 'InvalidContainerError', ItemStack: 'InvalidItemStackError', Structure: 'InvalidStructureError' };
function invalidFor(cn) {
  let c = cn;
  while (c) {
    if (INVALID[c]) return INVALID[c];
    c = CLASSES[c]?.__meta?.base ?? null;
  }
  return 'Error';
}

const INVALID_WORD = { InvalidEntityError: 'Entity', InvalidContainerError: 'Container', InvalidItemStackError: 'ItemStack', InvalidStructureError: 'Structure' };
function checkValid(cn, h, member, kind = 'function') {
  if (member === 'isValid' || !h || typeof h.valid !== 'function') return;
  if (h.valid()) return;
  const what = kind === 'function' ? `call function '${member}'` : `${kind === 'set' ? 'set' : 'get'} property '${member}'`;
  if (h.invalidError) throw h.invalidError(what);
  const err = invalidFor(cn);
  const word = INVALID_WORD[err] ?? cn;
  throw fail(err, `Failed to ${what} due to ${word} being invalid (has the ${word} been removed?).`);
}

/** メタデータ 1 クラス分のバインディングを作る */
function buildClass(cn, meta, mod, version) {
  if (CLASSES[cn]) return CLASSES[cn];
  const Base = meta.base ? buildClass(meta.base, mod.classes[meta.base] ?? API.modules['@minecraft/server'].classes[meta.base], mod.classes[meta.base] ? mod : API.modules['@minecraft/server'], version) : null;
  const ctorMeta = meta.ctor;
  const ctorImpl = IMPL[cn]?.ctor;
  const make = (self, args) => {
    if (args[0] === TOKEN) { H.set(self, args[1]); return; }
    if (!ctorMeta) throw new $ReferenceError(`No constructor for native class '${cn}'.`);
    checkPriv(cn, ctorMeta.priv, 'constructor');
    checkArgs(cn, ctorMeta, args, mod);
    bump(S.usage, `${cn}.constructor`);
    if (!ctorImpl) { bump(S.unsupported, `new ${cn}`); throw new SandboxNotImplemented(`new ${cn}()`); }
    H.set(self, $apply(ctorImpl, self, args));
  };
  let C;
  if (Base) C = class extends Base { constructor(...a) { super(TOKEN, null); make(this, a); } };
  else C = class { constructor(...a) { make(this, a); } };
  $Object.defineProperty(C, 'name', { value: cn });
  $Object.defineProperty(C, '__meta', { value: meta, enumerable: false });
  $Object.defineProperty(C, '__version', { value: version, enumerable: false });
  $Object.defineProperty(C.prototype, CN, { value: cn, enumerable: false });
  CLASSES[cn] = C;

  for (const [fn, fm] of $Object.entries(meta.fns)) {
    if (!verLE(fm.since ?? '0.0.0', version)) continue;
    const label = `${cn}::${fn}`;
    const f = {
      [fn](...args) {
        const h = fm.st ? null : H.get(this);
        if (!fm.st && h === undefined) throw new $TypeError(`Native function [${label}] object bound to prototype does not exist.`);
        checkPriv(label, fm.priv, 'function');
        checkArgs(label, fm, args, mod);
        const real = fm.st ? cn : (this[CN] ?? cn);
        checkValid(real, h, fn);
        bump(S.usage, `${cn}.${fn}`);
        const impl = findImpl(real, fm.st ? 'static' : 'fns', fn) ?? (/EventSignal$/.test(cn) ? SIGNAL[fn] : null);
        if (!impl) { bump(S.unsupported, `${cn}.${fn}`); throw new SandboxNotImplemented(`${cn}.${fn}()`); }
        return shapeOut(fm.ret, $apply(impl, this, [h, ...args]), mod);
      },
    }[fn];
    $Object.defineProperty(fm.st ? C : C.prototype, fn, { value: f, writable: true, configurable: true });
  }

  for (const [pn, pm] of $Object.entries(meta.props)) {
    if (pm.since && !verLE(pm.since, version)) continue;
    const label = `${cn}::${pn}`;
    if (pm.st && pm.v !== undefined) { $Object.defineProperty(C, pn, { value: pm.v, enumerable: true }); continue; }
    const desc = {
      configurable: true,
      enumerable: true,
      get() {
        const h = pm.st ? null : H.get(this);
        if (!pm.st && h === undefined) return undefined;
        checkPriv(label, pm.gp, 'property getter');
        const real = pm.st ? cn : (this[CN] ?? cn);
        checkValid(real, h, pn, 'get');
        bump(S.usage, `${cn}.${pn}`);
        const impl = findImpl(real, pm.st ? 'staticGet' : 'get', pn);
        if (impl) return shapeOut(pm.t, $apply(impl, this, [h]), mod);
        if (h && h.data && pn in h.data) return shapeOut(pm.t, h.data[pn], mod);
        bump(S.unsupported, `${cn}.${pn}`);
        throw new SandboxNotImplemented(`${cn}.${pn}`);
      },
    };
    if (!pm.ro) {
      desc.set = function set(v) {
        const h = H.get(this);
        if (h === undefined) return;
        checkPriv(label, pm.sp, 'property setter');
        const real = this[CN] ?? cn;
        checkValid(real, h, pn, 'set');
        if (!accepts(pm.t, v, mod)) throw convError(pm.t, v, label, mod, 'prop');
        if (typeof v === 'number' && ((pm.min !== undefined && v < pm.min) || (pm.max !== undefined && v > pm.max))) {
          throw fail('PropertyOutOfBoundsError', `Value [${v}] for property [${label}] is out of bounds [${pm.min}, ${pm.max}]`);
        }
        bump(S.usage, `${cn}.${pn}=`);
        const impl = findImpl(real, 'set', pn);
        if (impl) { $apply(impl, this, [h, v]); return; }
        if (h && h.data) { h.data[pn] = v; return; }
        bump(S.unsupported, `${cn}.${pn}=`);
        throw new SandboxNotImplemented(`${cn}.${pn} への代入`);
      };
    }
    $Object.defineProperty(pm.st ? C : C.prototype, pn, desc);
  }
  return C;
}

/** バインディングのオブジェクトを作る（中身つき） */
// is_baked のプロパティは、実機ではインスタンス自身の値（JSON.stringify に出る・無効化後も読める）
const bakedCache = new $Map();
// 実測で分かった「実機での定義順」。メタデータの並びが実機と違うクラスだけ、ここで直す
// （JSON.stringify は、この順の逆に並ぶ）。
const BAKED_ORDER = { SoundInstance: ['id', 'soundEventId', 'durationInfo', 'recipient'] };
function bakedOf(cn) {
  if (bakedCache.has(cn)) return bakedCache.get(cn);
  const list = [];
  const chain = [];
  for (let c = cn; c; c = CLASSES[c]?.__meta?.base ?? null) chain.unshift(c);
  for (const c of chain) {
    const meta = CLASSES[c]?.__meta;
    if (!meta) continue;
    for (const [pn, pm] of $Object.entries(meta.props)) {
      if (pm.bk && !pm.st && CLASSES[c].__version && verLE(pm.since ?? '0.0.0', CLASSES[c].__version)) list.push([c, pn]);
    }
  }
  const fixed = BAKED_ORDER[cn];
  if (fixed) list.sort((a, b) => fixed.indexOf(a[1]) - fixed.indexOf(b[1]));
  // 実測: 実機の JSON.stringify では、データのプロパティが定義と逆の順に並ぶ（Vector3 が z, y, x になるのと同じ）
  list.reverse();
  bakedCache.set(cn, list);
  return list;
}
function inst(cn, h) {
  const C = CLASSES[cn];
  if (!C) throw new $Error(`[sandbox] ${cn} は組み立てられていません`);
  const o = new C(TOKEN, h);
  for (const [c, pn] of bakedOf(cn)) {
    let v;
    const impl = findImpl(cn, 'get', pn);
    try {
      if (impl && !impl.notImplemented) v = $apply(impl, o, [h]);
      else if (h && h.data && pn in h.data) v = h.data[pn];
      else continue;
    } catch { continue; }
    $Object.defineProperty(o, pn, { value: v, enumerable: true, writable: false, configurable: false });
  }
  return o;
}
/** 同じ中身に同じオブジェクトを返す（実機も === が成り立つものがある） */
const cache = new $WeakMap();
function once(cn, h) {
  let o = cache.get(h);
  if (!o) { o = inst(cn, h); cache.set(h, o); }
  return o;
}
