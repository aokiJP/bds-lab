// 実測データ: エンチャント・本・ポーション・クールダウン

// ---- アイテム: エンチャント ------------------------------------------------------
const enchShort = (e) => $String(e).replace(/^minecraft:/, '');
const enchTypeOf = (t) => {
  const raw = typeof t === 'string' ? t : H.get(t)?.id;
  const id = raw && enchId(raw);
  if (!id) throw fail('EnchantmentTypeUnknownIdError', 'Unknown enchantment type ID.');
  return id;
};
const enchMax = (id) => M.enchantments[enchShort(id)] ?? ENCH_MAX[enchShort(id)] ?? 1;
// 実測: レベルは 0〜最大。相性の悪い組み合わせも「レベルが範囲外」の例外になる
const levelError = (verb, id, level) => fail('EnchantmentLevelOutOfBoundsError', `When trying to ${verb} enchantment instance - Tyring to set enchantment level to ${level}, range for type ${enchShort(id)} is [0 - ${enchMax(id)}].`);
function checkEnchLevel(id, level) {
  if (level < 0 || level > enchMax(id)) throw levelError('create', id, level);
}
const CONFLICTS = (M.enchantConflicts ?? []).map((c) => [c[0], c[1]]);
const conflictsWith = (have, id) => $Object.keys(have ?? {}).some((x) => x !== id && CONFLICTS.some(([a, b]) => (a === x && b === id) || (a === id && b === x)));
const enchObj = (id, level) => ({ type: typed('EnchantmentType', enchShort(id)), level });
const itemAccepts = (it, id) => (M.enchantable[it.typeId]?.ok ?? []).includes(enchShort(id));
IMPL.ItemEnchantableComponent = {
  fns: {
    canAddEnchantment(h, e) {
      const id = enchTypeOf(e.type);
      checkEnchLevel(id, e.level);
      if (conflictsWith(h.it.ench, id)) throw levelError('add', id, e.level);
      return itemAccepts(h.it, id);
    },
    addEnchantment(h, e) {
      const id = enchTypeOf(e.type);
      checkEnchLevel(id, e.level);
      if (!itemAccepts(h.it, id)) throw fail('EnchantmentTypeNotCompatibleError', `Enchantment of type ${enchShort(id)} is not compatible with item.`);
      if (conflictsWith(h.it.ench, id)) throw levelError('add', id, e.level);
      h.it.ench ??= {};
      // すでに付いていれば、高いほうが残る（実測: 3 のあとに 1 を足しても 3）
      h.it.ench[enchShort(id)] = $Math.max(h.it.ench[enchShort(id)] ?? 0, e.level);
    },
    addEnchantments(h, list) { for (const e of list) IMPL.ItemEnchantableComponent.fns.addEnchantment(h, e); },
    getEnchantment(h, t) { const id = enchShort(enchTypeOf(t)); return h.it.ench?.[id] ? enchObj(id, h.it.ench[id]) : undefined; },
    getEnchantments: (h) => $Object.entries(h.it.ench ?? {}).map(([id, lv]) => enchObj(id, lv)),
    hasEnchantment(h, t) { return Boolean(h.it.ench?.[enchShort(enchTypeOf(t))]); },
    removeEnchantment(h, t) { const id = enchShort(enchTypeOf(t)); if (h.it.ench) delete h.it.ench[id]; },
    removeAllEnchantments(h) { h.it.ench = {}; },
  },
  get: {
    typeId: () => 'minecraft:enchantable',
    // 実測: 中身は undefined が並ぶ配列（数だけが意味を持つ）
    slots: (h) => Array.from({ length: M.enchantable[h.it.typeId]?.slots ?? 0 }),
  },
};

