// Entity models drawn THE WAY THE GAME DOES, and the geometry defects an editor hides.
// A Node port of the method in iMasterProX/mcbemodelingmasterAI (MIT): tools/preview/render_model.py and tools/inspect_model.py.
//  1. a JSON rotation [rx, ry, rz] is right-handed (-rx, ry, -rz), X then Y then Z, about the pivot; animation rotations ADD to the bind pose
//  2. the game draws the model MIRRORED IN X: a cube's "east" UV shows on its low-x side, "west" on its high-x side
//  3. across each face the texture runs as facePoint says; alpha below 50% is cut out
// Box UV ("uv": [u, v]) is converted to per-face UV the way Blockbench lays it out, so any geo.json renders.
import fs from 'node:fs';
import { pngDecode, pngEncode, tgaDecode } from './extra.mjs';

const R = Math.PI / 180;
export function rotate(p, pivot, rot) {
  const rx = -rot[0] * R, ry = rot[1] * R, rz = -rot[2] * R;
  let x = p[0] - pivot[0], y = p[1] - pivot[1], z = p[2] - pivot[2];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}
export function facePoint(o, s, face, u, v) {
  const [x0, y0, z0] = o, x1 = x0 + s[0], y1 = y0 + s[1], z1 = z0 + s[2];
  if (face === 'east') return [x0, y1 - v * s[1], z1 - u * s[2]];
  if (face === 'west') return [x1, y1 - v * s[1], z0 + u * s[2]];
  if (face === 'north') return [x0 + u * s[0], y1 - v * s[1], z0];
  if (face === 'south') return [x1 - u * s[0], y1 - v * s[1], z1];
  if (face === 'up') return [x0 + u * s[0], y1, z1 - v * s[2]];
  return [x0 + u * s[0], y0, z0 + v * s[2]];   // down
}
// box UV -> per-face, exactly as Blockbench maps it (js/outliner/types/cube.js): up/down on the top row (flipped), then east north west south
export function faceUvs(cube) {
  if (cube.uv && !Array.isArray(cube.uv)) return cube.uv;
  const [u, v] = cube.uv ?? [0, 0], [w, h, d] = cube.size.map(Math.abs);
  const f = { east: [u, v + d, d, h], north: [u + d, v + d, w, h], west: [u + d + w, v + d, d, h], south: [u + 2 * d + w, v + d, w, h], up: [u + d + w, v + d, -w, -d], down: [u + d + 2 * w, v, -w, d] };
  if (cube.mirror) { [f.east, f.west] = [f.west, f.east]; for (const k in f) f[k] = [f[k][0] + f[k][2], f[k][1], -f[k][2], f[k][3]]; }
  return Object.fromEntries(Object.entries(f).map(([k, [a, b, c, e]]) => [k, { uv: [a, b], uv_size: [c, e] }]));
}

// every geometry in a file: format 1.12+ ("minecraft:geometry": [...]) and the legacy 1.8 keys ("geometry.x" / "geometry.x:geometry.base")
export function loadGeos(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const out = [];
  for (const g of j['minecraft:geometry'] ?? []) out.push({ id: g.description?.identifier, tw: g.description?.texture_width ?? 64, th: g.description?.texture_height ?? 64, bones: g.bones ?? [] });
  for (const [k, g] of Object.entries(j)) if (k.startsWith('geometry.')) out.push({ id: k.split(':')[0], tw: g.texturewidth ?? 64, th: g.textureheight ?? 64, bones: (g.bones ?? []).map((b) => (b.bind_pose_rotation && !b.rotation ? { ...b, rotation: b.bind_pose_rotation } : b)) });
  return out;
}

