// A screenshot with a grid on it, to read `tap x y` positions off: a line every 10 % of the width / height (the 50 % lines
// brighter) and the fractions written at the edges (0.1 … 0.9). The positions in app.txt are these fractions.
const FONT = {   // 3x5 digits and '.'
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], '.': ['000', '000', '000', '000', '010'],
};

/** img: {w, h, data RGBA} (common/extra.mjs pngDecode). Returns a new image. */
export function gridOverlay(img) {
  const { w, h } = img, d = Buffer.from(img.data);
  const put = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    d[o] = Math.round(d[o] * (1 - a) + r * a); d[o + 1] = Math.round(d[o + 1] * (1 - a) + g * a); d[o + 2] = Math.round(d[o + 2] * (1 - a) + b * a); d[o + 3] = 255;
  };
  const RED = [255, 40, 40], YEL = [255, 230, 0], BLK = [0, 0, 0], WHT = [255, 255, 255];
  const lw = Math.max(1, Math.round(Math.min(w, h) / 400));
  for (let k = 1; k < 10; k++) {
    const col = k === 5 ? YEL : RED, a = k === 5 ? 0.9 : 0.6;
    const x0 = Math.round((w * k) / 10), y0 = Math.round((h * k) / 10);
    for (let t = 0; t < lw; t++) { for (let y = 0; y < h; y++) put(x0 + t, y, col, a); for (let x = 0; x < w; x++) put(x, y0 + t, col, a); }
  }
  const scale = Math.max(2, Math.round(Math.min(w, h) / 180));
  const text = (s, x, y) => {
    const cw = 4 * scale, W = s.length * cw + scale, H = 7 * scale;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) put(x + xx, y + yy, BLK, 0.75);   // a dark box behind
    [...s].forEach((c, i) => FONT[c]?.forEach((row, ry) => [...row].forEach((bit, rx) => {
      if (bit === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(x + scale + i * cw + rx * scale + sx, y + scale + ry * scale + sy, WHT);
    })));
  };
  for (let k = 1; k < 10; k++) {
    const label = `0.${k}`;
    text(label, Math.round((w * k) / 10) + 2 * lw, 2);                 // x along the top
    text(label, 2, Math.round((h * k) / 10) + 2 * lw);                 // y down the left
  }
  return { w, h, data: d };
}