// ---- アイテム: 本 -------------------------------------------------------------
const MAX_PAGES = 50;
const MAX_PAGE_CHARS = 256; // 実測
const tooManyPages = () => fail('BookError', `Failed to set book contents as the amount of pages exceeds the maximum of ${MAX_PAGES}.`);
// 実測: 文字列のページと RawMessage のページは別物。getPageContent / contents は文字列のページだけ、
// getRawPageContent / rawContents は RawMessage のページだけを返す（それ以外は undefined）
function pageOf(content) {
  if (typeof content === 'string') return { text: content, raw: null };
  if ($Array.isArray(content)) return { text: null, raw: { rawtext: content.map((c) => (typeof c === 'string' ? { text: c } : $JSON.parse($JSON.stringify(c)))) } };
  return { text: null, raw: $JSON.parse($JSON.stringify(content)) };
}
function bookOf(h) {
  h.it.book ??= { pages: [], title: undefined, author: undefined, signed: h.it.typeId === 'minecraft:written_book' };
  return h.it.book;
}
function checkPage(p) {
  const len = p.text !== null ? p.text.length : rawText(p.raw).length;
  if (len > MAX_PAGE_CHARS) throw fail('BookPageContentError', `Failed to set book contents as the provided text exceeds the maximum page length of ${MAX_PAGE_CHARS}.`);
  return p;
}
IMPL.ItemBookComponent = {
  fns: {
    getPageContent: (h, i) => bookOf(h).pages[i]?.text ?? undefined,
    getRawPageContent: (h, i) => { const p = bookOf(h).pages[i]; return p?.raw ? $JSON.parse($JSON.stringify(p.raw)) : undefined; },
    insertPage(h, i, content) {
      const b = bookOf(h);
      const page = checkPage(pageOf(content));
      if (b.pages.length >= MAX_PAGES || i >= MAX_PAGES) throw tooManyPages();
      while (b.pages.length < i) b.pages.push({ text: '', raw: null });
      b.pages.splice(i, 0, page);
    },
    removePage(h, i) { const b = bookOf(h); if (i >= 0 && i < b.pages.length) b.pages.splice(i, 1); },
    setContents(h, list) {
      if (list.length > MAX_PAGES) throw tooManyPages();
      bookOf(h).pages = list.map((c) => checkPage(pageOf(c)));
    },
    setPageContent(h, i, content) {
      const b = bookOf(h);
      const page = checkPage(pageOf(content));
      if (i >= MAX_PAGES) throw tooManyPages();
      while (b.pages.length < i) b.pages.push({ text: '', raw: null });
      b.pages[i] = page;
    },
    signBook(h, title, author) {
      const b = bookOf(h);
      b.title = title;
      b.author = author;
      b.signed = true;
      h.it.typeId = 'minecraft:written_book';
    },
  },
  get: {
    typeId: () => 'minecraft:book',
    pageCount: (h) => bookOf(h).pages.length,
    contents: (h) => bookOf(h).pages.map((p) => p.text ?? undefined),
    rawContents: (h) => bookOf(h).pages.map((p) => (p.raw ? $JSON.parse($JSON.stringify(p.raw)) : undefined)),
    isSigned: (h) => bookOf(h).signed,
    author: (h) => bookOf(h).author,
    title: (h) => bookOf(h).title,
  },
};

