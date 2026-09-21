import fs from 'node:fs';
import path from 'node:path';
import { readLevelDat, writeLevelDat, TAG } from '../../src/util/nbt.mjs';

export const EXPERIMENTS = {
  gametest: 'gametest',
  beta: 'gametest',
  upcoming: 'upcoming_creator_features',
  data: 'data_driven_items',
  molang: 'experimental_molang_features',
  camera: 'experimental_camera_features',
  villager: 'villager_trades_rebalance',
};

export async function writeExperiments(levelDat, names) {
  const doc = readLevelDat(fs.readFileSync(levelDat));
  const ex = doc.value.experiments?.value ?? {};
  if (names.every((n) => ex[EXPERIMENTS[n] ?? n]?.value === 1)) return false;
  const next = { ...ex };
  for (const n of names) next[EXPERIMENTS[n] ?? n] = { type: TAG.BYTE, value: 1 };
  next.experiments_ever_used = { type: TAG.BYTE, value: 1 };
  next.saved_with_toggled_experiments = { type: TAG.BYTE, value: 1 };
  doc.value.experiments = { type: TAG.COMPOUND, value: next };
  fs.writeFileSync(levelDat, writeLevelDat(doc));
  return true;
}

/**
 * 実験機能を入れた状態で実機を上げる。
 *
 * 素直にやると起動が 2 回要る（1 回目で世界を作り、level.dat に実験機能を書き、2 回目で本番）。
 * ここでは 1 回目で出来た世界を種として残しておき、次回からはそれを写して 1 回で済ませる。
 * 種は BDS の版と実験機能の組み合わせごとに持つので、版を替えれば作り直される。
 */
export async function upWithExperiments(bds, names, opts = {}) {
  const { cacheDir = null, say = () => {} } = opts;
  const levelDat = path.join(bds.worldDir, 'level.dat');
  let boots = 0;

  if (!fs.existsSync(levelDat) && cacheDir && bds.seedWorld(cacheDir)) {
    say('  作り置きの世界を使います（実機の起動は 1 回で済みます）');
    // パックは prepare で置いたあと種で上書きされうるので、置き直す
    bds.writePacks(opts.packs ?? {});
  }
  if (!fs.existsSync(levelDat)) {
    boots++;
    await bds.up(opts);
    await bds.stop();
    bds.lines = [];
    if (cacheDir) { try { bds.snapshotWorld(cacheDir); say('  次回のために世界を取っておきました'); } catch { /* 取れなくても困らない */ } }
  }
  await writeExperiments(levelDat, names);
  opts.onSecondBoot?.();
  boots++;
  await bds.up(opts);
  const active = bds.lines.find((l) => /Experiment\(s\) active/.test(l));
  if (!active) throw new Error(`実験機能（${names.join(', ')}）が有効になりませんでした。level.dat: ${levelDat}`);
  return { line: active, boots };
}
