// プレイヤーどうしの戦いの決まり（BDS 1.26.51.1 に本物のクライアント 2 人で入って測った。tools/live/pvp-measure.mjs）。
// 推測で埋めない: 測っていない組み合わせ（走りながらの会心・武器の会心・防具・盾・弓…）は issues に積む。
//
// 測って分かったこと（全部、実機の SetActorMotion の値と 5 桁まで一致）:
//   ノックバック（叩かれた人の新しい速度）:
//     横 = 叩かれた人の今の横の速度 × 摩擦 ÷ 2 ＋ 0.4 ×（叩いた人 → 叩かれた人 の向き。叩いた人の向いている方ではない）
//     縦 = min(0.4, 今の縦の速度 ÷ 2 ＋ 0.48)   （今の縦の速度 = 次の tick に使う速度。落ちている最中ほど小さい）
//     走っていた（掛け金が立っていた）なら、同じ tick にもう 1 回: 横 = 上の横 ÷ 2 ＋ 0.4 × 向き、縦 = 上の縦 ÷ 2 ＋ 0.12
//   痛みの時間: ダメージを受けてから 10 tick は、叩かれてもダメージもノックバックも無い（9 tick 後は無効、10 tick 後は有効）
//     ただし、その中でも前より強い叩き（ふつう 1 のあとの会心 1.5）は効く: 差のダメージ（0.5）・ふつうのノックバック・痛みの時間はそこから数え直す
//     （window_crit_after_normal_3〜8 で 2 回目のノックバック、window_after_upgrade_12/14 は無効・16/18 は有効。duel.js が使う）
//   ダメージ: 素手 1、落ちている最中に叩くと 1.5 倍（会心）、鉄の剣 7。体力 20
//   届く距離: サーバーは中心どうし 6.6 ブロックまで受け付けた（6.8 は無効）。ふつうのクライアントは目から 3 ブロック（視線が当たり判定に当たるとき）
//     しか叩けないので、ここでは 3 にする（サーバーの甘さを使うのは、本物のプレイヤーにできないことなので使わない）
//   プレイヤーどうしはぶつからない（すり抜ける。押しもしない）
//   叩いた人は、叩いても遅くならない・走りも止まらない（訂正 0 で確かめた）
export const COMBAT = {
  health: 20,
  hurtTicks: 10,
  // 実機で測った（weapon_*_stand・_crit）: 石の剣 6・鉄の剣 7・ダイヤの剣 8・鉄の斧 6。会心は 1.5 倍（剣でも）。ノックバックは素手と同じ
  damage: { hand: 1, stone_sword: 6, iron_sword: 7, diamond_sword: 8, iron_axe: 6 },
  critMultiplier: 1.5,
  knockback: { horizontal: 0.4, vertical: 0.4, verticalBase: 0.48, sprintHorizontal: 0.4, sprintVertical: 0.12 },
  reach: 3.0,           // 目から当たり判定まで（ふつうのクライアント）
  serverReach: 6.6,     // サーバーが受け付けた中心どうしの距離（参考）
  eye: 1.62, width: 0.6, height: 1.8,
};
const F = Math.fround;

/**
 * ノックバックのあとの速度。victim = 叩かれた人の物理の状態（voxel の s: vx,vy,vz,f）。
 * from/to = 叩いた人・叩かれた人の足の位置（横の向きだけ使う）。sprint = 叩いた人が走っていたか
 */
export function knockback(victim, from, to, sprint) {
  const K = COMBAT.knockback;
  let dx = to.x - from.x, dz = to.z - from.z;
  let l = Math.hypot(dx, dz);
  if (l < 1e-4) { dx = 0; dz = 1; l = 1; } // 真上に重なっているとき（測っていない。向きは決まらないので +z）
  const ux = dx / l, uz = dz / l;
  let x = (victim.vx * victim.f) / 2 + ux * K.horizontal;
  let z = (victim.vz * victim.f) / 2 + uz * K.horizontal;
  let y = Math.min(K.vertical, victim.vy / 2 + K.verticalBase);
  if (sprint) { x = x / 2 + ux * K.sprintHorizontal; z = z / 2 + uz * K.sprintHorizontal; y = y / 2 + K.sprintVertical; }
  return { x: F(x), y: F(y), z: F(z) };
}

