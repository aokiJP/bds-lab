// 配布ワールドの中身を sandbox-be が食える形にする橋渡し。
//
// 配布ワールドの .mcworld には behavior_packs/ が同梱されていることが多く、
// その中の .js は @minecraft/server を使った本物の Script API コードそのもの。
// つまり配布サイトは「実機で動いている Script API の巨大なコーパス」でもある。
// これを sandbox-be に流せば、再現度（coverage）の穴を実物で洗い出せる。
import fs from 'node:fs/promises';
import path from 'node:path';
import * as Z from './zip.js';

/**
 * .mcworld から同梱パックを取り出す。
 * → [{ kind:'behavior'|'resource', dir, name, manifest, scripts:[…], entry }]
 */
export async function extractPacks(file, outDir) {
  const buf = await fs.readFile(file);
  const entries = Z.listEntries(buf);

  // pack ごとに manifest.json の位置でグループ分け
  const manifests = entries.filter((e) => /(behavior_packs|resource_packs)\/[^/]+\/manifest\.json$/i.test(e.name));
  const packs = [];

  for (const m of manifests) {
    const root = m.name.slice(0, m.name.lastIndexOf('/') + 1);
    const kind = /behavior_packs/i.test(root) ? 'behavior' : 'resource';
    let manifest = null;
    try {
      manifest = JSON.parse(Z.readEntry(buf, m).toString('utf8').replace(/^\uFEFF/, ''));
    } catch { /* 壊れたmanifestは名前だけで扱う */ }

    const folder = root.split('/').filter(Boolean).pop();
    const dir = Z.safeJoin(outDir, `${kind === 'behavior' ? 'bp' : 'rp'}/${folder}`);
    const scripts = [];

    for (const e of entries) {
      if (e.dir || !e.name.startsWith(root)) continue;
      const rel = e.name.slice(root.length);
      const dest = Z.safeJoin(dir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Z.readEntry(buf, e));
      if (/\.(js|mjs)$/i.test(rel)) scripts.push(rel);
    }

    // manifest の script モジュールから入口を取る
    const mod = (manifest?.modules || []).find((x) => x.type === 'script');
    packs.push({
      kind, dir, folder,
      name: manifest?.header?.name ?? folder,
      version: manifest?.header?.version ?? null,
      minEngine: manifest?.header?.min_engine_version ?? null,
      entry: mod?.entry ?? null,
      apiVersion: (manifest?.dependencies || []).filter((d) => typeof d.module_name === 'string')
        .map((d) => `${d.module_name}@${d.version}`),
      scripts,
      hasScript: Boolean(mod) || scripts.length > 0,
    });
  }
  return packs;
}

/**
 * 取り出したビヘイビアパックを sandbox-be にかける。
 * runSandbox はファイルを渡せば manifest.json の版と入口を見てくれるので、ここでは結果の要約だけ作る。
 * サンドボックスに無い古い版（@minecraft/server 1.x など）を求めるパックは、remap なら有る版のうち
 * いちばん新しい安定版に読み替えてもう一度動かす（近似。読み替えたことは remapped に残す。実機の BDS は古い安定版も動かす）。
 */
export async function runPack(pack, { runSandbox, ticks = 200, remap = true } = {}) {
  const files = {};
  const walk = async (dir, rel = '') => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(p, r);
      else if (/\.(js|mjs|json)$/i.test(d.name)) files[r] = await fs.readFile(p, 'utf8');
    }
  };
  await walk(pack.dir);
  if (!Object.keys(files).some((f) => /\.(js|mjs)$/i.test(f))) return { skipped: 'スクリプトなし' };

  const once = async (fs2) => {
    const r = await runSandbox({ files: fs2, limits: { ticks } });
    const log = r.report?.log ?? [];
    return {
      verdict: r.verdict,
      errors: (r.fatal ? [r.fatal.message] : log.filter((l) => l.level === 'error').map((l) => l.message)).slice(0, 5),
      warnings: log.filter((l) => l.level === 'warn').length,
      unsupported: Object.keys(r.report?.unsupported ?? {}),
      usage: r.report?.usage ?? {},
      chat: (r.report?.chat ?? []).length,
      versions: r.versions ?? null,
      fatal: r.fatal ?? null,
    };
  };
  try {
    const first = await once(files);
    // 「@minecraft/x 1.11.0 はこのゲーム版（…）にありません。使える版: 2.0.0, 2.1.0, …」
    const m = remap && first.fatal && /^(@minecraft\/[\w-]+) (\S+) は.*使える版: (.+)$/.exec(first.fatal.message);
    if (!m) return first;
    const stable = m[3].split(/,\s*/).filter((v) => !/-/.test(v)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const to = stable.at(-1), key = Object.keys(files).find((k) => /(^|\/)manifest\.json$/.test(k));
    if (!to || !key) return first;
    const man = JSON.parse(files[key].replace(/^\uFEFF/, ''));
    for (const d of man.dependencies ?? []) if (d.module_name === m[1]) d.version = to;
    const again = await once({ ...files, [key]: JSON.stringify(man) });
    return { ...again, remapped: `${m[1]} ${m[2]} → ${to}` };
  } catch (e) {
    return { verdict: 'error', errors: [e.message] };
  }
}

/**
 * 記事の情報から course.json の下書きを作る。
 *
 * 注意: .mcworld の地形は LevelDB のサブチャンクに入っていて、
 * そのまま voxel ワールドには変換できない。ここが作るのは
 *   - 記事から読み取った目標・制限時間・人数などのメタ情報
 *   - 同梱パックへの参照
 * までで、blocks は空のまま。地形が要るなら実機（--bds）で走らせるか、
 * 手で voxel を書き起こす必要がある。
 */
export function draftCourse(post, { packs = [], worldFile = null } = {}) {
  const info = post.info || {};
  const minutes = (() => {
    const m = String(info['想定クリア時間'] ?? '').match(/(\d+)\s*分/);
    return m ? +m[1] : null;
  })();
  return {
    name: post.title,
    description: (post.description || '').slice(0, 200),
    source: { site: 'minecraft-mcworld.com', post: post.id, url: post.url, author: post.author?.name ?? null },
    world: {
      kind: 'voxel',
      // .mcworld の地形は未変換。実機で確かめるならこのファイルを使う
      mcworld: worldFile,
      spawn: null,
      blocks: [],
    },
    packs: packs.filter((p) => p.kind === 'behavior').map((p) => ({ name: p.name, dir: p.dir, entry: p.entry })),
    goal: {
      // 記事の情報から推定。実際の勝利条件は人が書く必要がある
      deadline: minutes ? minutes * 60 * 20 : null,   // tick
      reach: null,
    },
    meta: {
      players: info['想定人数'] ?? null,
      multiplayer: info['マルチプレー'] ?? null,
      difficulty: info['謎解きの難易度'] ?? null,
      horror: info['ホラー'] ?? null,
      gameVersion: info['公開時のマイクラのバージョン'] ?? null,
      streaming: info['動画投稿・配信'] ?? null,
    },
    _note: 'blocks は空。地形は LevelDB のため未変換。実機(--bds)で走らせるか手で書き起こす。',
  };
}
