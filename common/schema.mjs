// Behavior/resource pack JSON checked against Mojang's @minecraft/bedrock-schemas, before any server runs (preflight).
// The schemas are draft-07, open (no additionalProperties:false anywhere) and carry mistakes, so raw validation reports errors
// on vanilla files. Every finding here is calibrated instead (data/schema-calibration.json, `node common/schema.mjs calibrate`):
//   - a schema node + keyword that fires on any vanilla file is a quirk: never reported
//   - E (fails the build): a type / enum / required error at a node vanilla reaches and passes, and RULES (what a real BDS
//     refuses that the schemas leave out)
//   - W: the same at a node vanilla never reaches, ranges, lengths, patterns, and keys the schema does not list (a typo: the
//     game ignores it without a word) unless vanilla adds keys there or the same key is listed under that name elsewhere
// Item components come from the package's forms (its item schema has none). A line: `<pack>/<file> <json path>: <what> (got ..)`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAL_FILE = process.env.LAB_SCHEMA_CAL || path.join(HERE, 'data', 'schema-calibration.json');
const PKG = '@minecraft/bedrock-schemas';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const show = (v) => { const s = JSON.stringify(v); return s.length > 40 ? s.slice(0, 37) + '...' : s; };
// keys Mojang's component docs list (node lab.mjs doc) that the schema package leaves out: not typos
const DOC_KEYS = [['/minecraft:icon', 'texture']];
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

// ---------- which schema a pack file follows ----------
const BP_DIRS = { entities: 'bp/entities/index', blocks: 'bp/blocks/index', items: 'bp/items/index', biomes: 'bp/biomes/index',
  features: 'bp/features/index', feature_rules: 'bp/feature_rules/index', loot_tables: 'bp/loot_tables/index', recipes: 'bp/recipes/index',
  spawn_rules: 'bp/spawn_rules/index', trading: 'bp/trading/index', dialogue: 'bp/dialogue/index', animations: 'bp/animations/index',
  animation_controllers: 'bp/animation_controllers/index', shapes: 'bp/voxel_shapes/index', voxel_shapes: 'bp/voxel_shapes/index' };
const RP_DIRS = { entity: 'rp/entity/index', models: 'rp/models/index', fogs: 'rp/fogs/index', particles: 'rp/particles/index',
  attachables: 'rp/attachables/index', render_controllers: 'rp/render_controllers/index', block_culling: 'rp/block_culling/index',
  ui: 'rp/ui/index', lighting: 'rp/deferred_rendering/lighting', color_grading: 'rp/deferred_rendering/color_grading',
  atmospherics: 'rp/deferred_rendering/atmospherics', pbr: 'rp/deferred_rendering/pbr', point_lights: 'rp/deferred_rendering/point_lights',
  shadows: 'rp/deferred_rendering/shadows', water: 'rp/deferred_rendering/water' };
const RP_FILES = { 'manifest.json': 'rp/manifest/index', 'blocks.json': 'rp/textures/blocks_resource', 'biomes_client.json': 'rp/biomes_client/index',
  'sounds/sound_definitions.json': 'rp/sounds/index', 'sounds/music_definitions.json': 'rp/sounds/music_definitions',
  'textures/terrain_texture.json': 'rp/textures/terrain_texture', 'textures/item_texture.json': 'rp/textures/item_texture',
  'textures/flipbook_textures.json': 'rp/textures/flipbook_textures', 'texts/languages.json': 'rp/texts/languages',
  'ui/_global_variables.json': 'rp/ui/global_variables', 'ui/_ui_defs.json': null };
/** the schema (path under schemas/, no .schema.json) for a file of a pack, or null. kind 'bp' | 'rp', rel with / */
export function schemaFor(kind, rel) {
  rel = rel.split(path.sep).join('/');
  if (kind === 'bp') {
    if (rel === 'manifest.json') return 'bp/manifest/index';
    if (rel === 'functions/tick.json') return 'bp/functions/tick';
    return BP_DIRS[rel.split('/')[0]] && rel.includes('/') ? BP_DIRS[rel.split('/')[0]] : null;
  }
  if (rel in RP_FILES) return RP_FILES[rel];
  if (rel.endsWith('.texture_set.json')) return 'rp/textures/texture_set';
  const top = rel.split('/')[0];
  return RP_DIRS[top] && rel.includes('/') ? RP_DIRS[top] : null;
}

