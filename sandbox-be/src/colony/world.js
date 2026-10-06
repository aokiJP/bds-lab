/**
 * 落としたファイルの解析・変換・導入。
 *   inspect : .mcworld/.zip/.mcpack の中身を読んで正体を判定
 *   repack  : 二重フォルダのzipを正しい .mcworld に組み直す
 *   convert : Java版ワールドを Chunker CLI で統合版に変換 → .mcworld
 *   install : com.mojang/minecraftWorlds に直接展開
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as Z from './zip.js';
import { parseLevelDat, summarize } from './nbt.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * ZIPの中身から正体を判定する。
 *   bedrock-world : level.dat + db/ (leveldb)
 *   java-world    : level.dat + region/*.mca
 *   addon         : manifest.json
 *   unknown       : それ以外
 * root は世界データが入っているzip内のディレクトリ接頭辞。
 */
export async function inspect(file) {
  const buf = await fs.readFile(file);
  const out = { file, size: buf.length, sha256: sha256(buf) };

  let entries;
  try { entries = Z.listEntries(buf); }
  catch (e) { return { ...out, kind: 'not-zip', error: e.message }; }

  out.entries = entries.length;
  const names = entries.map((e) => e.name);

  // level.dat の位置から root を決める
  const lvl = names.find((n) => /(^|\/)level\.dat$/i.test(n));
  const manifest = names.find((n) => /(^|\/)manifest\.json$/i.test(n));

  if (lvl) {
    const root = lvl.slice(0, lvl.length - 'level.dat'.length);
    out.root = root;
    out.nested = root !== '';                       // 二重フォルダかどうか
    const hasDb = names.some((n) => n.startsWith(root + 'db/'));
    const hasRegion = names.some((n) => /\/region\/.+\.mca$/i.test(n) || n.startsWith(root + 'region/'));
    out.kind = hasDb ? 'bedrock-world' : hasRegion ? 'java-world' : 'world-unknown';

    try {
      const parsed = parseLevelDat(Z.readByName(buf, entries, lvl));
      out.level = summarize(parsed);
      if (out.kind === 'world-unknown') out.kind = parsed.edition === 'java' ? 'java-world' : 'bedrock-world';
    } catch (e) { out.levelError = e.message; }

    const nameTxt = Z.readByName(buf, entries, root + 'levelname.txt');
    if (nameTxt) out.levelName = nameTxt.toString('utf8').trim();

    // 同梱アドオン
    out.packs = names.filter((n) => /(behavior_packs|resource_packs)\//i.test(n))
      .map((n) => n.split('/').slice(0, 2).join('/'))
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    out.hasIcon = names.some((n) => /world_icon\.(jpe?g|png)$/i.test(n));
  } else if (manifest) {
    out.kind = 'addon';
    try {
      const j = JSON.parse(Z.readByName(buf, entries, manifest).toString('utf8').replace(/^\uFEFF/, ''));
      out.manifest = {
        name: j.header?.name, description: j.header?.description,
        version: j.header?.version, minEngine: j.header?.min_engine_version,
        modules: (j.modules || []).map((m) => m.type),
      };
    } catch (e) { out.manifestError = e.message; }
  } else {
    out.kind = 'unknown';
  }

  return out;
}

/** ZIPの健全性チェック。途中で切れたDLを検出する */
export async function verify(file) {
  const buf = await fs.readFile(file);
  return Z.verify(buf);
}

/**
 * zip内が `WorldName/level.dat` のように一段深い場合、
 * 統合版がそのままでは読めないので root を剥いで .mcworld に組み直す。
 */
export async function repack(file, outFile) {
  const buf = await fs.readFile(file);
  const entries = Z.listEntries(buf);
  const lvl = entries.find((e) => /(^|\/)level\.dat$/i.test(e.name));
  if (!lvl) throw new Error('level.dat が無い');
  const root = lvl.name.slice(0, lvl.name.length - 'level.dat'.length);
  if (!root) throw new Error('既に正しい構造 (root直下)');

  const files = [];
  for (const e of entries) {
    if (e.dir || !e.name.startsWith(root)) continue;
    files.push({ name: e.name.slice(root.length), data: Z.readEntry(buf, e) });
  }
  const out = Z.writeZip(files);
  await fs.writeFile(outFile, out);
  return { outFile, stripped: root, entries: files.length, size: out.length };
}

// ================================================================ Chunker

/**
 * Java版ワールドを統合版に変換する。
 * Chunker CLI (Microsoft公式ドキュメントのある HiveGamesOSS/Chunker) を使う。
 *   java -jar chunker-cli-X.Y.Z.jar -i <入力> -f BEDROCK_1_21_93 -o <出力>
 * 出力ディレクトリを .mcworld に固めて返す。
 *
 * 注意: プレイヤーのインベントリとエンティティは変換されない (Chunkerの仕様)。
 *       配布ワールドは大抵チェスト配置なので実用上は問題になりにくいが、
 *       元のJava版も保存しておくこと。
 */
export async function convertJavaToBedrock(file, {
  jar, format = 'BEDROCK_1_21_93', outFile, tmpDir = os.tmpdir(), keepDir = false, onLog,
} = {}) {
  if (!jar) throw new Error('chunker-cli の jar パスが必要 (--chunker で指定)');
  await fs.access(jar);

  const work = await fs.mkdtemp(path.join(tmpDir, 'mcw-conv-'));
  const inDir = path.join(work, 'in');
  const outDir = path.join(work, 'out');

  // 入力を展開 (rootが一段深ければ剥ぐ)
  const buf = await fs.readFile(file);
  const entries = Z.listEntries(buf);
  const lvl = entries.find((e) => /(^|\/)level\.dat$/i.test(e.name));
  if (!lvl) throw new Error('level.dat が無い = ワールドではない');
  const root = lvl.name.slice(0, lvl.name.length - 'level.dat'.length);
  for (const e of entries) {
    if (e.dir || !e.name.startsWith(root)) continue;
    const dest = Z.safeJoin(inDir, e.name.slice(root.length));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Z.readEntry(buf, e));
  }

  await run('java', ['-jar', jar, '-i', inDir, '-f', format, '-o', outDir], onLog);

  // 出力を .mcworld へ
  const files = await Z.collectDir(outDir);
  if (!files.length) throw new Error('Chunkerの出力が空');
  const packed = Z.writeZip(files);
  const dest = outFile || file.replace(/\.(zip|mcworld)$/i, '') + `.${format}.mcworld`;
  await fs.writeFile(dest, packed);

  if (!keepDir) await fs.rm(work, { recursive: true, force: true });
  return { outFile: dest, size: packed.length, format, workDir: keepDir ? work : null };
}