// Molang enough for poses: numbers, math.*, query.anim_time / life_time (= t); any other query or variable is 0
const MFN = { sin: 'S', cos: 'C', abs: 'Math.abs', clamp: 'CL', lerp: 'LE', min: 'Math.min', max: 'Math.max', floor: 'Math.floor', ceil: 'Math.ceil', round: 'Math.round', sqrt: 'Math.sqrt', pi: 'Math.PI', mod: 'MOD', pow: 'Math.pow', exp: 'Math.exp', random: 'RND' };
const MOK = new Set(['S', 'C', 'CL', 'LE', 'MOD', 'RND', ...Object.values(MFN)]);
function molang(x, t) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return 0;
  const e = x.toLowerCase().replace(/;\s*$/, '').replace(/\b(q|query)\.(anim_time|life_time|time_stamp)\b/g, `(${t})`).replace(/\b(q|query|v|variable|c|context|t|temp)\.\w+/g, '0')
    .replace(/\bmath\.(\w+)/g, (_, f) => MFN[f] ?? '0');
  if (/[^\w\s.+\-*/%(),?:<>=!&|]/.test(e) || (e.match(/[A-Za-z_][\w.]*/g) ?? []).some((id) => !MOK.has(id))) return 0;
  try {
    return Number(new Function('S', 'C', 'CL', 'LE', 'MOD', 'RND', `return (${e});`)((d) => Math.sin(d * R), (d) => Math.cos(d * R), (v, a, b) => Math.min(Math.max(v, a), b), (a, b, k) => a + (b - a) * k, (a, b) => a % b, (a, b) => a + (b - a) * 0.5)) || 0;
  } catch { return 0; }
}
const vec = (v, t) => (Array.isArray(v) ? v.map((x) => molang(x, t)) : typeof v === 'number' || typeof v === 'string' ? [molang(v, t), molang(v, t), molang(v, t)] : null);
// one animation's pose at time t (default: its last keyframe): { bone: { rotation, position } }
export function poseAt(anim, t) {
  const pose = {};
  let end = 0;
  for (const ch of Object.values(anim.bones ?? {})) for (const k of ['rotation', 'position']) if (ch[k] && typeof ch[k] === 'object' && !Array.isArray(ch[k])) end = Math.max(end, ...Object.keys(ch[k]).map(Number).filter((n) => !isNaN(n)));
  const at = t ?? end;
  for (const [bone, ch] of Object.entries(anim.bones ?? {})) {
    for (const k of ['rotation', 'position']) {
      const c = ch[k];
      if (c === undefined) continue;
      let v;
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const keys = Object.keys(c).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
        const val = (kt) => { const x = c[String(kt)] ?? c[Object.keys(c).find((s) => Number(s) === kt)]; return vec(x && typeof x === 'object' && !Array.isArray(x) ? x.post ?? x.pre : x, at); };
        const i = keys.findIndex((kt) => kt > at);
        if (i <= 0) v = val(i === 0 ? keys[0] : keys.at(-1));
        else { const a = keys[i - 1], b = keys[i], va = val(a), vb = val(b), f = (at - a) / (b - a); v = va.map((x, n) => x + (vb[n] - x) * f); }
      } else v = vec(c, at);
      if (v) (pose[bone] ??= {})[k] = v;
    }
  }
  return pose;
}

