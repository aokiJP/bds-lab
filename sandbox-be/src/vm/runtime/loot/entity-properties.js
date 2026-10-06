// エンティティのプロパティ

// ---- エンティティのプロパティ ----------------------------------------------------
const propDefs = (e) => BEH.entities[e.typeId]?.properties ?? {};
function propInit(e) {
  if (e.props) return e.props;
  e.props = {};
  const measured = M.entities[e.typeId]?.propValues ?? {};
  for (const [k, d] of $Object.entries(propDefs(e))) {
    const tally = measured[k];
    if (tally && typeof tally === 'object' && !tally.error) {
      // 実測: 湧いたときに決まる値の分布から選ぶ
      const keys = $Object.keys(tally);
      const v = $JSON.parse(keys[pick(keys.map((x) => tally[x]))]);
      e.props[k] = v === '__undefined' ? d.default : v;
    } else {
      e.props[k] = d.default;
    }
  }
  return e.props;
}
const propMissing = (e, k) => `Property "${k}" does not exist on Entity of type "${e.typeId}".`;
function checkPropValue(e, k, v) {
  const d = propDefs(e)[k];
  if (!d) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. ${propMissing(e, k)}`);
  const want = d.type === 'bool' ? 'boolean' : d.type === 'enum' ? 'string' : 'number';
  if (typeof v !== want) throw fail('InvalidArgumentError', 'Invalid type passed to argument [0]. Expected type: string property');
  if (d.type === 'enum' && !(d.values ?? []).includes(v)) throw fail('InvalidArgumentError', 'Invalid type passed to argument [1]. Expected type: enum property');
  if ((d.type === 'int' || d.type === 'float') && d.range && (v < d.range[0] || v > d.range[1])) {
    throw outOfBounds(1, v, d.range[0], d.range[1], 'number property');
  }
  return d.type === 'int' ? $Math.trunc(v) : d.type === 'float' ? F(v) : v;
}
const pendingProps = [];
$Object.assign(IMPL.Entity.fns, {
  getProperty(h, k) { const p = propInit(h.e); return k in p ? p[k] : undefined; },
  // 実測: 値が変わるのは tick の終わり
  setProperty(h, k, v) { propInit(h.e); const val = checkPropValue(h.e, k, v); pendingProps.push([h.e, k, val]); },
  resetProperty(h, k) {
    const d = propDefs(h.e)[k];
    if (!d) throw fail('Error', propMissing(h.e, k));
    propInit(h.e);
    pendingProps.push([h.e, k, d.default]);
    return d.default;
  },
});
END_HOOKS.push(() => {
  for (const [e, k, v] of pendingProps.splice(0)) if (e.valid) e.props[k] = v;
});
$Object.assign(IMPL.Player.fns, {
  setPropertyOverrideForEntity(h, target, k, v) {
    const t = H.get(target).e;
    const val = checkPropValue(t, k, v);
    h.e.propOverrides ??= {};
    (h.e.propOverrides[t.id] ??= {})[k] = val;
  },
  removePropertyOverrideForEntity(h, target, k) { const t = H.get(target).e; if (h.e.propOverrides?.[t.id]) delete h.e.propOverrides[t.id][k]; },
  clearPropertyOverridesForEntity(h, target) { const id = typeof target === 'string' ? target : H.get(target).e.id; if (h.e.propOverrides) delete h.e.propOverrides[id]; },
});