// ---------- the validator (the draft-07 subset the package uses) ----------
export function makeStore(root) {
  const cache = new Map();
  // item components are only {type:object} in the package's item schema: built from its forms/item_components instead
  cache.set('bp/items/index', withItemComponents(root));
  const load = (file) => {
    // a $ref to a file the package does not ship (it has a few) accepts anything rather than guessing
    if (!cache.has(file)) { let j = {}; try { j = JSON.parse(fs.readFileSync(path.join(root, file + '.schema.json'), 'utf8')); } catch { /* missing: open */ } cache.set(file, j); }
    return cache.get(file);
  };
  const resolve = (from, ref) => path.posix.normalize(path.posix.join(path.posix.dirname(from), ref)).replace(/\.schema\.json$/, '');
  return { load, resolve };
}

// ---------- item components from the forms (dataType, alternates, choices, isRequired, sub forms) ----------
const DT = { string: 'string', boolean: 'boolean', int: 'integer', float: 'number', number: 'number', object: 'object', objectArray: 'array', stringArray: 'array' };
function withItemComponents(root) {
  const base = path.join(root, 'bp', 'items', 'index.schema.json'), forms = path.join(root, '..', 'forms', 'item_components');
  let j; try { j = JSON.parse(fs.readFileSync(base, 'utf8')); } catch { return {}; }
  const comps = j.properties?.['minecraft:item']?.properties?.components;
  if (!isObj(comps) || comps.properties || !fs.existsSync(forms)) return j;
  const readForm = (id) => { try { return JSON.parse(fs.readFileSync(path.join(root, '..', 'forms', id + '.form.json'), 'utf8')); } catch { return null; } };
  const fieldSchema = (f, depth) => {
    const kinds = [f, ...(f.alternates ?? [])];
    if (kinds.some((k) => !DT[k.dataType])) return {};   // a kind the forms leave vague: anything
    const one = (k) => {
      const t = DT[k.dataType], x = { type: t };
      if (t === 'string' && Array.isArray(k.choices) && k.choices.length && k.choices.length <= 30) x.enum = k.choices.map((c) => c.id ?? c);   // longer lists (sounds, particles) are open
      if ((t === 'integer' || t === 'number') && typeof k.minValue === 'number') x.minimum = k.minValue;
      if ((t === 'integer' || t === 'number') && typeof k.maxValue === 'number') x.maximum = k.maxValue;
      const sub = k.subForm ?? (k.subFormId ? readForm(k.subFormId) : null);
      if (sub?.fields?.length && depth < 4) { const o = formSchema(sub, depth + 1); if (t === 'object') Object.assign(x, o); else if (t === 'array' && k.dataType === 'objectArray') x.items = o; }
      return x;
    };
    return kinds.length === 1 ? one(f) : { anyOf: kinds.map(one) };
  };
  const formSchema = (form, depth = 0) => {
    const properties = {}, required = [];
    for (const f of form.fields ?? []) { if (!f.id || f.isDeprecated) continue; properties[f.id] = fieldSchema(f, depth); if (f.isRequired) required.push(f.id); }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  };
  const properties = {};
  for (const name of fs.readdirSync(forms)) {
    if (!name.startsWith('minecraft_') || !name.endsWith('.form.json')) continue;
    let form; try { form = JSON.parse(fs.readFileSync(path.join(forms, name), 'utf8')); } catch { continue; }
    const id = form.id ?? name.replace(/\.form\.json$/, '').replace(/^minecraft_/, 'minecraft:');
    if (!form.fields?.length) { properties[id] = {}; continue; }
    const obj = formSchema(form), scalar = form.scalarFieldUpgradeName ? form.fields.find((f) => f.id === form.scalarFieldUpgradeName) : form.scalarField;
    properties[id] = scalar ? { anyOf: [obj, fieldSchema(scalar, 9)] } : obj;   // the short form: the value of that one field
  }
  comps.properties = properties;
  return j;
}

