// 実装: Dimension / Block / BlockPermutation / 種類 / BlockVolume

$Object.assign(IMPL, {
  Dimension: {
    fns: {
      getBlock(h, loc) {
        const p = checkLoc(h.dim, loc, { unloaded: 'undefined' });
        return p ? blockObj(h.dim, p) : undefined;
      },
      // 実測: 指定した場所そのものから数えて、上（下）へ向かって最初に見つかった
      // 「空気でない（条件に合う）」ブロックを返す
      getBlockAbove(h, loc, o) { return scanBlock(h.dim, loc, 1, o); },
      getBlockBelow(h, loc, o) { return scanBlock(h.dim, loc, -1, o); },
      getTopmostBlock(h, loc, minY) {
        const x = $Math.floor(loc.x);
        const z = $Math.floor(loc.z);
        if (!chunkLoaded(h.dim, x, z)) return undefined;
        const d = DIMS[h.dim];
        for (let y = d.max - 1; y >= (minY ?? d.min); y--) {
          if (readBlock(h.dim, x, y, z).id !== 'minecraft:air') return blockObj(h.dim, { x, y, z });
        }
        return undefined;
      },
      setBlockType(h, loc, type) {
        const p = checkLoc(h.dim, loc, { outside: 'skip' });
        const perm = toPerm(type);
        if (p) writeBlock(h.dim, p.x, p.y, p.z, perm);
      },
      setBlockPermutation(h, loc, perm) {
        const p = checkLoc(h.dim, loc, { outside: 'skip' });
        const pp = toPerm(perm);
        if (p) writeBlock(h.dim, p.x, p.y, p.z, pp);
      },
      isChunkLoaded(h, loc) { return chunkLoaded(h.dim, $Math.floor(loc.x), $Math.floor(loc.z)); },
      fillBlocks(h, volume, block, opts) {
        const vh = H.get(volume);
        const perm = toPerm(block);
        const filter = opts?.blockFilter;
        const out = [];
        const pts = [...volumeIter(vh)];
        const unloaded = pts.filter((p) => !chunkLoaded(h.dim, p.x, p.z));
        if (unloaded.length && !opts?.ignoreChunkBoundErrors) throw fail('UnloadedChunksError', `範囲の ${unloaded.length} マスが未読み込みの区画にあります`);
        for (const p of pts) {
          const d = DIMS[h.dim];
          if (p.y < d.min || p.y >= d.max) throw outsideErr(p);
          if (!chunkLoaded(h.dim, p.x, p.z)) continue;
          const cur = readBlock(h.dim, p.x, p.y, p.z);
          if (filter && !matchFilter(cur, filter)) continue;
          // 実機: もう同じブロックのところは数えない
          if (cur.id === perm.id && $JSON.stringify(cur.states) === $JSON.stringify(perm.states)) continue;
          writeBlock(h.dim, p.x, p.y, p.z, perm);
          out.push(p);
        }
        return inst('ListBlockVolume', { list: out });
      },
      containsBlock(h, volume, filter) {
        for (const p of volumeIter(H.get(volume))) {
          if (chunkLoaded(h.dim, p.x, p.z) && matchFilter(readBlock(h.dim, p.x, p.y, p.z), filter)) return true;
        }
        return false;
      },
      getBlocks(h, volume, filter, allowUnloaded) {
        const out = [];
        for (const p of volumeIter(H.get(volume))) {
          if (!chunkLoaded(h.dim, p.x, p.z)) {
            if (!allowUnloaded) throw fail('UnloadedChunksError', `(${p.x}, ${p.z}) の区画が未読み込みです`);
            continue;
          }
          if (matchFilter(readBlock(h.dim, p.x, p.y, p.z), filter)) out.push(p);
        }
        return inst('ListBlockVolume', { list: out });
      },
      getEntities(h, opts) { return query(opts, { dim: h.dim }).map(entityObj); },
      getEntitiesAtBlockLocation(h, loc) {
        const x = $Math.floor(loc.x); const y = $Math.floor(loc.y); const z = $Math.floor(loc.z);
        return query({}, { dim: h.dim }).filter((e) => $Math.floor(e.loc.x) === x && $Math.floor(e.loc.y) === y && $Math.floor(e.loc.z) === z).map(entityObj);
      },
      getPlayers(h, opts) { return query(opts, { dim: h.dim, players: true }).map(entityObj); },
      spawnEntity(h, type, loc, opts) {
        const given = typeof type === 'string' ? type : H.get(type)?.data?.id;
        // 実測: 識別子に <イベント> を書く古い書き方は、引数 [2] のエラーになる
        if (typeof given === 'string' && /<[^>]*>/.test(given)) throw fail('InvalidArgumentError', 'Invalid value passed to argument [2]. Invalid identifier: Spawn event set via the entity identifier is deprecated, use spawnEvent in SpawnEntityOptions instead.');
        const id = typeof type === 'string' ? entityTypeId(type) : given;
        if (!id) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. '${given}' is not a valid entity type.`);
        if (!summonable(id)) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. '${given}' is not summonable (is_summonable is set to false in the entity definition file).`);
        checkLoc(h.dim, loc);
        const e = spawn(id, h.dim, loc, opts?.spawnEvent ? { spawnCause: 'Event' } : {});
        if (opts?.spawnEvent === 'minecraft:entity_born' || opts?.spawnEvent === 'minecraft:as_baby') e.baby = true;
        return entityObj(e);
      },
      spawnItem(h, item, loc) {
        checkLoc(h.dim, loc);
        const ih = H.get(item);
        const e = spawn('minecraft:item', h.dim, loc);
        e.item = copyItem(ih.it);
        return entityObj(e);
      },
      runCommand(h, cmd) { return runCommand({ dim: h.dim, pos: { x: 0, y: 0, z: 0 }, entity: null }, cmd); },
      getWeather(h) { return DIMS[h.dim].weather; },
      setWeather(h, w, dur) {
        const prev = DIMS[h.dim].weather;
        DIMS[h.dim].weather = w;
        void dur;
        if (prev !== w) fireAfter('world.afterEvents', 'weatherChange', { dimension: h.dim.slice(10), newWeather: w, previousWeather: prev });
      },
      playSound(h, id, loc, o) { S.effects.push({ tick: S.tick, kind: 'sound', id, dimension: h.dim, location: Vec(loc), options: o }); },
    },
    get: {
      id: (h) => h.dim,
      // NumberRange はインターフェース（ただのオブジェクト）。max は上限を含まない値（実測）
      heightRange: (h) => ({ max: DIMS[h.dim].max, min: DIMS[h.dim].min }),
      localizationKey: (h) => `dimension.dimensionName${{ 'minecraft:overworld': 0, 'minecraft:nether': 1, 'minecraft:the_end': 2 }[h.dim] ?? 0}`,
    },
  },
  Block: {
    fns: {
      setType(h, t) { assertLoaded(h); writeBlock(h.dim, h.p.x, h.p.y, h.p.z, toPerm(t)); },
      setPermutation(h, perm) { assertLoaded(h); writeBlock(h.dim, h.p.x, h.p.y, h.p.z, toPerm(perm)); },
      matches(h, id, states) {
        assertLoaded(h);
        const cur = readBlock(h.dim, h.p.x, h.p.y, h.p.z);
        if (cur.id !== blockTypeId(id)) return false;
        return !states || $Object.entries(states).every(([k, v]) => cur.states[k] === v);
      },
      above(h, n = 1) { return offsetBlock(h, 0, n, 0); },
      below(h, n = 1) { return offsetBlock(h, 0, -n, 0); },
      north(h, n = 1) { return offsetBlock(h, 0, 0, -n); },
      south(h, n = 1) { return offsetBlock(h, 0, 0, n); },
      east(h, n = 1) { return offsetBlock(h, n, 0, 0); },
      west(h, n = 1) { return offsetBlock(h, -n, 0, 0); },
      offset(h, o) { return offsetBlock(h, o.x, o.y, o.z); },
      center(h) { return { z: h.p.z + 0.5, y: h.p.y + 0.5, x: h.p.x + 0.5 }; },
      bottomCenter(h) { return { z: h.p.z + 0.5, y: h.p.y, x: h.p.x + 0.5 }; },
      getComponent(h, id) { void id; return undefined; },
      getTags(h) { void h; return []; },
      hasTag(h, t) { void t; return false; },
      getItemStack(h, amount = 1) {
        const cur = readBlock(h.dim, h.p.x, h.p.y, h.p.z);
        if (cur.id === 'minecraft:air' || !itemId(cur.id)) return undefined;
        return itemObj({ typeId: cur.id, amount, lore: [] });
      },
      canPlace(h, perm) { void perm; return readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === 'minecraft:air'; },
    },
    get: {
      dimension: (h) => dimObj(h.dim),
      location: (h) => Vec(h.p),
      x: (h) => h.p.x,
      y: (h) => h.p.y,
      z: (h) => h.p.z,
      isValid: (h) => chunkLoaded(h.dim, h.p.x, h.p.z),
      typeId: (h) => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id,
      type: (h) => blockTypeObj(readBlock(h.dim, h.p.x, h.p.y, h.p.z).id),
      permutation: (h) => permObj(readBlock(h.dim, h.p.x, h.p.y, h.p.z)),
      isAir: (h) => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === 'minecraft:air',
      isLiquid: (h) => /water|lava/.test(readBlock(h.dim, h.p.x, h.p.y, h.p.z).id),
      isWaterlogged: () => false,
      localizationKey: (h) => `tile.${readBlock(h.dim, h.p.x, h.p.y, h.p.z).id.slice(10)}.name`,
      redstonePower: () => 0,
    },
  },
  BlockPermutation: {
    static: {
      resolve(h, id, states) {
        const full = blockTypeId(id);
        if (!full) throw fail('Error', `Failed to resolve block "${id}".`);
        return permObj(makePerm(full, states));
      },
    },
    fns: {
      getState(h, k) { return h.perm.states[k]; },
      getAllStates(h) { return { ...h.perm.states }; },
      withState(h, k, v) {
        // 実測: そのブロックに無い状態名を渡すとエラーになる（型違いはそのまま通る）
        if (!(k in (M.blocks[h.perm.id]?.states ?? h.perm.states ?? {}))) throw fail('Error', `Failed to set block state ${k}`);
        return permObj(makePerm(h.perm.id, { ...h.perm.states, [k]: v }));
      },
      matches(h, id, states) {
        if (h.perm.id !== blockTypeId(id)) return false;
        return !states || $Object.entries(states).every(([k, v]) => h.perm.states[k] === v);
      },
      getTags() { return []; },
      hasTag() { return false; },
      getItemStack(h, amount = 1) { return itemId(h.perm.id) ? itemObj({ typeId: h.perm.id, amount, lore: [] }) : undefined; },
      isLiquidBlocking() { return false; },
      canContainLiquid() { return false; },
      canBeDestroyedByLiquidSpread() { return false; },
      isPartOfLiquidRendering() { return false; },
    },
    get: {
      type: (h) => blockTypeObj(h.perm.id),
    },
  },
  BlockType: { get: { id: (h) => h.id } },
  BlockTypes: {
    static: {
      get(h, id) { const f = blockTypeId(id); return f ? blockTypeObj(f) : undefined; },
      // 実測の一覧（実機の並び順）。無いときだけ公式メタデータに戻る
      getAll() { return $Object.keys($Object.keys(M.blocks).length ? M.blocks : VANILLA.blocks).map(blockTypeObj); },
    },
  },
  ItemType: { get: { id: (h) => h.id } },
  ItemTypes: {
    static: {
      get(h, id) { const f = itemId(id); return f ? itemTypeObj(f) : undefined; },
      getAll() { return VANILLA.items.map(itemTypeObj); },
    },
  },
  EntityTypes: {
    static: {
      get(h, id) { const f = entityTypeId(id); return f ? once('EntityType', (hEntityType[f] ??= { data: { id: f } })) : undefined; },
      getAll() { return VANILLA.entities.map((f) => once('EntityType', (hEntityType[f] ??= { data: { id: f } }))); },
    },
  },
  BlockVolumeBase: {
    fns: {
      getBlockLocationIterator(h) { return iterObj(volumeIter(h)); },
      getCapacity(h) { const v = volumeOf(h); return v.list ? v.list.length : (v.hi.x - v.lo.x + 1) * (v.hi.y - v.lo.y + 1) * (v.hi.z - v.lo.z + 1); },
      getMin(h) { const v = volumeOf(h); return v.list ? minOf(v.list) : Vec(v.lo); },
      getMax(h) { const v = volumeOf(h); return v.list ? maxOf(v.list) : Vec(v.hi); },
      getSpan(h) {
        const a = this.getMin();
        const b = this.getMax();
        return { z: b.z - a.z + 1, y: b.y - a.y + 1, x: b.x - a.x + 1 };
      },
      isInside(h, p) {
        const v = volumeOf(h);
        const q = { x: $Math.floor(p.x), y: $Math.floor(p.y), z: $Math.floor(p.z) };
        if (v.list) return v.list.some((x) => x.x === q.x && x.y === q.y && x.z === q.z);
        return ['x', 'y', 'z'].every((k) => q[k] >= v.lo[k] && q[k] <= v.hi[k]);
      },
      translate(h, d) {
        if (h.list) h.list = h.list.map((p) => ({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }));
        else { h.from = { x: h.from.x + d.x, y: h.from.y + d.y, z: h.from.z + d.z }; h.to = { x: h.to.x + d.x, y: h.to.y + d.y, z: h.to.z + d.z }; }
      },
    },
  },
  BlockVolume: {
    ctor(from, to) { return { from: Vec(from), to: Vec(to) }; },
    get: { from: (h) => Vec(h.from), to: (h) => Vec(h.to) },
    set: { from: (h, v) => { h.from = Vec(v); }, to: (h, v) => { h.to = Vec(v); } },
    fns: {
      // 実測: 「面に触れている」= その場所が、体積の面の上（内側のふち）にあるか、
      // 面の外側にぴったり 1 マスだけくっついているか（斜めは触れていない扱い）
      doesLocationTouchFaces(h, p) {
        const v = volumeOf(h);
        const K = ['x', 'y', 'z'];
        const q = { x: $Math.floor(p.x), y: $Math.floor(p.y), z: $Math.floor(p.z) };
        let outside = 0;
        for (const k of K) {
          if (q[k] < v.lo[k] - 1 || q[k] > v.hi[k] + 1) return false;
          if (q[k] === v.lo[k] - 1 || q[k] === v.hi[k] + 1) outside++;
        }
        if (outside > 1) return false; // 辺や角ごしは触れていない
        if (outside === 1) return true; // 面の外側にぴったり付いている
        return K.some((k) => q[k] === v.lo[k] || q[k] === v.hi[k]); // 内側のふち
      },
      // 実測: 相手が丸ごと内側にあって、かつ
      //   ・その軸で薄い板になっていて面に乗っている、または
      //   ・面に接していて、別の軸では端から端まで届いている
      // とき true（25 通りを実機で測って決めた）
      doesVolumeTouchFaces(h, o) {
        // 実機（1.26.51）はこの関数の答えが体積の x 座標によって変わる（不具合とみられる）。
        // ここでは x が 0 付近にあるときの実機の答え（25 通りを実測）に合わせている
        bump(S.unsupported, 'BlockVolume.doesVolumeTouchFaces（実機は x 座標で答えが変わるため、x=0 付近の実機の答えに合わせています）');
        const a = volumeOf(h);
        const b = volumeOf(H.get(o));
        const K = ['x', 'y', 'z'];
        if (!b.lo) return false;
        if (!K.every((k) => b.lo[k] >= a.lo[k] && b.hi[k] <= a.hi[k])) return false;
        return K.some((k) => {
          if (b.lo[k] !== a.lo[k] && b.hi[k] !== a.hi[k]) return false;
          if (b.lo[k] === b.hi[k]) return true;
          return K.some((j) => j !== k && b.lo[j] === a.lo[j] && b.hi[j] === a.hi[j]);
        });
      },
      intersects(h, o) {
        const a = volumeOf(h);
        const b = volumeOf(H.get(o));
        if (!b.lo) return 0; // Disjoint
        const dis = ['x', 'y', 'z'].some((k) => a.hi[k] < b.lo[k] || b.hi[k] < a.lo[k]);
        if (dis) return 0; // Disjoint
        // 実測: Contains は「こちらが相手を丸ごと含んでいる」とき（同じ大きさも含む）
        const bInA = ['x', 'y', 'z'].every((k) => b.lo[k] >= a.lo[k] && b.hi[k] <= a.hi[k]);
        if (bInA) return 1; // Contains
        return 2; // Intersects
      },
    },
  },
  ListBlockVolume: {
    ctor(list) { return { list: list.map(Vec) }; },
    fns: {
      add(h, list) { h.list.push(...list.map(Vec)); },
      remove(h, list) { h.list = h.list.filter((p) => !list.some((q) => q.x === p.x && q.y === p.y && q.z === p.z)); },
    },
  },
});