// ---- アイテム: ポーション・クールダウン ---------------------------------------------
const POT = M.potions ?? null;
const potionEffectObj = (id) => { const e = POT?.effects?.find((x) => x.id === id); return inst('PotionEffectType', { data: { id, durationTicks: e?.ticks || undefined } }); };
const potionDeliveryObj = (id) => inst('PotionDeliveryType', { data: { id } });
// 実測: 名前空間を補わない（'swiftness' は見つからない）
const potId = (v) => (typeof v === 'string' ? v : H.get(v)?.data?.id);
IMPL.Potions = {
  static: {
    getAllEffectTypes: () => (POT ? POT.effects.map((e) => potionEffectObj(e.id)) : NI('Potions（実測データが無い）')),
    getAllDeliveryTypes: () => (POT ? POT.deliveries.map(potionDeliveryObj) : NI('Potions（実測データが無い）')),
    getEffectType: (h, id) => (POT?.effects.some((e) => e.id === potId(id)) ? potionEffectObj(potId(id)) : undefined),
    getDeliveryType: (h, id) => (POT?.deliveries.includes(potId(id)) ? potionDeliveryObj(potId(id)) : undefined),
    resolve(h, eff, del) {
      if (!POT) return NI('Potions.resolve（実測データが無い）');
      const e = potId(eff);
      const d = potId(del);
      if (!POT.effects.some((x) => x.id === e)) throw fail('InvalidPotionEffectTypeError', `PotionEffectType <${e}> does not exist. Prefer to use MinecraftPotionEffectTypes enum.`);
      if (!POT.deliveries.includes(d)) throw fail('InvalidPotionDeliveryTypeError', `PotionDeliveryType <${d}> does not exist. Prefer to use MinecraftPotionDeliveryTypes enum.`);
      const r = POT.resolved[`${e}|${d}`];
      if (!$Array.isArray(r)) return NI(`Potions.resolve（${e} / ${d}）`);
      return itemObj({ typeId: r[0], amount: 1, lore: [], potion: { effect: r[1] ?? e, delivery: r[2] ?? d } });
    },
  },
};
const DEFAULT_DELIVERY = { 'minecraft:potion': 'Consume', 'minecraft:splash_potion': 'ThrownSplash', 'minecraft:lingering_potion': 'ThrownLingering' };
IMPL.ItemPotionComponent = {
  get: {
    typeId: () => 'minecraft:potion',
    // 実測: 何も指定していない瓶は水。投げ方はアイテムの種類で決まる
    potionEffectType: (h) => potionEffectObj(h.it.potion?.effect ?? 'minecraft:water'),
    potionDeliveryType: (h) => potionDeliveryObj(h.it.potion?.delivery ?? DEFAULT_DELIVERY[h.it.typeId] ?? 'Consume'),
  },
};
IMPL.ItemCooldownComponent = {
  fns: {
    isCooldownCategory: (h, c) => h.data.cooldownCategory === c,
    startCooldown(h, player) { const p = H.get(player).e; p.cooldowns ??= {}; p.cooldowns[h.data.cooldownCategory] = S.tick + h.data.cooldownTicks; },
    getCooldownTicksRemaining(h, player) { const p = H.get(player).e; return $Math.max(0, (p.cooldowns?.[h.data.cooldownCategory] ?? 0) - S.tick); },
  },
};
IMPL.Player.fns.getItemCooldown = (h, cat) => $Math.max(0, (h.e.cooldowns?.[cat] ?? 0) - S.tick);
IMPL.Player.fns.startItemCooldown = (h, cat, ticks) => { h.e.cooldowns ??= {}; h.e.cooldowns[cat] = S.tick + ticks; };
const prevItemComponent = itemComponentRef.fn ?? itemComponent;
itemComponentRef.fn = (h, id) => {
  const full = fullId(id);
  const data = M.items[h.it.typeId];
  const k = full.slice(10);
  if (k === 'enchantable') return data?.comps?.includes(full) ? once('ItemEnchantableComponent', (h.it._ench ??= { it: h.it, typeId: full, valid: () => true })) : undefined;
  if (k === 'book') return data?.comps?.includes(full) || h.it.typeId === 'minecraft:written_book' ? once('ItemBookComponent', (h.it._book ??= { it: h.it, typeId: full, valid: () => true })) : undefined;
  if (k === 'potion' && (h.it.potion || data?.comps?.includes(full))) return once('ItemPotionComponent', (h.it._pot ??= { it: h.it, typeId: full, valid: () => true }));
  return prevItemComponent(h, id);
};
// コンテナを経由してもエンチャント・本・ポーションが残るように、深くコピーする
const copyItemDeep = (it) => {
  const c = { ...it, lore: [...(it.lore ?? [])], dyn: it.dyn ? { ...it.dyn } : undefined };
  for (const k of ['_dur', '_food', '_generic', '_ench', '_book', '_pot']) delete c[k];
  if (it.ench) c.ench = { ...it.ench };
  if (it.book) c.book = { ...it.book, pages: it.book.pages.map((p) => ({ ...p })) };
  if (it.potion) c.potion = { ...it.potion };
  return c;
};
copyItemRef.fn = copyItemDeep;
