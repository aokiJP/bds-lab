// JSON UI (rp/ui/*.json) checked without the game: BDS never loads resource-pack UI and a wrong name fails silently in the client.
// Resolves every @-reference and element/texture path against the addon's own UI and the vanilla UI of Mojang's bedrock-samples.
// Value lists: gamezaSRC/JSON-UI-Web-Editor (MIT, via boredape874/mcbejsonuimasterAI data/jsonui-spec.json) plus every value vanilla uses.
import fs from 'node:fs';
import path from 'node:path';

export const SPEC = {
  type: ['panel', 'stack_panel', 'grid', 'label', 'image', 'button', 'toggle', 'slider', 'slider_box', 'edit_box', 'dropdown', 'scroll_view', 'scrollbar_box', 'scrollbar_track', 'factory', 'screen', 'custom', 'selection_wheel', 'tab', 'carousel_label', 'grid_item', 'input_panel', 'collection_panel', 'tooltip_trigger'],
  anchor: ['top_left', 'top_middle', 'top_right', 'left_middle', 'center', 'right_middle', 'bottom_left', 'bottom_middle', 'bottom_right'],
  orientation: ['horizontal', 'vertical'],
  font_size: ['small', 'normal', 'large', 'extra_large'],
  font_type: ['default', 'smooth', 'rune', 'MinecraftTen', 'unicode'],
  text_alignment: ['left', 'center', 'right'],
  binding_type: ['global', 'collection', 'collection_details', 'view', 'none'],
  binding_condition: ['always', 'visible', 'once', 'always_when_visible', 'visibility_changed', 'none'],
  anim_type: ['alpha', 'color', 'size', 'offset', 'uv', 'flip_book', 'wait', 'aseprite_flip_book', 'clip'],
  operation: ['insert_back', 'insert_front', 'insert_after', 'insert_before', 'move_back', 'move_front', 'move_after', 'move_before', 'swap', 'remove', 'replace'],
};
const FIELD = { type: 'type', anchor_from: 'anchor', anchor_to: 'anchor', orientation: 'orientation', font_size: 'font_size', font_type: 'font_type', text_alignment: 'text_alignment' };
const isVar = (v) => typeof v === 'string' && /^[$#]/.test(v);
export const strip = (s) => {   // comments out of JSON (UI files have them), strings kept
  let o = '', i = 0, q = false;
  while (i < s.length) {
    const c = s[i];
    if (q) { o += c; if (c === '\\') { o += s[i + 1] ?? ''; i += 2; continue; } if (c === '"') q = false; i++; continue; }
    if (c === '"') { q = true; o += c; i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); i = i < 0 ? s.length : i + 2; continue; }
    o += c; i++;
  }
  return o.replace(/,(\s*[}\]])/g, '$1');
};
function nearest(w, list) {
  let best = null, bd = 99;
  for (const c of new Set(list)) {
    const d = Array.from({ length: c.length + 1 }, (_, i) => i);
    for (let i = 1; i <= w.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= c.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (w[i - 1] === c[j - 1] ? 0 : 1)); p = t; } }
    if (d[c.length] < bd) { bd = d[c.length]; best = c; }
  }
  return bd <= Math.max(2, Math.floor(w.length / 4)) ? best : null;
}
export const parseUi = (text) => JSON.parse(strip(text.replace(/^﻿/, '')));

// the vanilla side: namespace -> element names, file -> namespace, every enum value vanilla uses, texture paths
export function vanillaUiIndex(uiDir, texturePaths) {
  const ns = {}, files = {}, seen = Object.fromEntries(Object.keys(SPEC).map((k) => [k, new Set()]));
  // every file under ui/, sub-folders too (settings_sections/settings_common.json holds settings_common: packs build on it)
  const all = []; const walkDir = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walkDir(path.join(d, e.name), r); else if (e.name.endsWith('.json')) all.push(r); } };
  walkDir(uiDir, '');
  for (const f of all) {
    let j; try { j = parseUi(fs.readFileSync(path.join(uiDir, f), 'utf8')); } catch { continue; }
    if (!j.namespace) continue;
    files[f] = j.namespace;
    const set = (ns[j.namespace] ??= []);
    for (const k of Object.keys(j)) if (k !== 'namespace') set.push(k.split('@')[0]);
    walk(j, (node) => {
      for (const [k, kind] of Object.entries(FIELD)) if (typeof node[k] === 'string' && !isVar(node[k])) seen[kind].add(node[k]);
      for (const b of Array.isArray(node.bindings) ? node.bindings : []) { if (typeof b?.binding_type === 'string') seen.binding_type.add(b.binding_type); if (typeof b?.binding_condition === 'string') seen.binding_condition.add(b.binding_condition); }
    });
  }
  return { ns, files, values: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])), textures: texturePaths };
}
function walk(j, fn) {
  const seen = new Set();
  const go = (v) => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v); if (!Array.isArray(v)) fn(v); for (const x of Array.isArray(v) ? v : Object.values(v)) go(x); };
  go(j);
}

