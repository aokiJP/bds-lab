import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractZip } from '../../tools/bds/get.mjs';
import { packKind } from '../verify/addon.mjs';
import { manifestVersion, moduleData } from '../util/modules.mjs';

// 「The Unstable Smp V2 [BP]」→「the_unstable_smp_v2」。末尾の [BP] / _bp は分け方の印なので落とす
const slug = (s) => String(s)
  .replace(/\[(bp|rp|behaviou?r|resource)s?\]/ig, ' ')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_')
  .replace(/_(bp|rp|behaviou?r|resource|pack)$/g, '')
  .replace(/^_|_$/g, '').slice(0, 24) || 'imported';

/** 中の manifest.json を全部探して、どの種類のパックなのかを見る */
export function findPacks(root) {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 6) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (list.some((e) => e.isFile() && e.name === 'manifest.json')) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
        out.push({ dir: d, manifest, kind: packKind(manifest), name: manifest.header?.name ?? path.basename(d) });
      } catch { /* 読めない manifest は飛ばす */ }
      return;   // パックの中に入れ子のパックは無い
    }
    for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX') walk(path.join(d, e.name), depth + 1);
  };
  walk(root);
  return out;
}

/** 実機に載っている版と食い違っていないかを見る（古い .mcaddon はここで分かる） */
export function checkModules(manifest) {
  const known = moduleData();
  const notes = [];
  for (const d of manifest.dependencies ?? []) {
    if (!d.module_name) continue;
    const name = String(d.module_name).replace('@minecraft/', '');
    const entry = known[name];
    if (!entry) { notes.push({ module: d.module_name, version: d.version, why: 'この道具が版を把握していないモジュールです', now: null }); continue; }
    const now = manifestVersion(name, String(d.version).includes('beta') ? 'beta' : 'stable');
    const major = (v) => String(v).split('.')[0];
    if (now && major(now) !== major(d.version)) {
      notes.push({ module: d.module_name, version: d.version, why: `いまの実機は ${now} 系です。${d.version} は読み込めない可能性があります`, now });
    }
  }
  return notes;
}

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
};

const count = (dir, sub) => { try { return fs.readdirSync(path.join(dir, sub)).length; } catch { return 0; } };