function lineage(bones, name) { const out = []; for (let b = bones.get(name); b; b = bones.get(b.parent)) out.push(b); return out; }
// a model-space point of a cube (cube rotation, then each bone up the chain with its bind + pose rotation and pose offset)
function place(p, cube, chain, pose) {
  if (cube.rotation && cube.rotation.some(Boolean)) p = rotate(p, cube.pivot ?? cube.origin.map((o, i) => o + cube.size[i] / 2), cube.rotation);   // no pivot: the box's centre
  for (const b of chain) {
    const bind = b.rotation ?? [0, 0, 0], add = pose[b.name]?.rotation ?? [0, 0, 0], r = [0, 1, 2].map((i) => bind[i] + add[i]);
    if (r.some(Boolean)) p = rotate(p, b.pivot ?? [0, 0, 0], r);
    const sh = pose[b.name]?.position;
    if (sh) p = [p[0] + sh[0], p[1] + sh[1], p[2] + sh[2]];
  }
  return p;
}
function collect(geo, pose = {}) {
  const bones = new Map(geo.bones.map((b) => [b.name, b])), faces = [];
  for (const bone of geo.bones) {
    const chain = lineage(bones, bone.name);
    for (const cube of bone.cubes ?? []) {
      const inf = cube.inflate ?? 0, o = cube.origin.map((x) => x - inf), s = cube.size.map((x) => x + 2 * inf);
      for (const [face, m] of Object.entries(faceUvs(cube))) {
        if (!m || typeof m !== 'object' || !m.uv_size || m.uv_size.includes(0)) continue;
        const quad = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => { const p = place(facePoint(o, s, face, u, v), cube, chain, pose); return [-p[0], p[1], p[2]]; });   // the game mirrors x
        const [x, y] = m.uv, [w, h] = m.uv_size;
        faces.push({ quad, uv: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
      }
    }
  }
  return faces;
}

export const VIEWS = { front34: [0.55, 0.42, -0.72], rear34: [-0.52, 0.42, 0.74], side: [1, 0.16, 0], top: [0, 1, -0.001], front: [0, 0.14, -1], rear: [0, 0.16, 1], low34: [0.47, 0.15, -0.87], left: [-1, 0.16, 0], back34: [-0.55, 0.42, 0.72] };
const LIGHT = (() => { const l = [0.35, 0.85, -0.4], n = Math.hypot(...l); return l.map((x) => x / n); })();
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };

function draw(faces, tex, dir, centre, scale, W, H, bg, img, ox) {
  const d = unit(dir), helper = Math.abs(d[1]) < 0.98 ? [0, 1, 0] : [0, 0, -1], right = unit(cross(helper, d)), up = cross(d, right);
  const z = new Float64Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * img.w + ox + x) * 4; img.data[o] = bg[0]; img.data[o + 1] = bg[1]; img.data[o + 2] = bg[2]; img.data[o + 3] = 255; }
  for (const f of faces) {
    const sx = [], sy = [], sz = [];
    for (const q of f.quad) { const r = sub(q, centre); sx.push(dot(r, right) * scale + W / 2); sy.push(H / 2 - dot(r, up) * scale); sz.push(-dot(r, d)); }
    const n = cross(sub(f.quad[1], f.quad[0]), sub(f.quad[3], f.quad[0])), ln = Math.hypot(...n);
    const shade = ln > 1e-9 ? 0.6 + 0.4 * Math.abs(dot(n, LIGHT) / ln) : 1;
    const lu = Math.min(f.uv[0][0], f.uv[2][0]), hu = Math.max(f.uv[0][0], f.uv[2][0]), lv = Math.min(f.uv[0][1], f.uv[2][1]), hv = Math.max(f.uv[0][1], f.uv[2][1]);
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c]))), x1 = Math.min(W - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
      const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c]))), y1 = Math.min(H - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
      const v0x = sx[b] - sx[a], v0y = sy[b] - sy[a], v1x = sx[c] - sx[a], v1y = sy[c] - sy[a], den = v0x * v1y - v0y * v1x;
      if (x0 > x1 || y0 > y1 || Math.abs(den) < 1e-9) continue;
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const gx = px + 0.5 - sx[a], gy = py + 0.5 - sy[a];
        const wb = (gx * v1y - gy * v1x) / den, wc = (gy * v0x - gx * v0y) / den, wa = 1 - wb - wc;
        if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
        const depth = wa * sz[a] + wb * sz[b] + wc * sz[c], zi = py * W + px;
        if (depth >= z[zi] - 1e-6) continue;
        const tu = wa * f.uv[a][0] + wb * f.uv[b][0] + wc * f.uv[c][0], tv = wa * f.uv[a][1] + wb * f.uv[b][1] + wc * f.uv[c][1];
        const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(Math.min(Math.max(tu, lu), hu - 1e-4)))), ty = Math.min(tex.h - 1, Math.max(0, Math.floor(Math.min(Math.max(tv, lv), hv - 1e-4))));
        const t = (ty * tex.w + tx) * 4;
        if (tex.data[t + 3] < 128) continue;
        z[zi] = depth;
        const o = (py * img.w + ox + px) * 4;
        for (let k = 0; k < 3; k++) img.data[o + k] = Math.min(255, tex.data[t + k] * shade);
      }
    }
  }
}

