// Procedural 16x16 pixel art: `<shape>[:RRGGBB]` -> { pal, rows } for png(). Silhouettes are drawn with a few primitives,
// then shaded like hand-made Minecraft art: light from the top-left, a darker rim, an outline one step darker.
// Items: gem ingot orb apple sword pickaxe axe shovel hoe coin key potion dust stick wand heart star book scroll
// Blocks (tileable, no outline): block ore bricks planks glass
const hex = (c) => c.match(/../g).map((h) => parseInt(h, 16));
const toHex = (a) => a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const W = [255, 255, 255], K = [0, 0, 0];
export const SHAPES = ['gem', 'ingot', 'orb', 'apple', 'sword', 'pickaxe', 'axe', 'shovel', 'hoe', 'coin', 'key', 'potion', 'dust', 'stick', 'wand', 'heart', 'star', 'book', 'scroll', 'block', 'ore', 'bricks', 'planks', 'glass'];
const DEF = { gem: '2fd4c8', ingot: 'd8d8d8', orb: '7b3fe4', apple: 'd62b2b', coin: 'f2c230', key: 'e0b040', potion: 'e04a8a', dust: 'e03030', wand: '40c0ff', heart: 'e02040', star: 'ffd83a', book: '8b3a2a', scroll: 'e8d9a8', block: '7f7f7f', ore: '40c0ff', bricks: 'a0503a', planks: 'b8874a', glass: 'c8e8f0' };

// material ids: 1 main, 2 wood, 3 metal (tool heads keep the given color as 1), 4 white (pages, shine)
function canvas() {
  const g = Array.from({ length: 16 }, () => new Array(16).fill(0));
  const set = (x, y, m) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y][x] = m; };
  return {
    g, set,
    line(x0, y0, x1, y1, m, w = 1) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1; for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) set(x + a - (w - 1) / 2, y + b - (w - 1) / 2, m); } },
    path(pts, m, w = 1) { for (let i = 1; i < pts.length; i++) this.line(...pts[i - 1], ...pts[i], m, w); },
    disc(cx, cy, r, m) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = m; },
    rect(x0, y0, x1, y1, m) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, m); },
    poly(pts, m) {   // even-odd fill at pixel centres
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) g[y][x] = m;
      }
    },
  };
}

function draw(shape) {
  const c = canvas();
  switch (shape) {
    case 'gem': c.poly([[4, 3], [12, 3], [15, 7], [8, 14], [1, 7]], 1); break;
    case 'ingot': c.poly([[4, 3], [13, 3], [15, 12], [1, 12]], 1); c.rect(4, 3, 12, 4, 4); break;
    case 'orb': c.disc(7.5, 7.5, 5.6, 1); break;
    case 'apple': c.disc(7.5, 9, 5.2, 1); c.line(8, 1, 8, 4, 2); c.poly([[9, 3], [12, 1], [13, 3], [10, 4]], 5); break;
    case 'sword': c.line(13, 2, 6, 9, 1, 2); c.line(3, 8, 7, 12, 2); c.line(2, 13, 5, 10, 2); c.set(1, 14, 2); break;
    case 'pickaxe': c.line(2, 14, 10, 6, 2); c.poly([[1, 5], [5, 1], [10, 1], [15, 6], [15, 11], [13, 11], [12, 6], [9, 3], [6, 3], [3, 6]], 1); break;
    case 'axe': c.line(2, 14, 11, 5, 2); c.poly([[8, 1], [12, 1], [15, 5], [14, 9], [11, 8], [8, 5]], 1); break;
    case 'shovel': c.line(2, 14, 9, 7, 2); c.poly([[9, 5], [12, 2], [15, 4], [13, 8], [10, 8]], 1); break;
    case 'hoe': c.line(2, 14, 11, 5, 2); c.path([[8, 2], [11, 2], [14, 5]], 1, 2); break;
    case 'coin': c.disc(7.5, 7.5, 6, 1); c.disc(7.5, 7.5, 3.2, 3); c.disc(7.5, 7.5, 2.2, 1); break;
    case 'key': c.disc(4.5, 4.5, 3.4, 1); c.disc(4.5, 4.5, 1.2, 0); c.line(7, 7, 14, 14, 1); c.line(11, 13, 12, 12, 1); c.line(13, 11, 14, 10, 1); break;
    case 'potion': c.disc(7.5, 10.5, 4.6, 1); c.rect(6, 3, 9, 6, 4); c.rect(6, 1, 9, 2, 2); break;
    case 'dust': c.poly([[1, 14], [4, 9], [8, 6], [12, 9], [15, 14]], 1); c.set(4, 4, 1); c.set(11, 3, 1); c.set(13, 6, 1); break;
    case 'stick': c.line(3, 13, 12, 3, 2); break;
    case 'wand': c.line(2, 14, 10, 6, 2); c.disc(11.5, 4.5, 2.6, 1); break;
    case 'heart': c.disc(5, 6, 3.3, 1); c.disc(10, 6, 3.3, 1); c.poly([[1.8, 7], [13.2, 7], [7.5, 14]], 1); break;
    case 'star': { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 3 : 7.4; p.push([8 + r * Math.cos(a), 8.3 + r * Math.sin(a)]); } c.poly(p, 1); break; }
    case 'book': c.rect(3, 2, 12, 13, 1); c.rect(11, 3, 12, 13, 4); c.rect(4, 2, 4, 13, 3); break;
    case 'scroll': c.rect(3, 4, 12, 11, 1); c.rect(2, 2, 13, 3, 2); c.rect(2, 12, 13, 13, 2); break;
    default: throw new Error(`unknown shape "${shape}": ${SHAPES.join(' ')}`);
  }
  return c.g;
}