/** findings for value against the schema file id: [{ at, node, kw, msg }]; seen(node) is called for every node reached cleanly */
export function validate(store, id, value, { onNode } = {}) {
  const out = [];
  run(id, store.load(id), '', value, '', out, store, onNode);
  return out;
}
function run(file, s, sp, v, at, out, store, onNode) {
  if (!isObj(s)) return;
  if (s.$ref) { const f = store.resolve(file, s.$ref); run(f, store.load(f), '', v, at, out, store, onNode); }
  const node = `${file}#${sp}`, add = (kw, msg) => out.push({ at, node, kw, msg });
  const n0 = out.length, clean = () => !out.slice(n0).some((e) => e.kw !== 'key');
  if (s.type && VERSION_KEY.test(at) && (typeof v === 'string' || (Array.isArray(v) && v.length === 3 && v.every(Number.isInteger)))) return;   // "1.2.3" or [1,2,3]: the game takes both
  if (s.type) {
    const t = typeOf(v), ok = [s.type].flat().some((x) => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { add('type', `must be ${[s.type].flat().join('|')} (got ${t === 'object' || t === 'array' ? t : show(v)})`); return; }
  }
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) add('enum', `must be one of ${s.enum.slice(0, 8).map(show).join(' ')}${s.enum.length > 8 ? ' ...' : ''} (got ${show(v)})`);
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) add('range', `must be ≥ ${s.minimum} (got ${v})`);
    if (s.maximum !== undefined && v > s.maximum) add('range', `must be ≤ ${s.maximum} (got ${v})`);
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) add('range', `must be > ${s.exclusiveMinimum} (got ${v})`);
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) add('length', `must have at least ${s.minLength} characters (got ${show(v)})`);
    if (s.maxLength !== undefined && v.length > s.maxLength) add('length', `must have at most ${s.maxLength} characters`);
    if (s.pattern && !safeRe(s.pattern).test(v)) add('pattern', `must match ${s.pattern} (got ${show(v)})`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) add('length', `must have at least ${s.minItems} items (got ${v.length})`);
    if (s.maxItems !== undefined && v.length > s.maxItems) add('length', `must have at most ${s.maxItems} items (got ${v.length})`);
    if (Array.isArray(s.items)) s.items.forEach((x, i) => i < v.length && run(file, x, `${sp}/items/${i}`, v[i], `${at}/${i}`, out, store, onNode));
    else if (isObj(s.items)) v.forEach((x, i) => run(file, s.items, `${sp}/items`, x, `${at}/${i}`, out, store, onNode));
  }
  if (isObj(v)) {
    for (const r of s.required ?? []) if (!(r in v)) add('required', `needs "${r}"`);
    const props = s.properties ?? {};
    for (const [k, x] of Object.entries(v)) {
      if (k in props) run(file, props[k], `${sp}/properties/${esc(k)}`, x, `${at}/${esc(k)}`, out, store, onNode);
      else if (isObj(s.additionalProperties)) run(file, s.additionalProperties, `${sp}/additionalProperties`, x, `${at}/${esc(k)}`, out, store, onNode);
      else if (s.properties && !s.$ref && !s.anyOf && !s.oneOf && !k.startsWith('$') && !CUSTOM.test(k) && !DOC_KEYS.some(([p, kk]) => kk === k && at.endsWith(p))) out.push({ at, node, kw: 'key', key: k, msg: `unknown key "${k}"${near(k, Object.keys(props)) ? `: did you mean "${near(k, Object.keys(props))}"?` : ' (ignored by the game)'}` });
    }
  }
  for (const kw of ['anyOf', 'oneOf']) {
    if (!Array.isArray(s[kw])) continue;
    const tries = s[kw].map((x, i) => { const o = []; run(file, x, `${sp}/${kw}/${i}`, v, at, o, store, null); return o; });
    const fits = (o) => o.every((e) => e.kw === 'key'), i = tries.findIndex(fits);
    if (i >= 0) { out.push(...tries[i]); if (onNode) run(file, s[kw][i], `${sp}/${kw}/${i}`, v, at, [], store, onNode); continue; }
    // none fits: the branch whose type fits and that fails least says what is wrong; a type mismatch everywhere is one line
    const typed = tries.map((o, i) => ({ o, i })).filter((x) => !x.o.some((e) => e.at === at && e.kw === 'type'));
    if (!typed.length) { const ts = [...new Set(s[kw].map((x) => branchType(store, file, x)).flat().filter(Boolean))]; add('type', `must be ${ts.join('|') || 'another shape'} (got ${typeOf(v) === 'object' || typeOf(v) === 'array' ? typeOf(v) : show(v)})`); continue; }
    const bad = (o) => o.filter((e) => e.kw !== 'key').length, best = typed.sort((a, b) => bad(a.o) - bad(b.o))[0];
    out.push(...best.o);
  }
  if (onNode && clean()) onNode(node);
}
function branchType(store, file, s) {
  if (!isObj(s)) return null;
  if (s.type) return s.type;
  if (s.$ref) { const f = store.resolve(file, s.$ref); return branchType(store, f, store.load(f)); }
  return null;
}
const VERSION_KEY = /\/(format_)?version$|\/min_engine_version$/;
const CUSTOM = /^(?!minecraft:)[a-z0-9_.-]+:[\w.:-]+$/i;   // ns:name with a namespace of its own: a custom component / state, not a typo
const parentOf = (at) => { const i = at.lastIndexOf('/'); return i < 0 ? '' : at.slice(i + 1).replace(/~1/g, '/').replace(/~0/g, '~'); };
const RE = new Map();
const safeRe = (p) => { if (!RE.has(p)) { try { RE.set(p, new RegExp(p, 'u')); } catch { RE.set(p, /(?:)/); } } return RE.get(p); };
function near(k, keys) {
  const d = (a, b) => { const m = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = m[0]; m[0] = i; for (let j = 1; j <= b.length; j++) { const t = m[j]; m[j] = Math.min(m[j] + 1, m[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return m[b.length]; };
  let best = null, bd = Infinity;
  for (const x of keys) { const v = d(k.toLowerCase(), x.toLowerCase()); if (v < bd) { bd = v; best = x; } }
  return best && bd <= Math.max(2, Math.floor(k.length / 4)) ? best : null;
}

// ---------- what a real BDS refuses and the schemas do not say (measured on 1.26.52.3: the whole definition fails to load) ----------
const verOf = (fv) => (Array.isArray(fv) ? fv : String(fv ?? '').split('.')).map(Number);
const atLeast = (fv, want) => { const a = verOf(fv); for (let i = 0; i < want.length; i++) if ((a[i] || 0) !== want[i]) return (a[i] || 0) > want[i]; return true; };
const RULES = {
  'bp/blocks/index': (v, add) => {
    const b = v?.['minecraft:block'];
    const sets = [['/minecraft:block/components', b?.components], ...(Array.isArray(b?.permutations) ? b.permutations.map((x, i) => [`/minecraft:block/permutations/${i}/components`, x?.components]) : [])];
    for (const [at, c] of sets) for (const k of ['minecraft:light_emission', 'minecraft:light_dampening']) {
      const x = c?.[k];
      if (typeof x === 'number' && (x < 0 || x > 15)) add(`${at}/${k}`, `must be 0..15 (got ${x}): the block does not load`);
    }
  },
  'bp/items/index': (v, add) => {
    const m = v?.['minecraft:item']?.components?.['minecraft:max_stack_size'], x = isObj(m) ? m.value : m;
    if (typeof x === 'number' && (x < 1 || x > 64)) add(`/minecraft:item/components/minecraft:max_stack_size${isObj(m) ? '/value' : ''}`, `must be 1..64 (got ${x}): the item does not load`);
  },
  'bp/recipes/index': (v, add) => {
    if (!atLeast(v?.format_version, [1, 20])) return;
    for (const k of ['minecraft:recipe_shaped', 'minecraft:recipe_shapeless']) if (isObj(v?.[k]) && !('unlock' in v[k])) add(`/${k}`, 'needs "unlock" (format_version 1.20+; e.g. "unlock": [{ "item": "<an ingredient>" }]): the recipe does not load');
  },
};
export function bdsRules(id, v) {
  const out = [];
  RULES[id]?.(v, (at, msg) => out.push({ at, node: `rule:${id}`, kw: 'rule', msg }));
  return out;
}

// ---------- calibration (vanilla) and use ----------
let CAL;
export const calibration = () => (CAL ??= fs.existsSync(CAL_FILE) ? JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')) : null);
const keyOf = (f) => `${f.node}:${f.kw}`;
const SEVERE = new Set(['type', 'enum', 'required']);   // + 'rule' (always E)

/** the package's schemas/ folder for the calibrated version, installed once into <cache>/schemas-<version>; null offline */
export function schemaRoot(cache) {
  const cal = calibration();
  if (!cal) return null;
  const dir = path.join(cache, `schemas-${cal.version}`), root = path.join(dir, 'node_modules', ...PKG.split('/'), 'schemas');
  if (process.env.LAB_SCHEMA_ROOT) return process.env.LAB_SCHEMA_ROOT;
  if (fs.existsSync(root)) return root;
  const failed = path.join(dir, '.failed');   // offline: one try an hour, not one per build
  if (fs.existsSync(failed) && Date.now() - fs.statSync(failed).mtimeMs < 3600e3) return null;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}\n');
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'npm.cmd' : 'npm', ['i', `${PKG}@${cal.version}`, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: win });
  if (r.status === 0 && fs.existsSync(root)) { fs.rmSync(failed, { force: true }); return root; }
  fs.writeFileSync(failed, String(r.stderr || r.stdout).slice(-400));
  return null;
}

/** every JSON file of the packs checked: { errs: [line], warns: [line] }; packs = [{ kind: 'bp'|'rp', dir, label }] */
export function checkPacks(root, packs) {
  const cal = calibration(), quirk = new Set(cal?.quirks ?? []), open = new Set(cal?.open ?? []);
  const trusted = new Set(Object.entries(cal?.trusted ?? {}).flatMap(([f, l]) => l.map((sp) => `${f}#${sp}`)));
  const store = makeStore(root), known = keysByParent(root, store), errs = [], warns = [];
  for (const p of packs) {
    for (const f of walk(p.dir)) {
      const rel = path.relative(p.dir, f).split(path.sep).join('/'), id = schemaFor(p.kind, rel);
      if (!id) continue;
      let v; try { v = JSON.parse(stripComments(fs.readFileSync(f, 'utf8'))); } catch { continue; }   // bad JSON: lint() already says so
      let found; try { found = [...validate(store, id, prepare(id, v)), ...bdsRules(id, v)]; } catch { continue; }   // a schema the package lacks: nothing to say
      const seen = new Set();
      for (const x of found) {
        if (x.kw === 'key' && p.kind === 'bp' && x.key.startsWith('minecraft:') && /\/components$|\/component_groups\/[^/]+$/.test(x.at)) continue;   // lint's component check says it, with the forms list
        if (quirk.has(keyOf(x)) || (x.kw === 'key' && (open.has(x.node) || known.get(parentOf(x.at))?.has(x.key)))) continue;
        const line = `${p.label}/${rel} ${x.at || '/'}: ${x.msg}`;
        if (seen.has(line)) continue;
        seen.add(line);
        (x.kw === 'rule' || (SEVERE.has(x.kw) && trusted.has(x.node)) ? errs : warns).push(line);
      }
    }
  }
  return { errs, warns };
}
// a key the schema leaves out at one place but lists under the same property name elsewhere (filters → all_of) is not a typo
function keysByParent(root, store) {
  const known = new Map(), add = (name, keys) => { if (!known.has(name)) known.set(name, new Set()); for (const k of keys) known.get(name).add(k); };
  const propsOf = (file, s, depth = 0) => {
    if (!isObj(s) || depth > 4) return [];
    if (s.$ref) { const f = store.resolve(file, s.$ref); return [...Object.keys(s.properties ?? {}), ...propsOf(f, store.load(f), depth + 1)]; }
    return [...Object.keys(s.properties ?? {}), ...['anyOf', 'oneOf'].flatMap((k) => (s[k] ?? []).flatMap((x) => propsOf(file, x, depth + 1))), ...(isObj(s.items) ? propsOf(file, s.items, depth + 1) : [])];
  };
  const visit = (file, s) => {
    if (Array.isArray(s)) return s.forEach((x) => visit(file, x));
    if (!isObj(s)) return;
    if (isObj(s.properties)) for (const [name, sub] of Object.entries(s.properties)) add(name, propsOf(file, sub));
    for (const v of Object.values(s)) if (typeof v === 'object') visit(file, v);
  };
  for (const f of walkSchemas(root)) visit(f, store.load(f));
  return known;
}
function walkSchemas(root, d = root, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkSchemas(root, p, acc); else if (e.name.endsWith('.schema.json')) acc.push(path.relative(root, p).split(path.sep).join('/').replace(/\.schema\.json$/, '')); }
  return acc;
}
// sound_definitions.json in the older flat form (no "sound_definitions" wrapper) is still read by the game
const prepare = (id, v) => (id === 'rp/sounds/index' && isObj(v) && !('sound_definitions' in v) ? { format_version: '1.14.0', sound_definitions: v } : v);
const stripComments = (t) => t.replace(/^\uFEFF/, '').replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '');
function walk(d, acc = []) {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else if (e.name.endsWith('.json')) acc.push(p); }
  return acc;
}