// geo (from loadGeos) + texture PNG -> a sheet of views; returns { faces, views }
export function renderModel(geo, texFile, outFile, { views = ['front34', 'side', 'rear34', 'top'], pose = {}, size = [320, 240], bg = [16, 22, 22] } = {}) {
  const tex = texFile ? (/\.tga$/i.test(texFile) ? tgaDecode : pngDecode)(fs.readFileSync(texFile)) : { w: 1, h: 1, data: Buffer.from([200, 200, 200, 255]) };
  const faces = collect(geo, pose);
  if (!faces.length) throw new Error(`${geo.id}: no textured faces`);
  // texture coordinates are in the geometry's texture_width/height units: scale to the image
  const kx = tex.w / (geo.tw || tex.w), ky = tex.h / (geo.th || tex.h);
  if (kx !== 1 || ky !== 1) for (const f of faces) f.uv = f.uv.map(([u, v]) => [u * kx, v * ky]);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) for (const p of f.quad) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const centre = lo.map((x, i) => (x + hi[i]) / 2), extent = Math.hypot(...sub(hi, lo)) || 1;
  const [W, H] = size, cols = views.length > 1 ? 2 : 1, rows = Math.ceil(views.length / cols);
  const img = { w: W * cols, h: H * rows, data: Buffer.alloc(W * cols * H * rows * 4) };
  const scale = (1.05 * Math.min(W, H)) / extent;   // the whole model always fits
  views.forEach((v, i) => {
    if (!VIEWS[v]) throw new Error(`view ${v}: ${Object.keys(VIEWS).join(' ')}`);
    const sub2 = { w: W, h: H, data: Buffer.alloc(W * H * 4) };
    draw(faces, tex, VIEWS[v], centre, scale * (v === 'top' ? 0.95 : /^(front|rear)$/.test(v) ? 1.1 : 1), W, H, bg, sub2, 0);
    const cx = (i % cols) * W, cy = Math.floor(i / cols) * H;
    for (let y = 0; y < H; y++) sub2.data.copy(img.data, ((cy + y) * img.w + cx) * 4, y * W * 4, (y + 1) * W * 4);
  });
  fs.writeFileSync(outFile, pngEncode(img));
  return { faces: faces.length, views, size: [img.w, img.h] };
}

