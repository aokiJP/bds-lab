import fs from 'node:fs';
import path from 'node:path';

const MODULE_KIND = { data: 'behavior', script: 'behavior', resources: 'resource', skin_pack: 'skin', world_template: 'world' };

function readFiles(dir) {
  const files = {};
  const walk = (d, base = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, rel);
      else files[rel] = fs.readFileSync(p);
    }
  };
  walk(dir);
  return files;
}

const asText = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString('utf8') : v]));

/** manifest.json から、そのフォルダが behavior / resource のどちらなのかを決める */
export function packKind(manifest) {
  for (const m of manifest?.modules ?? []) if (MODULE_KIND[m.type]) return MODULE_KIND[m.type];
  return null;
}

function readPack(dir) {
  const raw = readFiles(dir);
  if (!raw['manifest.json']) return null;
  const manifest = JSON.parse(raw['manifest.json'].toString('utf8'));
  return {
    dir,
    manifest,
    kind: packKind(manifest),
    name: path.basename(dir),
    uuid: manifest.header?.uuid,
    version: manifest.header?.version ?? [1, 0, 0],
    // ビヘイビアはテキストとして扱う（差し替えと検査のため）。リソースは画像や音が入るので生のまま持つ
    files: raw,
  };
}

/**
 * アドオンのフォルダを読む。次の 2 つの形を受け付ける。
 *   1. addons/<名前>/manifest.json            … ビヘイビアパックだけ（bds-lab の雛形）
 *   2. addons/<名前>/behavior_pack/ と resource_pack/ … .mcaddon を取り込んだ形
 * リソースパックがあると、BP がリソースパックに依存している .mcaddon もそのまま読み込める。
 */
export function readAddon(dir) {
  const bpDir = fs.existsSync(path.join(dir, 'manifest.json')) ? dir
    : ['behavior_pack', 'behavior', 'bp'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(path.join(p, 'manifest.json')));
  if (!bpDir) throw new Error(`${dir} に manifest.json がありません`);

  const bp = readPack(bpDir);
  const rpDir = ['resource_pack', 'resources', 'rp'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(path.join(p, 'manifest.json')));
  const rp = rpDir ? readPack(rpDir) : null;

  const manifest = bp.manifest;
  const script = manifest.modules?.find((m) => m.type === 'script');
  if (!script) throw new Error(`${bpDir} の manifest.json に script モジュールがありません`);
  const files = asText(bp.files);
  if (!files[script.entry]) throw new Error(`入口のファイルがありません: ${script.entry}`);
  let lab = {};
  try { lab = JSON.parse(fs.readFileSync(path.join(dir, 'lab.json'), 'utf8')); } catch { lab = {}; }

  const name = path.basename(dir);
  return {
    lab: { bds: lab.bds ?? 'stable', preview: Boolean(lab.preview), beta: lab.beta !== false, experiments: lab.experiments ?? ['gametest'] },
    scriptEval: (manifest.capabilities ?? []).includes('script_eval'),
    dir,
    bpDir,
    rpDir: rpDir ?? null,
    files,
    manifest,
    name,
    uuid: manifest.header.uuid,
    version: manifest.header.version ?? [1, 0, 0],
    entry: script.entry,
    serverVersion: manifest.dependencies?.find((d) => d.module_name === '@minecraft/server')?.version ?? '2.10.0',
    rp: rp ? { name: `${name}_rp`, uuid: rp.uuid, version: rp.version, files: rp.files, manifest: rp.manifest } : null,
  };
}

export function asPack(addon) {
  return { name: addon.name, uuid: addon.uuid, version: addon.version, files: addon.files };
}

/** ワールドに入れるリソースパック（無ければ null） */
export function asResourcePack(addon) {
  return addon.rp ? { name: addon.rp.name, uuid: addon.rp.uuid, version: addon.rp.version, files: addon.rp.files } : null;
}
