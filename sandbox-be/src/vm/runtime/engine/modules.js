// モジュールの組み立て

// ---- モジュールの組み立て -----------------------------------------------------

const HW = { after: {}, before: {}, scoreboard: {}, gameRules: {} };
const HS = { after: {}, before: {} };

/** WorldAfterEvents などの各プロパティに、シグナルを返す実装を足す */
function wireSignals(ownerClass, label, mod) {
  const meta = mod.classes[ownerClass];
  IMPL[ownerClass] ??= {};
  IMPL[ownerClass].get ??= {};
  for (const [pn, pm] of $Object.entries(meta.props)) {
    IMPL[ownerClass].get[pn] = () => signalObj(label, pn, pm.t);
  }
}

const EXPORTS = {};
function buildModule(name) {
  const mod = API.modules[name];
  const version = targetVersion[name] ?? (mod.versions.filter((v) => !/-beta$/.test(v)).at(-1) ?? mod.versions.at(-1));
  const out = {};
  for (const [cn, meta] of $Object.entries(mod.classes)) {
    if (!verLE(meta.since ?? '0.0.0', version)) continue;
    out[cn] = buildClass(cn, meta, mod, version);
  }
  for (const [en, e] of $Object.entries(mod.enums)) {
    if (mod.enumSince && !verLE(mod.enumSince[en] ?? '0.0.0', version)) continue;
    out[en] = $Object.freeze({ ...e });
  }
  for (const en of $Object.keys(mod.errors)) out[en] = errorClass(en);
  for (const [k, v] of $Object.entries(mod.constants ?? {})) out[k] = v;
  for (const [on, cn] of $Object.entries(mod.objects ?? {})) {
    const h = on === 'world' ? {} : on === 'system' ? {} : {};
    out[on] = once(cn, h);
  }
  // JS の反復プロトコル（メタデータには出てこないが実機では使える）
  const It = CLASSES.BlockLocationIterator;
  if (It && !It.prototype.next) {
    $Object.defineProperty(It.prototype, 'next', { value: function next() { const g = H.get(this).gen.next(); return g.done ? { done: true, value: undefined } : { done: false, value: g.value }; }, writable: true, configurable: true });
    $Object.defineProperty(It.prototype, $Symbol.iterator, { value: function iterator() { return this; }, writable: true, configurable: true });
  }
  EXPORTS[name] = out;
  return out;
}
