// The person's settings and secrets in one place: <top>/.env (written by hand, see .env.example) and <top>/.env.local
// (written by the lab: `login`, `app token`). Both are git-ignored and never travel in a patch, handoff or update.
//   - every command sees the plain settings (ANTHROPIC_API_KEY, GH_TOKEN, LAB_MODEL, LAB_NOTIFY_WEBHOOK ...) as environment
//     variables; a variable already set outside wins, then .env.local, then .env
//   - passwords and 2FA secrets (*_PASSWORD, *_TOTP_SECRET) and the Google AAS token are NOT put into the environment
//     (servers, AIs and every other child would inherit them): `login` reads them from the files itself (readSecret)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

export const FILES = ['.env.local', '.env'];   // first one wins
export const SECRET = /(_PASSWORD|_TOTP_SECRET|^GOOGLE_AAS_TOKEN)$/;

export function parseEnv(text) {
  const out = {};
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^"(.*)"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    else if (/^'(.*)'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');   // KEY=value # comment
    out[m[1]] = v;
  }
  return out;
}
const read = (f) => { try { return parseEnv(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
/** every key of .env.local + .env (.env.local wins); empty values count as unset */
export function readAll(top) {
  const all = {};
  for (const f of [...FILES].reverse()) for (const [k, v] of Object.entries(read(path.join(top, f)))) if (v !== '') all[k] = v;
  return all;
}
/** the environment gets the plain settings (not the secrets); returns the names it set */
export function loadDotenv(top, env = process.env) {
  const set = [];
  for (const [k, v] of Object.entries(readAll(top))) if (!SECRET.test(k) && (env[k] === undefined || env[k] === '')) { env[k] = v; set.push(k); }
  return set;
}
/** a setting or secret: the environment first (CI secrets), then the files */
export const readSecret = (top, key, env = process.env) => (env[key] || readAll(top)[key] || '').trim();
/** writes keys into .env.local (0600), keeping everything else in it; a null value removes the key */
export function saveLocal(top, updates) {
  const f = path.join(top, '.env.local');
  let lines = []; try { lines = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n'); } catch { lines = ['# bds-lab: settings and secrets written by the lab (login, app token). Never commit or share this file.']; }
  const left = new Map(Object.entries(updates));
  lines = lines.flatMap((l) => {
    const k = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
    if (!k || !left.has(k)) return [l];
    const v = left.get(k); left.delete(k);
    return v === null || v === undefined ? [] : [`${k}=${JSON.stringify(String(v))}`];
  });
  while (lines.length && lines.at(-1) === '') lines.pop();
  for (const [k, v] of left) if (v !== null && v !== undefined) lines.push(`${k}=${JSON.stringify(String(v))}`);
  fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o600 });
  try { fs.chmodSync(f, 0o600); } catch { /* windows */ }
  return f;
}

// ---- the terminal ----
export const canAsk = () => Boolean(process.stdin.isTTY) || Boolean(process.env.LAB_ASK_FILE);
let scripted = null;   // tests: LAB_ASK_FILE = answers, one per line
export async function ask(q, { secret = false, fallback = '' } = {}) {
  if (process.env.LAB_ASK_FILE) {
    scripted ??= fs.readFileSync(process.env.LAB_ASK_FILE, 'utf8').split(/\r?\n/);
    process.stdout.write(q + '\n');
    const a = scripted.shift() ?? '';
    return a.trim() || fallback;
  }
  if (!process.stdin.isTTY) return fallback;
  let rl;
  try { rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); }
  catch (e) {
    // EIO/EBADF: this process no longer owns the terminal (Ctrl-C left it in the background, or the window closed)
    if (/EIO|EBADF|ENOTTY/.test(String(e.code ?? e.message))) { process.stderr.write('\n中断しました（端末から切り離されたので入力を受け取れません）。もう一度実行してください。\n'); process.exit(130); }
    throw e;
  }
  let muted = false;
  if (secret && typeof rl._writeToOutput === 'function') { const w = rl._writeToOutput.bind(rl); rl._writeToOutput = (s) => { if (!muted) w(s); }; }
  const a = await new Promise((res) => { rl.question(q, res); muted = secret; });
  rl.close();
  if (secret) process.stdout.write('\n');
  return a.trim() || fallback;
}
export const yes = async (q, def = true) => { const a = await ask(`${q} ${def ? '[Y/n]' : '[y/N]'} `); return a ? /^(y|yes|はい|うん)$/i.test(a) : def; };

// ---- TOTP (RFC 6238): the 6-digit 2FA code from the secret an authenticator app was given ----
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of clean) { const i = A.indexOf(c); if (i < 0) throw new Error('TOTP secret: not base32'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secret, now = Date.now(), step = 30, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / step)));
  const h = crypto.createHmac('sha1', base32(secret)).update(c).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
