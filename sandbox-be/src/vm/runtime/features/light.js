// 光

// ==== 光 ==========================================================================
// 実機 BDS 1.26.51.1 で測った規則:
//  - 明るさは 1 マス進むごとに 1 減る。空の光（15）はまっすぐ下へは減らない
//  - 光を少し通すブロック（葉・水・ハーフブロックなど）は 1、氷は 3、ビーコンは 14 だけ減らす
//  - 不透明なブロックの中は getLightLevel が 0（置いた直後から 0）
//  - 光る不透明ブロック（グロウストーンなど）は、自分は 0 で、隣が「明るさ − 1」
//  - 昼夜・天気による暗さは getLightLevel / getSkyLightLevel の両方に入る。式は Java 版と同じで、
//    tick の終わりに「2 tick 先の時刻」で計算し直す（setTimeOfDay の直後に読むと古い暗さ）
//  - 読み込まれていない場所の getLightLevel は 15、世界より上は「15 − 暗さ」
//  - ブロックを置いた結果が光に反映されるのは tick の終わり
const LIGHT_EMIT = {
  'minecraft:torch': 14, 'minecraft:underwater_torch': 14, 'minecraft:end_rod': 14,
  'minecraft:colored_torch_red': 14, 'minecraft:colored_torch_green': 14, 'minecraft:colored_torch_blue': 14, 'minecraft:colored_torch_purple': 14,
  'minecraft:soul_torch': 10, 'minecraft:lantern': 15, 'minecraft:soul_lantern': 10,
  'minecraft:glowstone': 15, 'minecraft:sea_lantern': 15, 'minecraft:beacon': 15, 'minecraft:conduit': 15,
  'minecraft:lit_pumpkin': 15, 'minecraft:shroomlight': 15, 'minecraft:lava': 15, 'minecraft:flowing_lava': 15,
  'minecraft:fire': 15, 'minecraft:soul_fire': 10, 'minecraft:end_portal': 15, 'minecraft:end_gateway': 15, 'minecraft:portal': 11,
  'minecraft:ochre_froglight': 15, 'minecraft:verdant_froglight': 15, 'minecraft:pearlescent_froglight': 15,
  'minecraft:lit_redstone_lamp': 15, 'minecraft:redstone_torch': 7, 'minecraft:lit_redstone_ore': 9, 'minecraft:lit_deepslate_redstone_ore': 9,
  'minecraft:lit_furnace': 13, 'minecraft:lit_blast_furnace': 13, 'minecraft:lit_smoker': 13,
  'minecraft:magma': 3, 'minecraft:crying_obsidian': 10, 'minecraft:enchanting_table': 7, 'minecraft:ender_chest': 7,
  'minecraft:glow_lichen': 7, 'minecraft:brewing_stand': 1, 'minecraft:brown_mushroom': 1, 'minecraft:dragon_egg': 1,
  'minecraft:end_portal_frame': 1, 'minecraft:sculk_sensor': 1, 'minecraft:calibrated_sculk_sensor': 1, 'minecraft:sculk_catalyst': 6,
  'minecraft:small_amethyst_bud': 1, 'minecraft:medium_amethyst_bud': 2, 'minecraft:large_amethyst_bud': 4, 'minecraft:amethyst_cluster': 5,
  'minecraft:cave_vines_body_with_berries': 14, 'minecraft:cave_vines_head_with_berries': 14, 'minecraft:firefly_bush': 2,
};
// 実機で自分・隣・その先まで測ったもの（それ以外の値は既知の値。違えば較正で上書きされる）
const LIGHT_EMIT_MEASURED = new $Set(['minecraft:torch', 'minecraft:redstone_torch', 'minecraft:soul_torch', 'minecraft:end_rod', 'minecraft:lantern', 'minecraft:glowstone', 'minecraft:sea_lantern', 'minecraft:beacon', 'minecraft:lava', 'minecraft:lit_furnace', 'minecraft:magma', 'minecraft:sea_pickle', 'minecraft:candle', 'minecraft:light_block_15', 'minecraft:furnace', 'minecraft:stone']);
const COPPER_BULB = { copper_bulb: 15, exposed_copper_bulb: 12, weathered_copper_bulb: 8, oxidized_copper_bulb: 4 };
function lightEmission(id, st) {
  const ml = M.light?.[id];
  if (ml && ml.emit !== undefined && !$Object.keys(st ?? {}).some((k) => /count|lit|charge|extinguished|powered|light_level/.test(k))) return ml.emit;
  st ??= {};
  let m = /^minecraft:light_block_(\d+)$/.exec(id);
  if (m) return +m[1];
  if (id === 'minecraft:light_block') return st.block_light_level ?? 15;
  if (id === 'minecraft:sea_pickle') return ((st.cluster_count ?? 0) + 1) * 3 + 3;
  if (/candle$/.test(id)) return st.lit ? ((st.candles ?? 0) + 1) * 3 : 0;
  if (/candle_cake$/.test(id)) return st.lit ? 3 : 0;
  if (id === 'minecraft:respawn_anchor') return [0, 3, 7, 11, 15][st.respawn_anchor_charge ?? 0] ?? 0;
  if (id === 'minecraft:campfire') return st.extinguished ? 0 : 15;
  if (id === 'minecraft:soul_campfire') return st.extinguished ? 0 : 10;
  m = /^minecraft:(?:waxed_)?((?:exposed_|weathered_|oxidized_)?copper_bulb)$/.exec(id);
  if (m) return st.lit ? COPPER_BULB[m[1]] : 0;
  return LIGHT_EMIT[id] ?? 0;
}
const LIGHT_DAMP_ICE = new $Set(['minecraft:ice', 'minecraft:frosted_ice']);
const LIGHT_DAMP_ONE = new $Set(['minecraft:water', 'minecraft:flowing_water', 'minecraft:sea_pickle', 'minecraft:kelp', 'minecraft:seagrass', 'minecraft:bubble_column']);
const lightInfoCache = new $Map();
/** [不透明か, 減らす量] */
function lightInfo(id) {
  let r = lightInfoCache.get(id);
  if (r) return r;
  const ml = M.light?.[id];
  const measured = M.blockComponents?.[id]?.light;
  let opaque;
  if (measured) opaque = measured[0] === 0;
  else if (id === 'minecraft:flowing_lava') opaque = true;
  else opaque = id !== 'minecraft:air' && Boolean(M.blocks[id]) && M.blocks[id].liquid?.[1] === true && !M.blocks[id].liquid?.[0] && !/glass|ice|slime|honey|web|snow|farmland|grass_path/.test(id);
  let damp = 0;
  if (!opaque) {
    if (ml && ml.damp !== undefined) damp = ml.damp;
    else if (id === 'minecraft:beacon') damp = 14;
    else if (LIGHT_DAMP_ICE.has(id)) damp = 3;
    else if (LIGHT_DAMP_ONE.has(id) || /leaves|coral_fan/.test(id) || (/_slab$|^minecraft:.*slab\d?$/.test(id) && !/double/.test(id))) damp = 1;
  }
  r = [opaque, damp];
  lightInfoCache.set(id, r);
  return r;
}
// 天気の強さ（Java と同じく 1 tick に 0.01 ずつ近づく）と、暗さ
const weatherLevel = {};
const wl = (dim) => (weatherLevel[dim] ??= { rain: DIMS[dim].weather === 'Clear' ? 0 : 1, thunder: DIMS[dim].weather === 'Thunder' ? 1 : 0 });
function celestial(t) {
  let f = F(F(t) / 24000 - 0.25);
  f = F(f - $Math.floor(f));
  const g = F(0.5 - F($Math.cos(F(f * F($Math.PI)))) / 2);
  return F(f + F((g - f) / 3));
}
function darkenAt(dim, t) {
  const a = celestial(((t % 24000) + 24000) % 24000);
  let d = F(1 - F(F($Math.cos(F(a * F($Math.PI * 2)))) * 2 + 0.5));
  d = $Math.min(1, $Math.max(0, d));
  d = F(1 - d);
  const w = wl(dim);
  d = F(d * F(1 - F(w.rain * 5) / 16));
  d = F(d * F(1 - F(w.thunder * 5) / 16));
  d = F(1 - d);
  return $Math.floor(F(d * 11));
}
const darken = {};
const darkenOf = (dim) => (darken[dim] ??= darkenAt(dim, G.timeOfDay + 1));
let lightVersion = 0;
END_HOOKS.push(() => {
  for (const dim of $Object.keys(DIMS)) {
    const w = wl(dim);
    const wantRain = DIMS[dim].weather === 'Clear' ? 0 : 1;
    const wantThunder = DIMS[dim].weather === 'Thunder' ? 1 : 0;
    w.rain = w.rain < wantRain ? $Math.min(wantRain, w.rain + 0.01) : $Math.max(wantRain, w.rain - 0.01);
    w.thunder = w.thunder < wantThunder ? $Math.min(wantThunder, w.thunder + 0.01) : $Math.max(wantThunder, w.thunder - 0.01);
    darken[dim] = darkenAt(dim, G.timeOfDay + 2);
  }
  if (lightPrev.size) { lightPrev.clear(); lightVersion++; }
});
const hasSky = (dim) => dim === 'minecraft:overworld';
function lightRead(dim, x, y, z) {
  const k = key(dim, x, y, z);
  const v = lightPrev.has(k) ? lightPrev.get(k) : blocks.get(k);
  return v ?? { id: natural(dim, x, y, z), states: null };
}
// 列ごとの「光を遮る・弱めるブロックの一番上」
let colTop = null;
let colVersion = -1;
function columnTop(dim, x, z) {
  if (colVersion !== lightVersion) {
    colTop = new $Map();
    colVersion = lightVersion;
    const put = (k, v) => {
      if (!v) return;
      const [opaque, damp] = lightInfo(v.id);
      if (!opaque && !damp) return;
      const [d, bx, by, bz] = k.split('|');
      const ck = `${d}|${bx}|${bz}`;
      const cur = colTop.get(ck);
      if (cur === undefined || +by > cur) colTop.set(ck, +by);
    };
    for (const [k, v] of blocks) if (!lightPrev.has(k)) put(k, v);
    for (const [k, v] of lightPrev) put(k, v);
  }
  const nat = GEN === 'flat' && dim === 'minecraft:overworld' ? -61 : -Infinity;
  const t = colTop.get(`${dim}|${x}|${z}`);
  return t === undefined ? nat : $Math.max(t, nat);
}
const LR = 15;
const LN = LR * 2 + 1;
const lightMemo = new $Map();
let lightMemoVersion = -1;
/** 生の明るさ [ブロックの光, 空の光]（暗さを引く前） */
function rawLight(dim, x, y, z) {
  if (lightMemoVersion !== lightVersion) { lightMemo.clear(); lightMemoVersion = lightVersion; }
  const mk = `${dim}|${x}|${y}|${z}`;
  const hit = lightMemo.get(mk);
  if (hit) return hit;
  const D = DIMS[dim];
  const n = LN * LN * LN;
  const op = new $Uint8Array(n);
  const dp = new $Uint8Array(n);
  const bl = new $Uint8Array(n);
  const sk = new $Uint8Array(n);
  const idx = (i, j, k) => (i * LN + j) * LN + k;
  const qb = [];
  const qs = [];
  for (let v = 0; v <= 15; v++) { qb.push([]); qs.push([]); }
  for (let i = 0; i < LN; i++) {
    const bx = x - LR + i;
    for (let k = 0; k < LN; k++) {
      const bz = z - LR + k;
      for (let j = 0; j < LN; j++) {
        const by = y - LR + j;
        const c = idx(i, j, k);
        if (by < D.min) { op[c] = 1; continue; }
        if (by >= D.max) continue;
        const b = lightRead(dim, bx, by, bz);
        if (b.id === 'minecraft:air') continue;
        const [o, dmp] = lightInfo(b.id);
        op[c] = o ? 1 : 0;
        dp[c] = dmp;
        const e = lightEmission(b.id, b.states);
        if (e > 0) { bl[c] = e; qb[e].push(c); }
      }
      // 真上が空まで開いている列は、箱の一番上から空の光が入る
      if (hasSky(dim)) {
        const topY = y + LR;
        if (columnTop(dim, bx, bz) < topY + 1 || topY + 1 >= D.max) {
          const c = idx(i, LN - 1, k);
          if (!op[c]) { const v = 15 - dp[c]; sk[c] = v; qs[v].push(c); }
        }
      }
    }
  }
  const spread = (val, q, sky) => {
    for (let v = 15; v > 0; v--) {
      const list = q[v];
      for (let p = 0; p < list.length; p++) {
        const c = list[p];
        if (val[c] !== v) continue;
        const k = c % LN;
        const j = ((c - k) / LN) % LN;
        const i = (c - k - j * LN) / (LN * LN);
        for (let dir = 0; dir < 6; dir++) {
          let ni = i; let nj = j; let nk = k;
          if (dir === 0) ni--; else if (dir === 1) ni++; else if (dir === 2) nj--; else if (dir === 3) nj++; else if (dir === 4) nk--; else nk++;
          if (ni < 0 || nj < 0 || nk < 0 || ni >= LN || nj >= LN || nk >= LN) continue;
          const nc = idx(ni, nj, nk);
          if (op[nc]) continue;
          const nv = sky && dir === 2 && v === 15 ? 15 - dp[nc] : v - $Math.max(1, dp[nc]);
          if (nv > val[nc]) { val[nc] = nv; q[nv].push(nc); }
        }
      }
    }
  };
  spread(bl, qb, false);
  spread(sk, qs, true);
  const c0 = idx(LR, LR, LR);
  const r = [op[c0] ? 0 : bl[c0], op[c0] ? 0 : sk[c0]];
  if (lightMemo.size > 4096) lightMemo.clear();
  lightMemo.set(mk, r);
  return r;
}
const softNI = (what) => notImplemented(new SandboxNotImplemented(what));
const skyCheck = (dim) => {
  if (dim === 'minecraft:the_end' || DIMS[dim].custom) softNI(`${dim} の空の光（測っていません）`);
};
function lightQuery(dim, loc, which) {
  const x = $Math.floor(loc.x);
  const y = $Math.floor(loc.y);
  const z = $Math.floor(loc.z);
  const D = DIMS[dim];
  if (!chunkLoaded(dim, x, z)) {
    if (which !== 'all') softNI('読み込まれていない場所の getSkyLightLevel（測っていません）');
    return 15;
  }
  const dk = hasSky(dim) ? darkenOf(dim) : 0;
  skyCheck(dim);
  if (y >= D.max) return hasSky(dim) ? 15 - dk : 0;
  if (y < D.min) { softNI('世界より下の明るさ（測っていません）'); return 0; }
  const live = readBlock(dim, x, y, z);
  if (which === 'all' && lightInfo(live.id)[0]) return 0;
  const [b, s] = rawLight(dim, x, y, z);
  const sky = $Math.max(0, s - dk);
  return which === 'sky' ? sky : $Math.max(b, sky);
}
$Object.assign(IMPL.Dimension.fns, {
  getLightLevel: (h, loc) => lightQuery(h.dim, loc, 'all'),
  getSkyLightLevel: (h, loc) => lightQuery(h.dim, loc, 'sky'),
});
$Object.assign(IMPL.Block.fns, {
  getLightLevel: (h) => { assertLoaded(h); return lightQuery(h.dim, h.p, 'all'); },
  getSkyLightLevel: (h) => { assertLoaded(h); return lightQuery(h.dim, h.p, 'sky'); },
});
