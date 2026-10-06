// 何人も並べて走らせるときの、各レーンの原点（実機でもサンドボックスでも同じものを使う）。
// コースの幅から間隔を決める（重なると隣のコースに乗ってしまう — 幅 41 のコースを 36 おきに並べて、実機で隣のレーンの足場に着地した）。
// 学ぶときも同じ原点を順に使う: Minecraft の位置は float32 なので、絶対座標が違うと丸めが変わり、同じ手でも結果が変わることがある
// （原点 8 で覚えた方策が、原点 12 のレーンでは実機でもサンドボックスでも落ちた）。
export function laneOrigins(course, n, { gap = 6, y = -60 } = {}) {
  const W = course.world ?? course;
  const xs = (W.blocks ?? []).flatMap((b) => [b.from?.x ?? b.at?.x, b.to?.x ?? b.from?.x ?? b.at?.x]);
  const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs);
  const spacing = Math.max(36, maxX - minX + 1 + gap);
  return Array.from({ length: n }, (_, i) => ({ x: 8 - minX + i * spacing, y, z: 8 }));
}
