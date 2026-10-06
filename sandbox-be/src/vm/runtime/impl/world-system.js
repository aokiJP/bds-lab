// 実装: World / System（IMPL にクラスごとの中身を足していく。続きは dimension-block → entity → items-scoreboard）

// ---- 実装 -----------------------------------------------------------------

const volumeOf = (h) => {
  if (h.from) {
    const lo = { x: $Math.min(h.from.x, h.to.x), y: $Math.min(h.from.y, h.to.y), z: $Math.min(h.from.z, h.to.z) };
    const hi = { x: $Math.max(h.from.x, h.to.x), y: $Math.max(h.from.y, h.to.y), z: $Math.max(h.from.z, h.to.z) };
    return { lo, hi, list: null };
  }
  return { lo: null, hi: null, list: h.list };
};
function* volumeIter(h) {
  const v = volumeOf(h);
  if (v.list) { for (const p of v.list) yield p; return; }
  for (let x = v.lo.x; x <= v.hi.x; x++) for (let y = v.lo.y; y <= v.hi.y; y++) for (let z = v.lo.z; z <= v.hi.z; z++) yield { z, y, x };
}
const iterObj = (gen) => inst('BlockLocationIterator', { gen });

function objectiveObj(o) {
  o._h ??= { o, valid: () => o.valid, invalidError: () => fail('Error', `Failed to find objective '${o.id}'.`) };
  return once('ScoreboardObjective', o._h);
}
function identityObj(i) {
  i._h ??= { i };
  return once('ScoreboardIdentity', i._h);
}
function participant(p) {
  if (typeof p === 'string') return identityFor(p);
  const h = H.get(p);
  if (h?.i) return h.i;
  if (h?.e) return identityFor(h.e);
  throw fail('Error', '参加者を解釈できません');
}
// 読むだけの参加者（作らない）。実機（BDS 1.26.52.3）: まだ一度もスコアを持たないエンティティは getScore で
// "Failed to resolve identity for 'A'." を投げ、hasParticipant は false。setScore / addScore で初めて参加者になる
function knownParticipant(p) {
  if (typeof p === 'string') return [...identities.values()].find((x) => x.type === 'FakePlayer' && x.name === p) ?? null;
  const h = H.get(p);
  if (h?.i) return h.i;
  if (h?.e) return [...identities.values()].find((x) => x.entityId === h.e.id) ?? null;
  throw fail('Error', '参加者を解釈できません');
}
function participantLabel(p) {
  if (typeof p === 'string') return p;
  const h = H.get(p);
  return h?.e ? (h.e.player ? h.e.name : $String(h.e.id)) : $String(p);
}

