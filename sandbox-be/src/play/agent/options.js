// 選択肢（options）— 何 tick にもわたる操作のまとまり。学ぶ頭（learner.js）も、先を読む頭（planner.js）も、
// 本物のプレイヤーも、同じこのコードで跳び・歩く（Sutton ら 1999 の options。人が「あの足場へ跳ぶ」と決める単位）。
//
//   optionsFor(map, region, opt)   その場所で選べる選択肢の一覧（場所と仕掛けが同じなら、いつも同じ並び）
//   yield* runOption(io, ctx)      1 つ実行する。yield n = n tick 進める。戻りは { fell, moving, wonMid }
//   yield* startEpisode(io, W)     出発点に置いて、止まるまで待つ
export const yawTo = (from, to) => (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
export const nearestTop = (region, p) => {
  let best = null;
  for (const t of region.tops) { const d = Math.hypot(t.x + 0.5 - p.x, t.z + 0.5 - p.z); if (!best || d < best.d) best = { t, d }; }
  return best;
};

/** その場所（region）から選べる選択肢 */
export function optionsFor(m, region, opt, { triggers = null, mask = 0 } = {}) {
  const out = [];
  for (const r of m.regions) {
    if (r.id === region.id) continue;
    const rTop = r.top ?? r.y + 1, fTop = region.top ?? region.y + 1;
    if (rTop - fTop > 1.25) continue; // 跳んで届く高さ（0.42 からの頂点が約 1.25）より高いところへは跳べない
    let dmin = Infinity;
    for (const a of region.tops) for (const b of r.tops) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < dmin) dmin = d; }
    // 歩いて行けるか（avoid のときは、ほかのスイッチ・罠を踏まない道で。踏まないと行けないなら跳ぶ選択肢を出す — 罠を跳び越える）
    // 全ブロックだけのコースでは「同じ高さ」のときだけ（前と同じ）。ハーフ・階段があれば段差（0.5625 以下）を上り下りして歩ける
    const walkable = (r.y === region.y || Math.abs(rTop - fTop) <= 3) && m.walkPath({ x: region.tops[0].x + 0.5, y: fTop, z: region.tops[0].z + 0.5 }, r, { avoid: triggers ? switchCells(triggers, mask, r) : null });
    if (walkable) out.push({ kind: 'goto', target: r.key });
    // 歩いて行ける場所へは跳ばない（同じ所へ着くのに、選択肢が 30 倍に増えるだけ。部屋の中で探索を食いつぶしていた）
    if (walkable || dmin > opt.reach) continue;
    for (const off of opt.offsets) {
      for (const runup of opt.runups) out.push({ kind: 'jump', target: r.key, off, runup, sprint: true, jump: true });
      for (const sprint of [true, false]) out.push({ kind: 'jump', target: r.key, off, runup: 'edge', sprint, jump: true });
      out.push({ kind: 'jump', target: r.key, off, runup: 2, sprint: false, jump: false });
      out.push({ kind: 'jump', target: r.key, off, runup: 0, sprint: true, jump: true, hop: true });
    }
    // 端までは別の向きで寄って（歩いて）、端で的へ向き直って走り跳び（1×1 の柱から斜めに跳ぶときに要る）
    for (const off of [-45, -20, 20, 45]) for (const steer of [false, true]) out.push({ kind: 'jump', target: r.key, off, runup: 'edge', sprint: false, jump: true, reaim: true, steer });
    out.push({ kind: 'jump', target: r.key, off: 0, runup: 'edge', sprint: false, jump: true, reaim: true, steer: true });
    // 空中で狙いつづける（人が着地点を見ながら跳ぶのと同じ。毎 tick 目の前の的へ向き直す）
    for (const runup of [0, 3, 'edge']) out.push({ kind: 'jump', target: r.key, off: 0, runup, sprint: true, jump: true, steer: true });
    out.push({ kind: 'jump', target: r.key, off: 0, runup: 0, sprint: true, jump: true, hop: true, steer: true });
    // 勢いの跳躍（momentum。物理の限界の近くの長い跳躍）: 足場のいちばん遠い角から、止まったまま（か 1〜2 tick 走って）跳び、
    // 足場の上に着いたらすぐもう一度跳ぶ（勢いを残す）。空中は的へ向き直す。総当たり（実機で測った物理）で見つけた、3×3 から隙間 5・1 段下へ届く跳び方
    // 届く帯が細い（0.1 ブロックほど）ので、始める点・向き・助走を細かく並べる（先読みは、ほかの跳び方が全部だめなときに回す: dense）
    if (opt.momentum && region.tops.length >= 4 && dmin >= 3) for (let i = 1; i <= 9; i++) for (const off of [0, -10, 10, -20, 20]) for (const runup of [0, 1, 2, 3]) out.push({ kind: 'jump', target: r.key, off, runup, sprint: true, jump: true, corner: true, at: i / 10, hopOnce: true, steer: true, dense: true });
    // いちど足場の奥（的と反対の端）まで下がってから、端まで走って跳ぶ（助走をいちばん長く取る）
    if (region.tops.length > 1) for (const steer of [false, true]) out.push({ kind: 'jump', target: r.key, off: 0, runup: 'edge', sprint: true, jump: true, back: true, steer });
  }
  // はしご: 上り口がこの場所なら、上って上の場所へ（壁に向かって前を押しつづける。実機: ladder_climb）
  (m.ladders ?? []).forEach((L, i) => {
    if (L.from?.id === region.id && L.to && L.to.id !== region.id) out.push({ kind: 'climb', target: L.to.key, ladder: i });
  });
  return out;
}

