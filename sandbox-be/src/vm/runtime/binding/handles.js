// ハンドル（API のオブジェクト）の作り方

// ---- ハンドルの作り方 -------------------------------------------------------

// 実機が返す Vector3 はキーが z, y, x の順（JSON.stringify で見える）
const Vec = (v) => ({ z: v.z, y: v.y, x: v.x });

function hEntity(e) {
  if (!e._h) e._h = { e, valid: () => e.valid };
  return e._h;
}
const entityObj = (e) => once(e.player ? 'Player' : 'Entity', hEntity(e));
const hDim = {};
const dimObj = (id) => { hDim[id] ??= { dim: id }; return once('Dimension', hDim[id]); };
function blockObj(dim, p) {
  return inst('Block', { dim, p, valid: () => chunkLoaded(dim, p.x, p.z) });
}
const permObj = (perm) => inst('BlockPermutation', { perm });
const blockTypeObj = (id) => once('BlockType', (hBlockType[id] ??= { id }));
const hBlockType = {};
const itemTypeObj = (id) => once('ItemType', (hItemType[id] ??= { id }));
const hItemType = {};

/** 実機の名前空間チェック（文言も実機どおり） */
function checkNamespace(name) {
  const s = $String(name);
  const i = s.indexOf(':');
  if (i <= 0) throw fail('NamespaceNameError', `There was an error with name '${s}': string must be prefixed with a namespace (eg. namespace:value).`);
  if (s.slice(0, i) === 'minecraft') throw fail('NamespaceNameError', `There was an error with name '${s}': string has invalid namespace (minecraft).`);
  return s;
}

// 向きは float32 で持ち、yaw は [-180, 180) に丸める（実測: 180 → -180）
// 実機（BDS 1.26.51.1）は、上下・左右のどちらの角度も同じ「180 を足して 360 で割った余り、から 180 を引く」
// 処理に通す。float で 180 を足すところで丸めが起きるため、返る値は約 1/65536 度きざみになる。
// 上下の角度は 90 度で止めない（実測: 91 はそのまま、181 は -179 になる）。
// 実機で測った 14,642 件（設定・読み直し・lookAt・範囲外）すべてと一致する。
const DEG_PER_RAD = F(180 / F($Math.PI)); // 57.2957763671875
function wrapDeg(v) {
  let t = F(F(v) + 180);
  t = F(t % 360);
  if (t < 0) t = F(t + 360);
  return F(t - 180);
}
function normRot(pitch, yaw) {
  return { x: wrapDeg(pitch), y: wrapDeg(yaw) };
}
// 実機の視線ベクトル（BDS の値に 18 成分中 14 成分がビット単位で一致。残りは 1e-7 程度の差）
function viewDir(rot) {
  // 角度は float に丸めてから π を引く。最後に長さで割る（実測）
  const a = F(F(-rot.y * F_DEG) - F_PI);
  const b = F(-rot.x * F_DEG);
  const f2 = -mceCos(b);
  const x = F(mceSin(a) * f2);
  const y = mceSin(b);
  const z = F(mceCos(a) * f2);
  const len = F(Math.sqrt(F(F(F(x * x) + F(y * y)) + F(z * z))));
  return { z: F(z / len), y: F(y / len), x: F(x / len) };
}