$Object.assign(IMPL, {
  World: {
    fns: {
      getDimension(h, id) {
        const d = dimId(id);
        if (!d) throw fail('Error', `Dimension '${id}' is invalid.`);
        return dimObj(d);
      },
      getPlayers(h, opts) { return query(opts, { players: true }).map(entityObj); },
      getAllPlayers() { return query({}, { players: true }).map(entityObj); },
      getEntity(h, id) { const e = entities.get($String(id)); return e && e.valid ? entityObj(e) : undefined; },
      sendMessage(h, m) { say('@a', m); },
      getTimeOfDay() { return G.timeOfDay; },
      // 実測: 時刻を指定すると「次にその時刻になるところ」まで進む（戻らない）。
      // そのぶん通算の時刻（getAbsoluteTime）と日数（getDay）も増える
      setTimeOfDay(h, t) {
        // 実測: TimeOfDay は数の列挙なので、文字列は受け付けない
        if (typeof t !== 'number') throw new $TypeError('Native variant type conversion failed. Function argument [0] expected type: number | TimeOfDay');
        if (t < 0 || t >= 24000) throw fail('Error', 'timeOfDay must be between 0 and 23999 (inclusive).');
        const to = $Math.floor(t);
        G.absoluteTime += ((to - (G.absoluteTime % 24000)) % 24000 + 24000) % 24000;
        G.timeOfDay = to;
      },
      getAbsoluteTime() { return G.absoluteTime; },
      getDay() { return $Math.floor(G.absoluteTime / 24000); },
      // 実測: 月の満ち欠けは日数を 8 で割った余り
      getMoonPhase() { return (($Math.floor(G.absoluteTime / 24000) % 8) + 8) % 8; },
      getDifficulty() { return G.difficulty; },
      setDifficulty(h, d) { G.difficulty = d; },
      getDefaultSpawnLocation() { return Vec(G.spawn); },
      setDefaultSpawnLocation(h, v) {
        const d = DIMS['minecraft:overworld'];
        if (v.y < d.min || v.y >= d.max) throw fail('LocationOutOfWorldBoundariesError', `Failed to set the default spawn location. Trying to access location ${locText(v)} which is outside of the world boundaries.`);
        G.spawn = Vec(v);
      },
      getDynamicProperty(h, k) { return G.dyn.get(k); },
      setDynamicProperty(h, k, v) { dynCheck(k, v); if (v === undefined) G.dyn.delete(k); else G.dyn.set(k, typeof v === 'object' ? Vec(v) : v); },
      getDynamicPropertyIds() { return [...G.dyn.keys()]; },
      getDynamicPropertyTotalByteCount() { return dynBytes(G.dyn); },
      clearDynamicProperties() { G.dyn.clear(); },
      playMusic(h, id, o) { S.effects.push({ tick: S.tick, kind: 'music', id, options: o }); },
      queueMusic(h, id, o) { S.effects.push({ tick: S.tick, kind: 'music.queue', id, options: o }); },
      stopMusic() { S.effects.push({ tick: S.tick, kind: 'music.stop' }); },
      playSound(h, id, loc, o) { S.effects.push({ tick: S.tick, kind: 'sound', id, location: Vec(loc), options: o }); },
    },
    get: {
      afterEvents: () => once('WorldAfterEvents', HW.after),
      beforeEvents: () => once('WorldBeforeEvents', HW.before),
      scoreboard: () => once('Scoreboard', HW.scoreboard),
      gameRules: () => once('GameRules', HW.gameRules),
      structureManager: () => { bump(S.unsupported, 'World.structureManager'); throw new SandboxNotImplemented('world.structureManager'); },
    },
  },
  WorldAfterEvents: { get: {} },
  WorldBeforeEvents: { get: {} },
  SystemAfterEvents: { get: {} },
  SystemBeforeEvents: { get: {} },
  GameRules: { get: {}, set: {} },
  System: {
    fns: {
      run(h, fn) { return schedule(fn, 0, 0, 'system.run'); },
      runTimeout(h, fn, d) { return schedule(fn, d ?? 1, 0, 'system.runTimeout'); },
      runInterval(h, fn, d) { const n = $Math.max(1, d ?? 1); return schedule(fn, n, n, 'system.runInterval'); },
      clearRun(h, id) { runs.delete(id); },
      runJob(h, gen) {
        if (!gen || typeof gen.next !== 'function') throw new $TypeError('Native type conversion failed. Function argument [0] expected type: Generator');
        const id = nextRun++;
        jobs.set(id, { gen, created: S.tick });
        return id;
      },
      clearJob(h, id) { jobs.delete(id); },
      waitTicks(h, n) {
        return new $Promise((resolve) => { waits.push({ due: S.tick + n, resolve }); });
      },
      sendScriptEvent(h, id, message) {
        checkNamespace(id);
        fireAfter('system.afterEvents', 'scriptEventReceive', { id, message, sourceType: 'Server' });
      },
    },
    get: {
      currentTick: () => S.tick,
      afterEvents: () => once('SystemAfterEvents', HS.after),
      beforeEvents: () => once('SystemBeforeEvents', HS.before),
      isEditorWorld: () => false,
      serverSystemInfo: () => once('SystemInfo', (HS.sysinfo ??= {})),
    },
  },
});