// ---- lint: what an editor hides and the game shows (collapsed cubes, z-fighting, UVs off the texture, unequal plate faces, duplicates) ----
const FACE_IDS = { north: [0, 4, 6, 2], south: [1, 3, 7, 5], east: [4, 5, 7, 6], west: [0, 2, 3, 1], up: [2, 6, 7, 3], down: [0, 1, 5, 4] };
function overlapArea(subject, clip) {
  const signed = (p) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;
  if (signed(clip) < 0) clip = [...clip].reverse();
  let out = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const src = out; out = [];
    for (let j = 0; j < src.length; j++) {
      const p = src[j], q = src[(j + 1) % src.length];
      if (inside(p) !== inside(q)) {
        const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [q[0] - p[0], q[1] - p[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) > 1e-12) { const t = ((p[0] - a[0]) * d2[1] - (p[1] - a[1]) * d2[0]) / den; out.push([a[0] + t * d1[0], a[1] + t * d1[1]]); }
      }
      if (inside(q)) out.push(q);
    }
    if (!out.length) return 0;
  }
  return Math.abs(signed(out));
}
export function lintGeo(geo, pose = {}) {
  const errs = [], bones = new Map(geo.bones.map((b) => [b.name, b])), cubes = [], seen = new Map();
  let n = 0;
  for (const bone of geo.bones) for (const c of bone.cubes ?? []) {
    n++;
    const name = `${bone.name}#${n} at [${c.origin.map((v) => Math.round(v * 100) / 100)}]`, s = c.size;
    if (Math.min(...s) < 0) errs.push(`collapsed cube (negative size [${s}]): ${name}`);
    else if ([...s].sort((a, b) => a - b)[1] === 0) errs.push(`collapsed cube (two zero sizes [${s}]): ${name}`);
    const uvs = faceUvs(c);
    if (s.includes(0) && Math.min(...s) >= 0 && !Array.isArray(c.uv)) {
      for (const [a, b] of [['up', 'down'], ['north', 'south'], ['east', 'west']]) {
        const sz = [a, b].map((f) => (uvs[f]?.uv_size ?? [0, 0]).map(Math.abs));
        if (sz.every((x) => !x.includes(0)) && String(sz[0]) !== String(sz[1])) errs.push(`two-faced plate with unequal faces (${a} ${sz[0]}, ${b} ${sz[1]}): the smaller paints over the other's cut-out outline: ${name}`);
      }
    }
    const key = JSON.stringify([bone.name, c.origin, s, c.rotation ?? null, c.pivot ?? null, c.inflate ?? 0]);
    if (seen.has(key)) errs.push(`duplicate cube: ${name} = ${seen.get(key)}`); else seen.set(key, name);
    for (const [f, m] of Object.entries(uvs)) {
      if (!m?.uv || !m.uv_size || m.uv_size.includes(0)) continue;
      const [u, v] = m.uv, [w, h] = m.uv_size;
      if (Math.min(u, u + w) < 0 || Math.min(v, v + h) < 0 || Math.max(u, u + w) > geo.tw || Math.max(v, v + h) > geo.th) errs.push(`UV leaves the ${geo.tw}x${geo.th} texture: ${name} ${f} [${u},${v}] size [${w},${h}]`);
    }
    if (Math.min(...s) >= 0) cubes.push({ c, name, chain: lineage(bones, bone.name) });
  }
  // z-fighting: two faces of different cubes looking the same way from one plane and overlapping there (rotated cubes too)
  const faces = [];
  for (const k of cubes) {
    const inf = k.c.inflate ?? 0, o = k.c.origin.map((x) => x - inf), s = k.c.size.map((x) => x + 2 * inf);
    const pts = []; for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) pts.push(place([o[0] + dx * s[0], o[1] + dy * s[1], o[2] + dz * s[2]], k.c, k.chain, pose));
    const centre = [0, 1, 2].map((i) => pts.reduce((a, p) => a + p[i], 0) / 8);
    const uvs = faceUvs(k.c);
    for (const [face, ids] of Object.entries(FACE_IDS)) {
      if (!uvs[face] || !uvs[face].uv_size || uvs[face].uv_size.includes(0)) continue;   // an untextured face is not drawn
      const q = ids.map((i) => pts[i]), e1 = sub(q[1], q[0]), e2 = sub(q[3], q[0]);
      let nn = cross(e1, e2); const ln = Math.hypot(...nn);
      if (ln < 1e-12) continue;
      nn = nn.map((x) => x / ln);
      const fc = [0, 1, 2].map((i) => q.reduce((a, p) => a + p[i], 0) / 4);
      if (dot(nn, sub(fc, centre)) < 0) nn = nn.map((x) => -x);
      faces.push({ k, face, q, n: nn, dist: dot(nn, fc), e1 });
    }
  }
  const buckets = new Map();
  for (const f of faces) { const key = f.n.map((v) => (Math.round(v * 100) / 100 + 0).toFixed(2)).join(); (buckets.get(key) ?? buckets.set(key, []).get(key)).push(f); }
  for (const g of buckets.values()) {
    g.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const fa = g[i], fb = g[j];
      if (fb.dist - fa.dist > 0.012) break;
      if (fa.k === fb.k || dot(fa.n, fb.n) < 0.99995) continue;
      const ax = unit(fa.e1), ay = cross(fa.n, ax), to2d = (p) => [dot(p, ax), dot(p, ay)];
      const area = overlapArea(fa.q.map(to2d), fb.q.map(to2d));
      if (area > 0.03) errs.push(`z-fight: ${fa.k.name} / ${fb.k.name} (${fa.face}/${fb.face}, ${area.toFixed(2)} sq px): move one 0.02-0.05, then paint the step`);
    }
  }
  return { cubes: n, bones: geo.bones.length, errs };
}
