// The private cache: what must never be public (the Minecraft APK, the BDS, the Play Store, the device with the account on
// it) is kept between runs only as one sealed file per part, and only for a private repository.
//   seal: tar (sparse) → zstd (gzip without it) → AES-256-GCM → <name>.bin     open: the reverse into a temporary folder,
//   moved into place only when the whole file decrypted and its tag matched (a cut or altered file is a miss, never half a tree)
// The key: APP_CACHE_KEY (a secret of its own), else derived from GOOGLE_AAS_TOKEN (HKDF; the token itself is never
// written anywhere). Its id (a hash of the derived key, not of the secret) is part of the cache names: a new secret is a
// new cache, and an old file opened with the wrong key fails on the id before anything is decrypted.
// In GitHub Actions nothing is sealed or opened unless the workflow says the repository is private (APP_REPO_VISIBILITY
// from github.event.repository.visibility): a public (or internal) repository gets no cache at all, encrypted or not.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { AppError, cleanEnv } from './apk.mjs';

const MAGIC = Buffer.from('BDSLABV1'), HEAD = MAGIC.length + 1 + 8 + 12, TAG = 16;
const COMP = { 1: { name: 'zstd', c: ['zstd', ['-T0', '-3', '-q', '-c']], d: ['zstd', ['-d', '-q', '-c']] }, 2: { name: 'gzip', c: ['gzip', ['-1', '-c']], d: ['gzip', ['-d', '-c']] } };
const has = (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;

/** the key and its id from the environment, or null (pure but for crypto) */
export function vaultKey(env = process.env) {
  const own = env.APP_CACHE_KEY?.trim(), aas = env.GOOGLE_AAS_TOKEN?.trim();
  if (!own && !aas) return null;
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(own || aas), Buffer.from('bds-lab vault salt v1'), Buffer.from(own ? 'app cache key v1' : 'app cache from aas v1'), 32));
  return { key, id: crypto.createHash('sha256').update('bds-lab vault id v1').update(key).digest('hex').slice(0, 16) };
}
/** may this run keep things in the cache? {ok, why} — in GitHub Actions only a private repository (pure) */
export function vaultAllowed(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return { ok: true, why: 'このパソコンのディスクだけ' };
  const v = String(env.APP_REPO_VISIBILITY ?? '').toLowerCase();
  if (v === 'private') return { ok: true, why: 'private リポジトリ' };
  return { ok: false, why: v ? `リポジトリが ${v} です（キャッシュは private だけ）` : 'リポジトリが private か分かりません（APP_REPO_VISIBILITY が無い）' };
}
const waitExit = (c, what) => new Promise((res, rej) => { c.on('error', (e) => rej(new AppError(`${what} を起動できません: ${e.message}`))); c.on('close', (code) => (code === 0 ? res() : rej(new AppError(`${what} が失敗しました（終了コード ${code}）`, c.errText?.trim().slice(-300))))); });
const collect = (c) => { c.errText = ''; c.stderr?.on('data', (d) => { c.errText = (c.errText + d).slice(-2000); }); return c; };

/** base/entries (files or folders under base) → outFile, sealed. Returns {bytes, comp}. tarArgs: more for tar both ways
 *  (redroid's /data: --xattrs --numeric-owner, the Android uids and labels kept) */
export async function seal({ base, entries, outFile, key, tarArgs = [] }) {
  if (!key?.key) throw new AppError('キャッシュの鍵がありません', 'APP_CACHE_KEY か GOOGLE_AAS_TOKEN が要ります。');
  const missing = entries.filter((e) => !fs.existsSync(path.join(base, e)));
  if (missing.length) throw new AppError(`キャッシュに入れるものがありません: ${missing.join(' ')}`);
  const comp = has('zstd') ? 1 : 2, iv = crypto.randomBytes(12);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part`;
  const out = fs.createWriteStream(tmp);
  out.write(Buffer.concat([MAGIC, Buffer.from([comp]), Buffer.from(key.id, 'hex'), iv]));
  const tar = collect(spawn('tar', ['--sparse', ...tarArgs, '-C', base, '-cf', '-', ...entries], { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() }));
  const z = collect(spawn(COMP[comp].c[0], COMP[comp].c[1], { stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv() }));
  const cipher = crypto.createCipheriv('aes-256-gcm', key.key, iv);
  try {
    await Promise.all([pipeline(tar.stdout, z.stdin), pipeline(z.stdout, cipher, out, { end: false }), waitExit(tar, 'tar'), waitExit(z, COMP[comp].name)]);
    await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
    fs.renameSync(tmp, outFile);
  } catch (e) { out.destroy(); fs.rmSync(tmp, { force: true }); throw e; }
  return { bytes: fs.statSync(outFile).size, comp: COMP[comp].name };
}

/** inFile → its entries under dest (each one replaced whole). false (and nothing changed) when it is not ours or does not
 *  decrypt; throws only on a broken machine (no tar) */
export async function open({ inFile, dest, key, log = () => {}, tarArgs = [] }) {
  if (!key?.key || !fs.existsSync(inFile)) return false;
  const size = fs.statSync(inFile).size;
  if (size < HEAD + TAG) { log(`  ${path.basename(inFile)}: 短すぎます（壊れている）`); return false; }
  const fd = fs.openSync(inFile, 'r'), head = Buffer.alloc(HEAD), tag = Buffer.alloc(TAG);
  fs.readSync(fd, head, 0, HEAD, 0); fs.readSync(fd, tag, 0, TAG, size - TAG); fs.closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) { log(`  ${path.basename(inFile)}: キャッシュの形ではありません`); return false; }
  const comp = COMP[head[MAGIC.length]], id = head.subarray(MAGIC.length + 1, MAGIC.length + 9).toString('hex'), iv = head.subarray(MAGIC.length + 9);
  if (!comp) { log(`  ${path.basename(inFile)}: 知らない圧縮`); return false; }
  if (id !== key.id) { log(`  ${path.basename(inFile)}: 別の鍵で作られています（秘密が変わった）`); return false; }
  const tmp = fs.mkdtempSync(path.join(path.dirname(path.resolve(dest)), '.vault-'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, iv); decipher.setAuthTag(tag);
  const z = collect(spawn(comp.d[0], comp.d[1], { stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv() }));
  const tar = collect(spawn('tar', ['--sparse', ...tarArgs, '-C', tmp, '-xf', '-'], { stdio: ['pipe', 'ignore', 'pipe'], env: cleanEnv() }));
  try {
    await Promise.all([pipeline(fs.createReadStream(inFile, { start: HEAD, end: size - TAG - 1 }), decipher, z.stdin), pipeline(z.stdout, tar.stdin), waitExit(z, comp.name), waitExit(tar, 'tar')]);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    log(`  ${path.basename(inFile)}: 開けません（${/auth|unable to authenticate/i.test(e.message) ? '中身が改変されているか、壊れています' : e.message}）`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(tmp)) { const to = path.join(dest, e); fs.rmSync(to, { recursive: true, force: true }); fs.renameSync(path.join(tmp, e), to); }
  fs.rmSync(tmp, { recursive: true, force: true });
  return true;
}