function run(cmd, args, onLog) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => onLog?.(d.toString().trimEnd()));
    p.stderr.on('data', (d) => { err += d; onLog?.(d.toString().trimEnd()); });
    p.on('error', (e) => reject(new Error(`${cmd} を実行できない: ${e.message}`)));
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} 終了コード ${c}\n${err.slice(-2000)}`))));
  });
}

export async function hasJava() {
  try { await run('java', ['-version'], () => {}); return true; } catch { return false; }
}

// ================================================================ install

/**
 * OSごとの統合版ワールド保存先（候補を新しい順に）。
 * Windows は 1.21.120 で GDK 版になり、保存先が %APPDATA%\Minecraft Bedrock\Users\<番号>\games\com.mojang に移った
 * （最初にサインインしたアカウントの番号。共有は Users\Shared）。それより前の UWP 版の場所も残す。
 */
export function worldsDirCandidates({ platform = process.platform, env = process.env, home = os.homedir(), list = (d) => { try { return fsSync.readdirSync(d); } catch { return []; } } } = {}) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const users = path.join(roaming, 'Minecraft Bedrock', 'Users');
    const ids = list(users).filter((n) => /^\d+$/.test(n)).sort();
    return [
      ...ids.map((n) => path.join(users, n, 'games', 'com.mojang', 'minecraftWorlds')),
      path.join(users, 'Shared', 'games', 'com.mojang', 'minecraftWorlds'),
      path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang', 'minecraftWorlds'),
    ];
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'mcpelauncher', 'games', 'com.mojang', 'minecraftWorlds')];
  return [path.join(home, '.local', 'share', 'mcpelauncher', 'games', 'com.mojang', 'minecraftWorlds')];
}

/** 統合版ワールドの保存先: 候補のうち、あるもの（無ければ最初の候補） */
export function bedrockWorldsDir(opts) {
  const c = worldsDirCandidates(opts);
  return c.find((d) => fsSync.existsSync(d)) ?? c[0];
}

/**
 * .mcworld を minecraftWorlds に展開する。
 * Minecraftが起動中だとDBが壊れるので、実行前に必ず終了させること。
 */
export async function install(file, { dir, name } = {}) {
  const target = dir || bedrockWorldsDir();
  await fs.mkdir(target, { recursive: true });

  const buf = await fs.readFile(file);
  const entries = Z.listEntries(buf);
  const lvl = entries.find((e) => /(^|\/)level\.dat$/i.test(e.name));
  if (!lvl) throw new Error('level.dat が無い = 統合版ワールドではない');
  const root = lvl.name.slice(0, lvl.name.length - 'level.dat'.length);
  if (entries.some((e) => e.name.startsWith(root + 'region/'))) {
    throw new Error('Java版ワールド。先に convert で変換して');
  }

  const folder = (name || path.basename(file).replace(/\.(mcworld|zip)$/i, ''))
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const dest = path.join(target, folder + '_' + crypto.randomBytes(4).toString('hex'));

  // 名前を全部確かめてから書く（外を指す名前が 1 つでもあれば、何も書かない）
  const todo = entries.filter((e) => !e.dir && e.name.startsWith(root)).map((e) => [e, Z.safeJoin(dest, e.name.slice(root.length))]);
  for (const [e, p] of todo) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, Z.readEntry(buf, e));
  }
  return { dest, entries: todo.length };
}