/** 出発点に置いて、止まるまで待つ。戻りは回の始めの満腹度（実機だけ） */
export function* startEpisode(io, W) {
  io.stop(); io.look(W.yaw ?? 0);
  const hungerBefore = io.refill ? io.refill() : null;
  io.place();
  yield 8;
  // 置かれて止まるまで待つ（実機は tp が届くのに数 tick かかることがある。サンドボックスではすぐ抜ける）
  const sp = W.spawn;
  for (let k = 0; k < 60; k++) {
    const p = io.me();
    if (p.onGround && Math.abs(p.x - sp.x) < 1e-3 && Math.abs(p.z - sp.z) < 1e-3 && Math.abs(p.y - sp.y) < 1e-3) break;
    yield 1;
  }
  return hungerBefore;
}

/**
 * 選択肢を 1 つ実行する。ctx = { m（いまのコースの形）, region, act, target, moving, hasWinSignal }
 * 勝ちの合図が出たらすぐやめる（実機では合図が数 tick 遅れて届く。届いた所で止まれば、どちらも同じ結果）
 */
/**
 * 踏みたくないマス: まだ動いていない仕掛け（スイッチ・罠）の足場。的の場所のマスは除く（踏みに行くのだから）。
 * 先読み（planner.js）が選んだ手を、実機でも同じに動かすため、本物のプレイヤーも同じ決まりで道を選ぶ（仕掛けの状態は自分の位置から分かる）
 */
export function switchCells(triggers, mask, target) {
  const out = new Set();
  (triggers ?? []).forEach((t, k) => {
    if (mask & (1 << k)) return;
    const c = t.when?.standOn; if (!c) return;
    out.add(`${c[0]}|${c[1]}|${c[2]}`);
  });
  if (target) for (const q of target.tops) out.delete(`${q.x}|${q.y}|${q.z}`);
  return out;
}