// deterministic noise per texture
const rnd = (seed) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

function tile(shape, base) {
  const r = rnd(shape.length * 7919 + base.reduce((a, b) => a + b, 0));
  const pal = { b: base, h: mix(base, W, 0.18), s: mix(base, K, 0.18), d: mix(base, K, 0.35), g: [125, 125, 125], G: [150, 150, 150], k: [100, 100, 100], w: mix(base, W, 0.5) };
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const n = r();
      if (shape === 'block') row += n < 0.15 ? 'h' : n < 0.3 ? 's' : n < 0.34 ? 'd' : 'b';
      else if (shape === 'ore') row += n < 0.15 ? 'G' : n < 0.3 ? 'k' : 'g';
      else if (shape === 'bricks') { const off = Math.floor(y / 4) % 2 ? 4 : 0; row += y % 4 === 3 || (x + off) % 8 === 7 ? 'w' : n < 0.2 ? 's' : n < 0.3 ? 'h' : 'b'; }
      else if (shape === 'planks') row += y % 4 === 3 ? 'd' : (x + Math.floor(y / 4) * 5) % 16 === 0 ? 's' : n < 0.25 ? 'h' : n < 0.4 ? 's' : 'b';
      else if (shape === 'glass') row += x === 0 || y === 0 || x === 15 || y === 15 ? 'w' : (x === y + 3 || x === y + 4) && x < 10 ? 'h' : '.';
    }
    rows.push(row);
  }
  if (shape === 'ore') for (const [cx, cy] of [[3, 3], [11, 4], [6, 10], [12, 12], [2, 13]]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) {
    if (r() < 0.25 && dx + dy) continue;
    const x = (cx + dx + 16) % 16, y = (cy + dy + 16) % 16, ch = dx + dy < 0 ? 'h' : dx + dy > 1 ? 's' : 'b';
    rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
  }
  if (shape === 'glass') { pal.w = mix(base, K, 0.2); pal.h = [...mix(base, W, 0.6), 200]; }
  return { pal, rows };
}

export function pixel(spec) {
  const [shape, col] = String(spec).split(':');
  if (!SHAPES.includes(shape)) throw new Error(`unknown texture "${shape}": ${SHAPES.join(' ')}`);
  const c = col ?? DEF[shape] ?? 'a0a0a0';
  if (!/^[0-9a-f]{6}$/i.test(c)) throw new Error(`color "${c}": RRGGBB`);
  const base = hex(c);
  const res = ['block', 'ore', 'bricks', 'planks', 'glass'].includes(shape) ? tile(shape, base) : sprite(draw(shape), base);
  return { pal: Object.entries(res.pal).map(([k, v]) => `${k}=${toHex(v)}`).join(' '), rows: res.rows };
}