// rp: the addon's resource pack dir; van: vanillaUiIndex(...) or null (then only local checks). Returns warning lines.
export function lintUi(rp, van) {
  const dir = path.join(rp, 'ui'), W = [];
  if (!fs.existsSync(dir)) return W;
  const rel = (f) => 'rp/' + path.relative(rp, f).split(path.sep).join('/');
  const list = []; const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkDir(p); else if (e.name.endsWith('.json')) list.push(p); } }; walkDir(dir);
  const docs = new Map();
  for (const f of list) { try { docs.set(f, parseUi(fs.readFileSync(f, 'utf8'))); } catch (e) { W.push(`${rel(f)}: not JSON: ${e.message}`); } }
  const defsFile = path.join(dir, '_ui_defs.json'), defs = new Set((docs.get(defsFile)?.ui_defs ?? []).map((x) => String(x).replace(/\\/g, '/')));
  for (const d of defs) if (!fs.existsSync(path.join(rp, d))) W.push(`rp/ui/_ui_defs.json: ${d} does not exist`);
  const vals = Object.fromEntries(Object.entries(SPEC).map(([k, v]) => [k, new Set([...v, ...(van?.values?.[k] ?? [])])]));
  // own namespaces
  const own = {};
  for (const [, j] of docs) { if (!j.namespace) continue; for (const k of Object.keys(j)) if (k !== 'namespace') (own[j.namespace] ??= new Set()).add(k.split('@')[0]); }
  const has = (n, e) => own[n]?.has(e) || van?.ns?.[n]?.includes(e);
  const known = (n) => own[n] || van?.ns?.[n];
  const texOk = (t) => { const x = t.replace(/\.(png|tga|jpg|jpeg)$/i, ''); return ['.png', '.tga', '.jpg', '.jpeg'].some((e) => fs.existsSync(path.join(rp, x + e))) || !van?.textures || van.textures.has(x.toLowerCase()); };
  for (const [f, j] of docs) {
    const base = path.basename(f), r = rel(f);
    if (base === '_ui_defs.json' || base === '_global_variables.json') continue;
    const vfile = van?.files?.[path.relative(dir, f).split(path.sep).join('/')] ?? van?.files?.[base];
    // a file at a vanilla screen's path merges into that screen: its namespace is the vanilla file's (TS REPL's
    // ui/server_form.json changes third_party_server_screen that way); anywhere else no namespace = unreachable
    if (typeof j.namespace !== 'string') { if (vfile) { j.namespace = vfile; (own[vfile] ??= new Set()); for (const k of Object.keys(j)) if (k !== 'namespace') own[vfile].add(k.split('@')[0]); } else { W.push(`${r}: no "namespace": every element in it is unreachable`); continue; } }
    const relUi = 'ui/' + path.relative(dir, f).split(path.sep).join('/');
    if (vfile) { if (vfile !== j.namespace) W.push(`${r}: namespace "${j.namespace}", but the vanilla ${base} is "${vfile}": this makes a new namespace instead of changing the vanilla screen`); }
    else if (!defs.has(relUi)) W.push(`${r}: not listed in rp/ui/_ui_defs.json ("ui_defs": ["${relUi}"]): the game never loads it`);
    // name@base: base is namespace.element, or an element found by name (vanilla itself leans on that); without the vanilla index only this pack is known
    const anyHas = (e) => Object.values(own).some((x) => x.has(e)) || Object.values(van?.ns ?? {}).some((x) => x.includes(e));
    const ref = (at, where) => {
      at = at.replace(/^@/, '');
      if (isVar(at) || at.includes('$')) return;
      if (!at.includes('.')) { if (van && !anyHas(at)) W.push(`${r} ${where}: no element ${at} anywhere (write namespace.element)`); return; }
      const [n, e] = at.split('.', 2);
      if (!known(n)) { if (van) W.push(`${r} ${where}: namespace "${n}" does not exist`); }
      else if (!has(n, e)) { const near = nearest(e, [...(own[n] ?? []), ...(van?.ns?.[n] ?? [])]); W.push(`${r} ${where}: ${n}.${e} does not exist${near ? `: did you mean ${n}.${near}?` : ''}`); }
    };
    const node = (name, v, where) => {
      if (name.includes('@')) ref(name.slice(name.indexOf('@') + 1), `${where}${name}`);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return;
      const here = `${where}${name.split('@')[0]}`;
      for (const [k, kind] of Object.entries(FIELD)) if (typeof v[k] === 'string' && !isVar(v[k]) && !vals[kind].has(v[k])) W.push(`${r} ${here}: ${k} "${v[k]}" is not one of ${[...vals[kind]].slice(0, 12).join(' ')}`);
      for (const [i, b] of (Array.isArray(v.bindings) ? v.bindings : []).entries()) {
        if (typeof b?.binding_type === 'string' && !isVar(b.binding_type) && !vals.binding_type.has(b.binding_type)) W.push(`${r} ${here} bindings[${i}]: binding_type "${b.binding_type}" (${[...vals.binding_type].join(' ')})`);
        if (typeof b?.binding_condition === 'string' && !isVar(b.binding_condition) && !vals.binding_condition.has(b.binding_condition)) W.push(`${r} ${here} bindings[${i}]: binding_condition "${b.binding_condition}"`);
        if (b?.binding_type === 'view' && (!b.source_property_name || !b.target_property_name)) W.push(`${r} ${here} bindings[${i}]: a view binding needs source_property_name and target_property_name`);
        if (b?.binding_type === 'collection' && !b.binding_collection_name && !v.collection_name) W.push(`${r} ${here} bindings[${i}]: a collection binding needs binding_collection_name`);
      }
      if (typeof v.texture === 'string' && !isVar(v.texture) && v.texture && !texOk(v.texture)) W.push(`${r} ${here}: texture ${v.texture} is in neither this pack nor vanilla`);
      if (typeof v.grid_item_template === 'string') ref(v.grid_item_template, `${here}.grid_item_template`);
      // variables that name a control ("$child_control": "ns.element"); other dotted values are localization keys
      for (const [k, x] of Object.entries(v)) if (/^\$(child_control|.*_(control|panel|content|template|renderer))$/.test(k) && typeof x === 'string' && /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(x) && known(x.split('.')[0]) && !has(...x.split('.'))) W.push(`${r} ${here}.${k}: ${x} does not exist`);
      for (const m of Array.isArray(v.modifications) ? v.modifications : []) {
        if (m && typeof m.operation === 'string' && !vals.operation.has(m.operation)) W.push(`${r} ${here} modifications: operation "${m.operation}" (${SPEC.operation.join(' ')})`);
        for (const c of Array.isArray(m?.value) ? m.value : []) if (c && typeof c === 'object') for (const [cn, cv] of Object.entries(c)) node(cn, cv, `${here} modifications > `);
      }
      if (v.controls !== undefined) {
        if (isVar(v.controls)) { /* a variable holds them */ } else if (!Array.isArray(v.controls)) W.push(`${r} ${here}: controls must be an array of { "name": {...} }`);
        else for (const c of v.controls) { if (!c || typeof c !== 'object' || Object.keys(c).length !== 1) { W.push(`${r} ${here}: each controls entry is one { "name@base": {...} }`); continue; } const [cn, cv] = Object.entries(c)[0]; node(cn, cv, `${here} > `); }
      }
      if (v.anims !== undefined) for (const a of [].concat(v.anims)) if (typeof a === 'string' && a.startsWith('@')) ref(a.slice(1), `${here}.anims`);
      if (v.anim_type !== undefined && typeof v.anim_type === 'string' && !isVar(v.anim_type) && !vals.anim_type.has(v.anim_type)) W.push(`${r} ${here}: anim_type "${v.anim_type}"`);
    };
    for (const [k, v] of Object.entries(j)) if (k !== 'namespace') node(k, v, '');
  }
  return [...new Set(W)];
}