function specFor(id, addon) {
  const tag = id.toUpperCase().slice(0, 16);
  return `/** @type {import('../types/spec').Spec[]} */
// ${addon.name} を取り込んだときに自動で作った仕様書。
// ここは「壊れていないこと」しか見ていません。作りたい挙動は自分で足してください。
export default [
  {
    name: 'パックが実機に読み込まれる',
    why: 'manifest の版・依存・入口が正しいことを、実機で確かめる',
    async run(t) {
      await t.expectNoLog(/SyntaxError|ReferenceError|Import \\[.*\\] not found/);
      const me = await t.spawn();
      t.note(\`プレイヤー: \${me.name}\`);
      t.expect(true);
    },
  },
  {
    name: 'しばらく動かしても例外が出ない',
    why: '読み込み直後だけでなく、毎 tick の処理が落ちないことを見る',
    async run(t) {
      await t.spawn();
      await t.ticks(60);
      await t.expectNoLog(/TypeError|ReferenceError|is not a function/);
    },
  },
${addon.entities ? `  {
    name: '同梱のエンティティを実機が知っている',
    why: 'entities/*.json が読まれているかを、実際に湧かせて確かめる',
    async run(t) {
      await t.spawn();
      await t.tp({ x: 0, y: -59, z: 0 });
      const before = await t.entities();
      t.note(\`いま居るもの: \${before.length} 体\`);
      t.expect(true, 'ここに、湧かせたいエンティティの ID を書いて確かめてください（${tag}）');
    },
  },
` : ''}  {
    name: '本物のクライアントで入っても壊れない',
    why: 'SimulatedPlayer では出ない、クライアント越しの経路を見る',
    tags: ['real'],
    async run(t) {
      await t.gamemode('Creative');
      await t.tp({ x: 0, y: -39, z: 0 }, { x: 0, y: 0 });
      await t.ticks(20);
      await t.expectNoLog(/SyntaxError|ReferenceError|TypeError/);
    },
  },
];
`;
}

/**
 * 既にある .mcaddon / .mcpack / zip / フォルダを取り込んで、bds-lab のアドオンにする。
 * ビヘイビアパックとリソースパックを分けて置くので、RP に依存している BP もそのまま実機に載る。
 */
export async function importAddon({ ROOT, file, name = null, say = console.log, force = false }) {
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-import-'));
  try {
    let root = path.resolve(file);
    if (fs.statSync(root).isFile()) {
      say(`${path.basename(file)} を開いています…`);
      extractZip(root, tmp);
      root = tmp;
    }

    const packs = findPacks(root);
    if (!packs.length) throw new Error('manifest.json が見つかりません（.mcaddon / .mcpack / パックのフォルダを渡してください）');

    const behaviors = packs.filter((p) => p.kind === 'behavior');
    const resources = packs.filter((p) => p.kind === 'resource');
    const scripted = behaviors.filter((p) => (p.manifest.modules ?? []).some((m) => m.type === 'script'));
    if (!behaviors.length) throw new Error(`ビヘイビアパックが入っていません（見つかったのは ${packs.map((p) => p.kind ?? '不明').join(' / ')}）`);
    const bp = scripted[0] ?? behaviors[0];
    const rp = resources[0] ?? null;

    say(`  見つけたパック: ${packs.map((p) => `${p.name}（${p.kind ?? '不明'}）`).join(' / ')}`);
    if (behaviors.length > 1) say(`  ビヘイビアが ${behaviors.length} 個あります。${bp.name} を使います`);

    const id = slug(name ?? bp.manifest.header?.name ?? path.basename(file, path.extname(file)));
    const dest = path.join(ROOT, 'addons', id);
    if (fs.existsSync(dest) && !force) throw new Error(`addons/${id} がすでにあります（別の名前を渡すか、消してから）`);
    fs.rmSync(dest, { recursive: true, force: true });

    copyDir(bp.dir, path.join(dest, 'behavior_pack'));
    if (rp) copyDir(rp.dir, path.join(dest, 'resource_pack'));

    const script = (bp.manifest.modules ?? []).find((m) => m.type === 'script');
    const entry = script?.entry ?? null;
    const beta = (bp.manifest.dependencies ?? []).some((d) => String(d.version).includes('beta'));
    fs.writeFileSync(path.join(dest, 'lab.json'), `${JSON.stringify({
      bds: 'stable', preview: false, beta, experiments: ['gametest'], imported: { from: path.basename(file), at: new Date().toISOString() },
    }, null, 2)}\n`);

    const info = {
      name: bp.manifest.header?.name ?? id,
      entry,
      entities: count(bp.dir, 'entities'),
      items: count(bp.dir, 'items'),
      blocks: count(bp.dir, 'blocks'),
      scripts: entry ? Object.keys(listScripts(path.join(dest, 'behavior_pack'))).length : 0,
      rp: rp?.manifest.header?.name ?? null,
      scriptEval: (bp.manifest.capabilities ?? []).includes('script_eval'),
    };

    const specFile = path.join(ROOT, 'specs', `${id}.spec.mjs`);
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    if (!fs.existsSync(specFile)) fs.writeFileSync(specFile, specFor(id, info));

    const task = path.join(dest, 'TASK.md');
    if (!fs.existsSync(task)) {
      fs.writeFileSync(task, [
        `# 依頼書 — ${id}（取り込み）`, '',
        '## 作るもの', '',
        `${info.name} を取り込みました。直したいところ・足したい挙動をここに書いてください。`, '',
        '## 受け入れ条件', '',
        '- [ ] （実機で確かめられる形で書く。1 行 = specs の 1 本）', '',
        '## やってはいけないこと', '',
        '- 仕様書（specs/）を、通すために緩めること', '',
      ].join('\n'));
    }

    const warnings = checkModules(bp.manifest);
    say('');
    say(`取り込みました: addons/${id}/`);
    say(`  ビヘイビア: ${info.name}${entry ? `（入口 ${entry}・スクリプト ${info.scripts} 本）` : '（スクリプト無し）'}`);
    if (rp) say(`  リソース: ${info.rp}（実機にも一緒に載せます）`);
    else say('  リソースパックはありません');
    const parts = [['エンティティ', info.entities], ['アイテム', info.items], ['ブロック', info.blocks]].filter(([, n]) => n > 0);
    if (parts.length) say(`  中身: ${parts.map(([k, n]) => `${k} ${n}`).join(' / ')}`);
    if (!info.scriptEval) say('  ⚠ manifest に script_eval がないので、入れ替えは毎回の読み直しになります（遅いだけで動きます）');
    for (const w of warnings) say(`  ⚠ ${w.module} ${w.version}: ${w.why}`);
    say(`  仕様書: specs/${id}.spec.mjs（中身は空に近いので、確かめたいことを足してください）`);
    say('');
    say('次にすること');
    say(`  node bin/bds-lab.mjs inspect -- --addon ${id}   実機を上げずに、壊れていないかを見る`);
    say(`  node bin/bds-lab.mjs check -- --addon ${id}     実機で動かす`);
    return { id, dir: dest, info, warnings };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** パックの中の .js を { 相対パス: 中身 } で集める */
export function listScripts(bpDir) {
  const out = {};
  const walk = (d, base = '') => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const rel = base ? `${base}/${e.name}` : e.name;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.js')) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(path.join(bpDir, 'scripts'), 'scripts');
  return out;
}