// 動的プロパティの大きさ（実測）: キーの UTF-8 長 + 値（文字列 = UTF-8 長 + 2、数値 = 9、真偽 = 2、ベクトル = 13）
const utf8Len = (str) => { let n = 0; for (const ch of $String(str)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
const dynValueSize = (v) => (typeof v === 'string' ? utf8Len(v) + 2 : typeof v === 'number' ? 9 : typeof v === 'boolean' ? 2 : 13);
const dynBytes = (entries) => { let n = 0; for (const [k, v] of entries) n += utf8Len(k) + dynValueSize(v); return n; };
function dynCheck(k, v) {
  if (typeof v === 'string' && utf8Len(v) > 32767) throw fail('ArgumentOutOfBoundsError', `Unsupported or out of bounds value passed to function argument [0]: String length for dynamic property '${k}', Value: ${utf8Len(v)}, Argument max: 32767`);
  if (typeof v === 'number' && !$isFinite(v)) throw new $TypeError('Native variant type conversion failed.');
}

function toPerm(v) {
  if (typeof v === 'string') {
    const id = blockTypeId(v);
    if (!id) throw fail('Error', `Block type ${v} not found.`);
    return makePerm(id);
  }
  const h = H.get(v);
  if (h?.perm) return h.perm;
  if (h?.id) return makePerm(h.id);
  throw fail('Error', 'ブロックを解釈できません');
}

// エンティティの問い合わせ（EntityQueryOptions）
function query(opts = {}, { dim = null, players = false } = {}) {
  let list = [...entities.values()].filter((e) => e.valid && (!players || (e.player && e.joined)) && (!dim || e.dim === dim) && (!e.player || e.joined));
  const o = opts ?? {};
  const has = (x) => x !== undefined && x !== null;
  if (has(o.type)) list = list.filter((e) => e.typeId === (entityTypeId(o.type) ?? o.type));
  if (has(o.excludeTypes)) list = list.filter((e) => !o.excludeTypes.map((t) => entityTypeId(t) ?? t).includes(e.typeId));
  if (has(o.families)) list = list.filter((e) => o.families.every((f) => (famOf(e) ?? []).includes(f)));
  if (has(o.excludeFamilies)) list = list.filter((e) => !o.excludeFamilies.some((f) => (famOf(e) ?? []).includes(f)));
  if (has(o.name)) list = list.filter((e) => (e.player ? e.name : e.nameTag) === o.name);
  if (has(o.excludeNames)) list = list.filter((e) => !o.excludeNames.includes(e.player ? e.name : e.nameTag));
  if (has(o.tags)) list = list.filter((e) => o.tags.every((t) => e.tags.has(t)));
  if (has(o.excludeTags)) list = list.filter((e) => !o.excludeTags.some((t) => e.tags.has(t)));
  if (has(o.gameMode)) list = list.filter((e) => e.player && e.gameMode === o.gameMode);
  if (has(o.excludeGameModes)) list = list.filter((e) => !(e.player && o.excludeGameModes.includes(e.gameMode)));
  if (has(o.scoreOptions)) {
    list = list.filter((e) => o.scoreOptions.every((so) => {
      const obj = objectives.get(so.objective);
      if (!obj) return false;
      const i = [...identities.values()].find((x) => x.entityId === e.id);
      const v = i ? obj.scores.get(i.id) : undefined;
      if (v === undefined) return false;
      const inRange = (so.minScore === undefined || v >= so.minScore) && (so.maxScore === undefined || v <= so.maxScore);
      return so.exclude ? !inRange : inRange;
    }));
  }
  if (o.closest === 0 || o.farthest === 0) throw fail('CommandError', 'Error occurred with parsing command params: Entity count cannot be 0');
  const at = o.location;
  const dist = (e) => $Math.sqrt((e.loc.x - at.x) ** 2 + (e.loc.y - at.y) ** 2 + (e.loc.z - at.z) ** 2);
  if (has(at)) {
    if (has(o.maxDistance)) list = list.filter((e) => dist(e) <= o.maxDistance);
    if (has(o.minDistance)) list = list.filter((e) => dist(e) >= o.minDistance);
    if (has(o.volume)) {
      list = list.filter((e) => ['x', 'y', 'z'].every((k) => e.loc[k] >= $Math.min(at[k], at[k] + o.volume[k]) && e.loc[k] <= $Math.max(at[k], at[k] + o.volume[k]) + 1));
    }
    if (has(o.closest)) list = list.sort((a, b) => dist(a) - dist(b)).slice(0, o.closest);
    else if (has(o.farthest)) list = list.sort((a, b) => dist(b) - dist(a)).slice(0, o.farthest);
  } else if ((has(o.closest) || has(o.farthest) || has(o.maxDistance)) && list.length) {
    // 基準点が無いと実機はワールドの原点を基準にする
    const at0 = { x: 0, y: 0, z: 0 };
    const d0 = (e) => (e.loc.x - at0.x) ** 2 + (e.loc.y - at0.y) ** 2 + (e.loc.z - at0.z) ** 2;
    if (has(o.closest)) list = list.sort((a, b) => d0(a) - d0(b)).slice(0, o.closest);
    if (has(o.farthest)) list = list.sort((a, b) => d0(b) - d0(a)).slice(0, o.farthest);
  }
  return list;
}

function spawn(typeId, dim, loc, extra = {}) {
  const { spawnCause, ...rest } = extra;
  const e = newEntity({ typeId, dimension: dim, location: Vec(loc), ...rest });
  e.joined = true;
  // 実測: spawnEvent を指定して湧かせると cause は Event、指定しなければ Spawned
  fireAfter('world.afterEvents', 'entitySpawn', { entity: entityObj(e), cause: spawnCause ?? 'Spawned' });
  return e;
}

// 実機: 死んだエンティティは死亡アニメーションの間（20 tick）有効なまま残り、そのあと消える
const DEATH_TICKS = 20;
function removeEntity(e, { died = false, cause = 'none', damagingEntity } = {}) {
  if (!e.valid || e.dying !== undefined && died) return;
  if (died) {
    if (e.health > 0) e.health = 0;
    e.dying = S.tick;
    fireAfter('world.afterEvents', 'entityDie', { deadEntity: entityObj(e), damageSource: { cause, damagingEntity } });
    if (e.player) return;
    waits.push({ due: S.tick + 1, resolve: () => DEATH_DROPS.fn?.(e) }); // 実測: ドロップは次の tick に湧く
    waits.push({ due: S.tick + DEATH_TICKS, resolve: () => removeNow(e) });
    return;
  }
  removeNow(e);
}
function removeNow(e) {
  if (!e.valid) return;
  fireBefore('world.beforeEvents', 'entityRemove', { removedEntity: entityObj(e) });
  e.valid = false;
  fireAfter('world.afterEvents', 'entityRemove', { removedEntityId: e.id, typeId: e.typeId });
}

// チャット
function rawText(m) {
  if (typeof m === 'string') return m;
  if ($Array.isArray(m)) return m.map(rawText).join('');
  if (!m || typeof m !== 'object') return '';
  if (m.rawtext) return m.rawtext.map(rawText).join('');
  if (m.text !== undefined) return $String(m.text);
  // bds-lab の実クライアントが出す形にそろえる: with が配列なら「%key [a, b]」、rawtext ならつなげて（実測: give の
  // 「%commands.give.successRecipient [Diamond3]」）
  if (m.translate !== undefined) { const w = m.with; return `%${m.translate}${w ? ` [${$Array.isArray(w) ? w.map((x) => $String(x)).join(', ') : rawText(w)}]` : ''}`; }
  if (m.score) {
    const o = objectives.get(m.score.objective);
    const who = m.score.name;
    const i = [...identities.values()].find((x) => x.name === who);
    return $String(o && i ? (o.scores.get(i.id) ?? '') : '');
  }
  return '';
}
function say(to, message) {
  S.chat.push({ tick: S.tick, to, text: rawText(message) });
}
