import fs from 'node:fs';
import path from 'node:path';

import { DOWNLOAD_API, pickDownloadUrl } from '../../tools/bds/get.mjs';

const MODULES = ['server', 'server-ui', 'server-gametest', 'server-net', 'server-admin', 'debug-utilities', 'math', 'vanilla-data'];
const REGISTRY = 'https://registry.npmjs.org';

const num = (s) => (/^\d+$/.test(s) ? Number(s) : s);

/**
 * 新しいほうを選ぶ。1 なら a のほうが新しい。
 * `-` の前（1.26.51.1 のような数字の並び）を先に比べ、同じなら `-` の後ろを見る。
 * 事前公開が付かないほうが新しい（2.10.0 > 2.10.0-beta.1）。
 */
export function newer(a, b) {
  const cut = (v) => { const i = String(v).indexOf('-'); return i < 0 ? [String(v), ''] : [String(v).slice(0, i), String(v).slice(i + 1)]; };
  const parts = (v) => v.split(/[.+]/).filter(Boolean).map(num);
  const cmp = (x, y) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i];
      const q = y[i];
      if (p === q) continue;
      if (p === undefined) return -1;   // 数字の並びは、長いほうが新しい（1.26.51.1 > 1.26.51）
      if (q === undefined) return 1;
      if (typeof p === 'number' && typeof q === 'number') return p > q ? 1 : -1;
      return String(p) > String(q) ? 1 : -1;
    }
    return 0;
  };
  const [ra, pa] = cut(a);
  const [rb, pb] = cut(b);
  const base = cmp(parts(ra), parts(rb));
  if (base !== 0) return base;
  if (!pa && !pb) return 0;
  if (!pa) return 1;                     // 事前公開が付かないほうが新しい
  if (!pb) return -1;
  return cmp(parts(pa), parts(pb));
}

/** npm の版の文字列から、どの系統のものかを決める */
export function trackOf(version) {
  if (!version.includes('-')) return 'stable';
  const preview = /-preview\.\d+$/.test(version);
  if (/-beta\./.test(version)) return preview ? 'preview_beta' : 'beta';
  if (/-rc\./.test(version)) return preview ? 'preview' : 'rc';
  return null;
}

/** npm の版の一覧を、stable / beta / preview / preview_beta に振り分ける */
export function pickTracks(versions) {
  const out = {};
  for (const v of versions) {
    if (/-internal|-alpha/.test(v)) continue;
    const track = trackOf(v);
    if (!track) continue;
    if (!out[track] || newer(v, out[track]) > 0) out[track] = v;
  }
  return out;
}

async function fetchJson(url, timeoutMs = 60000) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function updateModules({ ROOT, say }) {
  const file = path.join(ROOT, 'data', 'minecraft-modules.json');
  let have = {};
  try { have = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { have = {}; }
  const out = { ...have };
  const changed = [];
  const failed = [];

  for (const name of MODULES) {
    try {
      const doc = await fetchJson(`${REGISTRY}/@minecraft/${encodeURIComponent(name)}`);
      const tracks = pickTracks(Object.keys(doc.versions ?? {}));
      if (!Object.keys(tracks).length) { failed.push(`${name}: 版が読めません`); continue; }
      const versions = {};
      for (const [track, version] of Object.entries(tracks)) {
        versions[track] = {
          version,
          npm: `npm i @minecraft/${name}@${version}`,
          download: doc.versions?.[version]?.dist?.tarball ?? `${REGISTRY}/@minecraft/${name}/-/${name}-${version}.tgz`,
        };
      }
      const before = have[name]?.versions ?? {};
      for (const [track, v] of Object.entries(versions)) {
        if (before[track]?.version !== v.version) changed.push(`${name} ${track}: ${before[track]?.version ?? '無し'} → ${v.version}`);
      }
      out[name] = { modified: Math.floor(Date.now() / 1000), versions };
    } catch (e) {
      failed.push(`${name}: ${String(e.message ?? e)}`);
    }
  }
  if (Object.keys(out).length) fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return { changed, failed };
}

async function updateBds({ ROOT, say }) {
  const file = path.join(ROOT, 'data', 'bds-versions.json');
  let have = {};
  try { have = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { have = {}; }
  const changed = [];
  const failed = [];
  let doc = null;
  try { doc = await fetchJson(DOWNLOAD_API); } catch (e) { return { changed, failed: [`BDS の配布 API: ${String(e.message ?? e)}`] }; }

  const out = { ...have };
  for (const kind of ['linux', 'windows']) {
    for (const [track, preview] of [['stable', false], ['preview', true]]) {
      const url = pickDownloadUrl(doc, { kind, preview });
      const v = url && /bedrock-server-([\d.]+)\.zip/.exec(url)?.[1];
      if (!v) { failed.push(`${kind}/${track}: 配布 API に出ていません`); continue; }
      out[kind] = out[kind] ?? { stable: null, preview: null, versions: [] };
      if (out[kind][track] !== v) changed.push(`BDS ${kind} ${track}: ${out[kind][track] ?? '無し'} → ${v}`);
      out[kind][track] = v;
      out[kind].versions = [...new Set([v, ...(out[kind].versions ?? [])])].sort((a, b) => newer(b, a)).slice(0, 40);
      if (!out.cdn_root) out.cdn_root = url.replace(/\/bin-[^/]+\/bedrock-server-[\d.]+\.zip$/, '');
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return { changed, failed };
}

/** BDS とモジュールの版の一覧を、公式の配布 API と npm から取り直す */
export async function update({ ROOT, say = console.log }) {
  say('公式の配布 API と npm から、いまの版を取り直しています…');
  const bds = await updateBds({ ROOT, say });
  const mods = await updateModules({ ROOT, say });
  const changed = [...bds.changed, ...mods.changed];
  const failed = [...bds.failed, ...mods.failed];

  say('');
  if (changed.length) { for (const c of changed) say(`  ${c}`); }
  else say('  すべて最新でした');
  for (const f of failed) say(`  ⚠ ${f}`);
  if (changed.some((c) => c.startsWith('BDS'))) say('\n  新しい BDS を使うには: vendor/ を消して npm start（落とし直します）');
  if (changed.some((c) => !c.startsWith('BDS'))) say('  新しい型定義を入れるには: npm run docs');
  return { ok: failed.length === 0, changed, failed };
}