// node common/schema.mjs calibrate <bedrock-samples checkout> <schemas/ of the package> [<extra pack dirs as bp:dir rp:dir ...>]
//   writes data/schema-calibration.json: quirks (node:keyword that fires on vanilla), trusted (type/enum/required nodes vanilla
//   reaches cleanly), open (objects vanilla adds keys to that the schema does not list)
// node common/schema.mjs check <bp dir> [<rp dir>]  → the findings for those packs (needs the package installed or LAB_SCHEMA_ROOT)
async function main([cmd, ...a]) {
  if (cmd === 'calibrate') {
    const [samples, root, ...extra] = a, store = makeStore(root);
    const version = JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8')).version;
    const quirks = new Set(), trusted = new Set(), open = new Set(), fired = new Set(), ruled = [];
    const packs = [{ kind: 'bp', dir: path.join(samples, 'behavior_pack') }, { kind: 'rp', dir: path.join(samples, 'resource_pack') },
      ...extra.map((x) => ({ kind: x.slice(0, 2), dir: x.slice(3) }))];
    let n = 0;
    for (const p of packs) for (const f of walk(p.dir)) {
      const id = schemaFor(p.kind, path.relative(p.dir, f)); if (!id) continue;
      let v; try { v = JSON.parse(stripComments(fs.readFileSync(f, 'utf8'))); } catch { continue; }
      n++;
      for (const x of bdsRules(id, v)) ruled.push(`${path.relative(samples, f)} ${x.at}: ${x.msg}`);
      for (const x of validate(store, id, prepare(id, v), { onNode: (node) => trusted.add(node) })) { if (x.kw === 'key') open.add(x.node); else quirks.add(keyOf(x)); fired.add(x.node); }
    }
    if (ruled.length) { console.log(`E a BDS rule fires on vanilla (wrong rule: fix RULES):\n  ${ruled.slice(0, 10).join('\n  ')}`); process.exitCode = 1; return; }
    for (const node of fired) trusted.delete(node);
    const byFile = (set) => { const o = {}; for (const x of [...set].sort()) { const [f, sp] = x.split('#'); (o[f] ??= []).push(sp); } return o; };
    const cal = { version, files: n, quirks: [...quirks].sort(), open: [...open].sort(), trusted: byFile(trusted) };
    fs.writeFileSync(CAL_FILE, JSON.stringify(cal));
    console.log(`schema-calibration: @${version} from ${n} files: ${cal.quirks.length} quirks, ${cal.open.length} open objects, ${trusted.size} trusted nodes`);
    return;
  }
  if (cmd === 'check') {
    const root = process.env.LAB_SCHEMA_ROOT || schemaRoot(path.join(HERE, '..', 'bds', '.lab'));
    if (!root) { console.log(`W schema check skipped: cannot install ${PKG}@${calibration()?.version} (network?)`); return; }
    const r = checkPacks(root, a.map((d, i) => ({ kind: i ? 'rp' : 'bp', dir: d, label: i ? 'rp' : 'bp' })));
    r.errs.forEach((e) => console.log('E ' + e)); r.warns.forEach((w) => console.log('W ' + w));
    console.log(r.errs.length ? 'FAIL' : 'OK');
    process.exitCode = r.errs.length ? 1 : 0;
    return;
  }
  console.log('usage: node common/schema.mjs calibrate <bedrock-samples> <schemas dir> [bp:<dir> rp:<dir> ...] | check <bp> [<rp>]');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