export function* runOption(io, { m, region, act, target, moving, hasWinSignal, triggers = null }) {
  // triggers があれば（avoid の選択肢）、歩く道・跳ぶ前に寄る端・助走に下がる先で、ほかのスイッチを踏まない
  const avoid = triggers ? switchCells(triggers, io.world().mask, target) : null;
  const fellBelow = () => io.me().y < m.lowestTop - 0.5;
  const execute = function* () {
    let fell = false;
    if (act.kind === 'climb') {
      // はしごのマスへ歩いて入り、壁へ向いて前を押しつづける。上り切ったら壁のてっぺんへ出て、上の場所に立ったら止まる
      const L = m.ladders[act.ladder];
      if (moving) { io.stop(); yield 4; }
      const foot = { x: L.x + 0.5 - L.wall.dx * 0.2, z: L.z + 0.5 - L.wall.dz * 0.2 };
      for (let k = 0; k < 60; k++) {
        const p = io.me(); if (Math.hypot(foot.x - p.x, foot.z - p.z) < 0.25) break;
        io.look(yawTo(p, foot)); io.controls({ forward: true, sprint: false, jump: false }); yield 1;
        if (fellBelow()) { fell = true; break; }
      }
      const topY = target.top ?? target.y + 1;
      for (let k = 0; k < 40 * (L.y1 - L.y0 + 2) && !fell; k++) {
        io.look(L.yaw); io.controls({ forward: true, sprint: false, jump: false }); yield 1;
        const p = io.me();
        if (p.onGround && Math.abs(p.y - topY) < 0.01 && m.regionAt(p)?.key === target.key) break;
        if (fellBelow()) { fell = true; break; }
      }
      io.stop(); yield 6; moving = false;
    } else if (act.kind === 'goto') {
      // 歩く: マス目の道をたどる。曲がり角は、ほぼ中心まで来てから曲がる（幅 0.6 の体が角に引っかからない）
      if (moving) { io.stop(); yield 4; }
      const route = m.walkPath(io.me(), target, { avoid });
      if (route) {
        for (let i = 1; i < route.length && !fell; i++) {
          const wp = route[i]; const last = i === route.length - 1;
          for (let k = 0; k < 40; k++) {
            const p = io.me();
            const d = Math.hypot(wp.x - p.x, wp.z - p.z);
            if (d < (last ? 0.25 : 0.3)) break;
            io.look(yawTo(p, wp)); io.controls({ forward: true, sprint: false, jump: false });
            yield 1;
            if (fellBelow()) { fell = true; break; }
          }
        }
      }
      io.stop(); yield 4; moving = false;
    } else {
      if (moving && !act.hop) { io.stop(); yield 4; }
      // 広い場所では、まず的にいちばん近い端のマスへ歩いて寄る（人が跳ぶ前に端まで行くのと同じ）
      const walkTo = function* (cell) {
        const route = m.walkPath(io.me(), { y: region.y, tops: [cell] }, { avoid });
        for (let i = 1; route && i < route.length; i++) {
          for (let k = 0; k < 40; k++) {
            const p = io.me(); if (Math.hypot(route[i].x - p.x, route[i].z - p.z) < 0.25) break;
            io.look(yawTo(p, route[i])); io.controls({ forward: true, sprint: false, jump: false }); yield 1;
          }
        }
        io.stop(); yield 4;
      };
      const safe = (c) => !avoid || !avoid.has(`${c.x}|${c.y}|${c.z}`);
      let edgeCell = null; { let best = Infinity; for (const a of region.tops) { if (!safe(a)) continue; for (const b of target.tops) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < best) { best = d; edgeCell = a; } } } }
      if (!edgeCell) edgeCell = region.tops[0];
      if (region.tops.length > 4 && Math.hypot(edgeCell.x + 0.5 - io.me().x, edgeCell.z + 0.5 - io.me().z) > 2) yield* walkTo(edgeCell);
      if (act.corner) {
        // 的からいちばん遠い足場のマスへ歩く
        const t0 = nearestTop(target, io.me()).t;
        const cand = region.tops.filter(safe); const far = (cand.length ? cand : region.tops).reduce((a, b) => (Math.hypot(b.x - t0.x, b.z - t0.z) > Math.hypot(a.x - t0.x, a.z - t0.z) ? b : a));
        yield* walkTo(far);
        // そのマスの中の、的へ向かう線の上の決まった点（at: 0 = 奥・1 = 手前）で止まる。1 回目の跳躍の着地点で 2 回目が届くかが決まり、
        // 届く帯は 0.1 ブロックほどしかない（総当たりで確かめた）ので、止まり方も正確にする: 残りの距離が「手を離して滑る距離」になったら離す
        const ux0 = t0.x - far.x, uz0 = t0.z - far.z; const ul = Math.hypot(ux0, uz0) || 1;
        const px = far.x + 0.5 + (ux0 / ul) * (act.at - 0.5) * 0.6, pz = far.z + 0.5 + (uz0 / ul) * (act.at - 0.5) * 0.6;
        for (let k = 0; k < 30; k++) {
          const p = io.me(); const d = Math.hypot(px - p.x, pz - p.z); const v = Math.hypot(p.vx, p.vz);
          if (d < 0.03 || v * 0.546 / (1 - 0.546) >= d) break;
          io.look(yawTo(p, { x: px, z: pz })); io.controls({ forward: true, sprint: false, jump: false }); yield 1;
        }
        io.stop(); yield 8;
      }
      if (act.back) {
        // 的と反対の方へ 3 マスほど下がる（助走をいちばん長く取る）
        const t0 = nearestTop(target, io.me()).t; const p = io.me();
        const dx = p.x - (t0.x + 0.5), dz = p.z - (t0.z + 0.5); const l = Math.hypot(dx, dz) || 1;
        const want = { x: p.x + (dx / l) * 3, z: p.z + (dz / l) * 3 };
        const cand = region.tops.filter(safe); const back = (cand.length ? cand : region.tops).reduce((a, b) => (Math.hypot(b.x + 0.5 - want.x, b.z + 0.5 - want.z) < Math.hypot(a.x + 0.5 - want.x, a.z + 0.5 - want.z) ? b : a));
        yield* walkTo(back);
      }
      const p0 = io.me();
      const nt = nearestTop(target, p0);
      io.look(yawTo(p0, { x: nt.t.x + 0.5, z: nt.t.z + 0.5 }) + act.off);
      io.controls({ forward: true, sprint: act.sprint, jump: false });
      if (act.runup === 'edge') {
        // 自分の予測で「このまま進むと、足もとの場所から外れるか」を見て、外れる直前に跳ぶ
        const tops = new Set(region.tops.map((t) => `${t.x}|${t.z}`));
        const onTop = (x, z) => [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]].some(([u, v]) => tops.has(`${Math.floor(x + u)}|${Math.floor(z + v)}`));
        for (let k = 0; k < 30; k++) {
          yield 1;
          const p = io.me();
          const f = act.sprint ? 1.3 : 1.0;
          if (!onTop(p.x + p.vx * f * 1.6, p.z + p.vz * f * 1.6)) break;
        }
      } else if (act.corner) {
        // 勢いの跳躍の助走: 毎 tick「的の向き ＋ off」に向き直しながら走る（総当たりで見つけた跳び方と同じ）
        for (let k = 0; k < act.runup; k++) { const p = io.me(); const t = nearestTop(target, p).t; io.look(yawTo(p, { x: t.x + 0.5, z: t.z + 0.5 }) + act.off); yield 1; }
      } else if (act.runup > 0) yield act.runup;
      if (act.jump) {
        if (act.reaim) { const p = io.me(); const t = nearestTop(target, p).t; io.look(yawTo(p, { x: t.x + 0.5, z: t.z + 0.5 })); io.controls({ sprint: true }); }
        io.controls({ jump: true }); yield 1; io.controls({ jump: false });
        let air = false; let hopped = false;
        // 出発の足場の高さで地面に着いた（縁に「縦だけ先に」着いて、横はもう縁の外のこともある: 当たり判定は y → x → z の順）
        const onRegion = () => { const p = io.me(); return p.onGround && Math.abs(p.y - (region.top ?? region.y + 1)) < 0.01; };
        for (let k = 0; k < 40; k++) {
          if (act.steer && air) { const p = io.me(); const t = nearestTop(target, p).t; io.look(yawTo(p, { x: t.x + 0.5, z: t.z + 0.5 })); }
          yield 1;
          if (fellBelow()) { fell = true; break; }
          if (!io.me().onGround) air = true;
          else if (air) {
            // 勢いの跳躍: 出発の足場に着いたら、すぐもう一度跳ぶ（1 回だけ）
            if (act.hopOnce && !hopped && onRegion()) { hopped = true; air = false; const p = io.me(); const t = nearestTop(target, p).t; io.look(yawTo(p, { x: t.x + 0.5, z: t.z + 0.5 })); io.controls({ jump: true }); yield 1; io.controls({ jump: false }); continue; }
            break;
          }
        }
      }
      if (act.jump && !fell) { moving = true; yield 1; } else { io.stop(); yield 4; moving = false; }
    }
    return fell;
  };
  let fell = false; let wonMid = false;
  const it = execute(); let r = it.next();
  while (!r.done) { yield r.value; if (hasWinSignal && io.world().won) { it.return(); wonMid = true; break; } r = it.next(); }
  if (r.done) fell = r.value;
  if (wonMid) { io.stop(); moving = false; for (let k = 0; k < 40 && !io.me().onGround; k++) yield 1; }
  if (!fell && fellBelow()) fell = true;
  return { fell, moving, wonMid };
}