/**
 * 狙う点: 目から、相手の当たり判定（足の位置 p・幅 0.6・高さ 1.8）でいちばん近い点。
 * 統合版の届く距離は「目から、視線が当たり判定に当たった点まで」なので、ここを見るといちばん遠くから届く。
 * 同じ高さなら目の高さ（＝相手の頭のあたり）、相手が空中に浮いている（上にいる）なら足の裏、相手が下にいるなら頭のてっぺん。
 * 箱は凸なので、目からこの点へまっすぐ見れば手前で先に当たることはない → 届く距離はそのまま reachDistance
 */
export function aimPoint(eye, p) {
  const hw = COMBAT.width / 2;
  return { x: Math.max(p.x - hw, Math.min(eye.x, p.x + hw)), y: Math.max(p.y, Math.min(eye.y, p.y + COMBAT.height)), z: Math.max(p.z - hw, Math.min(eye.z, p.z + hw)) };
}
/** 狙う向き（度）。yaw は横、pitch は縦（下が +。統合版の向きと同じ）。真上に重なって横の向きが決まらないときは相手の中心へ */
export function aimAngles(eye, p) {
  const q = aimPoint(eye, p);
  const same = q.x === eye.x && q.z === eye.z;
  const tx = same ? p.x : q.x, tz = same ? p.z : q.z;
  const yaw = (Math.atan2(-(tx - eye.x), tz - eye.z) * 180) / Math.PI;
  const pitch = (-Math.atan2(q.y - eye.y, Math.hypot(q.x - eye.x, q.z - eye.z)) * 180) / Math.PI;
  return { yaw, pitch, point: q };
}
/**
 * その向き（yaw・pitch）で叩いたとき、視線が当たり判定のどこに当たるか、その距離（当たらなければ Infinity）。
 * 狙い方を比べるためのもの（aimAngles の向きなら reachDistance と同じになる）
 */
export function rayReach(eye, yaw, pitch, p) {
  const y = (yaw * Math.PI) / 180, q = (pitch * Math.PI) / 180;
  const dx = -Math.sin(y) * Math.cos(q), dy = -Math.sin(q), dz = Math.cos(y) * Math.cos(q);
  const hw = COMBAT.width / 2;
  const lo = [p.x - hw, p.y, p.z - hw], hi = [p.x + hw, p.y + COMBAT.height, p.z + hw];
  const o = [eye.x, eye.y, eye.z], d = [dx, dy, dz];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return Infinity; continue; }
    let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** 目の位置から、相手の当たり判定（足の位置 p）までの距離（視線を向けたときの最短。相手の中へ向けて見る） */
export function reachDistance(eye, p) {
  const hw = COMBAT.width / 2;
  const cx = Math.max(p.x - hw, Math.min(eye.x, p.x + hw));
  const cy = Math.max(p.y, Math.min(eye.y, p.y + COMBAT.height));
  const cz = Math.max(p.z - hw, Math.min(eye.z, p.z + hw));
  return Math.hypot(cx - eye.x, cy - eye.y, cz - eye.z);
}

/** 叩いたときのダメージ（会心 = 落ちている最中で 1.5 倍。素手なら走りながらの会心も測った: 実戦で 9/9。武器の会心は止まって跳んだときだけ測った） */
export function damageOf(attacker, item = 'hand') {
  const base = COMBAT.damage[item] ?? null;
  const crit = !attacker.onGround && attacker.dy < 0;
  return { amount: base === null ? null : base * (crit ? COMBAT.critMultiplier : 1), crit, unmeasured: base === null || (crit && attacker.sprinting && item !== 'hand') };
}
