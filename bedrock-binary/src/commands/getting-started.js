// はじめに: start / doctor
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProfile, loadProfile } from '../analysis/profile.js';
import { fetchServerBinary, resolveDownload, CHANNELS } from '../net/bds.js';
import { PreflightError } from '../lib/preflight.js';
import { str } from '../lib/args.js';
import { profilePath } from '../lib/versions.js';
import { recordProfile } from '../lib/store.js';
import { generateDocs } from './output.js';
import { padDisplay } from '../lib/text.js';

const MIN_NODE = 20;
const NEED_DISK = 1024 ** 3; // BDS の zip と展開後で約 300 MB。余裕を見て 1 GB
const NEED_MEM = 4 * 1024 ** 3;

export const start = {
  group: 'はじめに',
  usage: 'start [--channel release|preview] [--symbols]',
  summary: '最新の BDS を取得 → 解析 → サイト生成まで一度に行う',
  example: 'start',
  heavy: true,
  run: async ({ flags, dirs }) => {
    const channel = str(flags.channel) ?? 'release';
    if (!CHANNELS[channel]) throw new PreflightError(`--channel は ${Object.keys(CHANNELS).join(' か ')} です`);

    console.log(`[1/3] ${channel} の BDS を取得`);
    const bin = await fetchServerBinary(channel, dirs.work, { symbols: flags.symbols ? true : 'auto' });

    console.log(`[2/3] 解析 (${bin.version})`);
    const existing = profilePath(dirs.profiles, channel, bin.version);
    let profile;
    if (fs.existsSync(existing)) {
      console.log(`  解析済みのものを使います: ${existing}`);
      profile = loadProfile(existing);
    } else {
      profile = buildProfile(bin.path, {
        version: bin.version,
        channel,
        symbolsPath: bin.symbolsPath,
        langPath: bin.langPath,
      });
      const rec = recordProfile(profile, dirs);
      console.log(`  → ${rec.profilePath}`);
      if (rec.diffPath) console.log(`  → ${rec.diffPath}`);
    }

    console.log('[3/3] サイトと metadata を生成');
    const { written, site } = generateDocs(profile, dirs.site);
    console.log(`  metadata ${written.length - 1} モジュール / ${site.pages} ページ`);

    const index = path.resolve(dirs.site, 'index.html');
    console.log(`\n完了しました。ブラウザで開いてください:\n  ${index}`);
    console.log(`\nmetadata の JSON はここにあります:\n  ${path.resolve(dirs.site, 'metadata')}`);
  },
};

function check(label, fn) {
  try {
    const r = fn();
    if (r?.warn) return { label, status: 'warn', detail: r.warn, hint: r.hint };
    return { label, status: 'ok', detail: r?.detail ?? '' };
  } catch (e) {
    return { label, status: 'fail', detail: e.message, hint: e.hint };
  }
}

export const doctor = {
  group: 'はじめに',
  usage: 'doctor [--offline]',
  summary: '動かすための条件がそろっているかを確認する',
  example: 'doctor',
  run: async ({ flags, dirs }) => {
    const results = [
      check('Node.js', () => {
        const major = Number(process.versions.node.split('.')[0]);
        if (major < MIN_NODE) throw new PreflightError(`${process.versions.node}（${MIN_NODE} 以上が必要）`, 'https://nodejs.org から LTS 版を入れてください。');
        return { detail: process.versions.node };
      }),
      check('メモリ', () => {
        const total = os.totalmem();
        const gb = (total / 1024 ** 3).toFixed(1);
        if (total < NEED_MEM) return { warn: `${gb} GB`, hint: 'BDS の解析には 4 GB 以上を推奨します。apk の解析は小さいので問題ありません。' };
        return { detail: `${gb} GB` };
      }),
      check('作業フォルダ', () => {
        fs.mkdirSync(dirs.work, { recursive: true });
        const probe = path.join(dirs.work, `.write-test-${process.pid}`);
        fs.writeFileSync(probe, '');
        fs.rmSync(probe);
        if (typeof fs.statfsSync === 'function') {
          const st = fs.statfsSync(dirs.work);
          const free = st.bavail * st.bsize;
          if (free < NEED_DISK) return { warn: `空き ${(free / 1024 ** 3).toFixed(1)} GB`, hint: '1 GB 以上空けてください。' };
          return { detail: `${path.resolve(dirs.work)}（空き ${(free / 1024 ** 3).toFixed(1)} GB）` };
        }
        return { detail: path.resolve(dirs.work) };
      }),
      check('既存のプロファイル', () => {
        const n = fs.existsSync(dirs.profiles) ? fs.readdirSync(dirs.profiles).filter((f) => f.endsWith('.json')).length : 0;
        return { detail: `${n} 件（${dirs.profiles}/）` };
      }),
    ];

    if (!flags.offline) {
      try {
        const r = await resolveDownload('release');
        results.push({ label: 'BDS 配布 API', status: 'ok', detail: `最新 release は ${r.version}` });
      } catch (e) {
        results.push({ label: 'BDS 配布 API', status: 'fail', detail: e.message, hint: 'ネットワークかプロキシの設定を確認してください。オフラインで使うなら --offline。' });
      }
    }

    const mark = { ok: '✓', warn: '!', fail: '✗' };
    for (const r of results) {
      console.log(`${mark[r.status]} ${padDisplay(r.label, 20)} ${r.detail}`);
      if (r.hint && r.status !== 'ok') console.log(`    ${r.hint}`);
    }
    const failed = results.filter((r) => r.status === 'fail').length;
    console.log(failed ? `\n${failed} 件の問題があります。` : '\n準備できています。`npm start` で始められます。');
    if (failed) process.exitCode = 1;
  },
};