function sprite(g, base) {
  const M = {   // per material: [base, highlight, shadow, outline]
    1: [base, mix(base, W, 0.4), mix(base, K, 0.3), mix(base, K, 0.62)],
    2: [[138, 90, 43], [168, 118, 64], [104, 66, 30], [60, 38, 16]],
    3: [mix(base, K, 0.25), mix(base, K, 0.1), mix(base, K, 0.4), mix(base, K, 0.65)],
    4: [[232, 232, 232], [255, 255, 255], [196, 196, 204], [110, 110, 120]],
    5: [[70, 160, 60], [110, 200, 90], [45, 115, 40], [25, 70, 20]],
  };
  const at = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? 0 : g[y][x]);
  const keys = {}, pal = { '.': null };
  let next = 0;
  const key = (rgb) => { const h = toHex(rgb); if (!keys[h]) { keys[h] = 'abcdefghijklmnopqrstuvwxyz'[next++]; pal[keys[h]] = rgb; } return keys[h]; };
  const rows = [];
  // the top-left-most pixel of the main material gets a white glint (gems, orbs, metal)
  let glint = null;
  for (let s = 0; s < 32 && !glint; s++) for (let y = 0; y <= s && !glint; y++) { const x = s - y; if (at(x, y) === 1 && at(x - 1, y) === 1 && at(x, y - 1) === 1) glint = [x + 1, y + 1]; }
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const m = at(x, y);
      if (!m) {   // outline: next to a filled pixel (4-neighbour)
        const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(Boolean);
        row += n.length ? key(M[n[0]][3]) : '.';
        continue;
      }
      const [b, h, s] = M[m];
      const edgeTL = at(x - 1, y) !== m || at(x, y - 1) !== m, edgeBR = at(x + 1, y) !== m || at(x, y + 1) !== m;
      let rgb = edgeTL && !edgeBR ? h : edgeBR && !edgeTL ? s : b;
      if (m === 1 && glint && x === glint[0] && y === glint[1]) rgb = mix(h, W, 0.6);
      row += key(rgb);
    }
    rows.push(row);
  }
  delete pal['.'];
  return { pal, rows };
}

// a 32x16 skin for `add entity`'s 8x8x8 box (box UV at 0,0): shaded sides, a lighter top, a face on the front (north: x 8-15, y 8-15)
export function boxSkin(spec = '') {
  const c = (String(spec).split(':')[1] ?? String(spec)).match(/^[0-9a-f]{6}$/i) ? (String(spec).split(':')[1] ?? spec) : '7fb069';
  const b = hex(c), P = { b, h: mix(b, W, 0.25), s: mix(b, K, 0.22), d: mix(b, K, 0.45), e: [20, 20, 28], w: [245, 245, 245] };
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 32; x++) {
      let ch = '.';
      if (y < 8 && x >= 8 && x < 24) ch = x < 16 ? ((x + y) % 5 === 0 ? 'b' : 'h') : 's';   // top / bottom
      else if (y >= 8) { const lx = x % 8, ly = y - 8; ch = lx === 0 || ly === 7 ? 's' : ly === 0 ? 'h' : (lx * 3 + ly * 5) % 11 === 0 ? 's' : 'b'; }
      r += ch;
    }
    rows.push(r);
  }
  const put = (x, y, ch) => { rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };
  // the face: eyes with a glint, a small mouth
  for (const x of [9, 13]) { put(x, 11, 'e'); put(x + 1, 11, 'e'); put(x, 12, 'e'); put(x + 1, 12, 'e'); put(x, 11, 'w'); }
  put(11, 14, 'd'); put(12, 14, 'd');
  return { pal: Object.entries(P).map(([k, v]) => `${k}=${toHex(v)}`).join(' '), rows };
}
