// コース（検証したいマップ／ゲームと目標）を読んで、ワールドを作る。
//
// コースの形（examples/athletic/course.json・examples/js-games/*/course.json）:
//   {
//     "name": "…",
//     "world": { "kind": "voxel", … } | { "kind": "js", "entry": "game.js", … },
//     "goal": { "reach": …, "avoid": …, "deadline": … },
//     "tape": "solution.json"            // あれば、既知のテープ（回帰テスト用）
//   }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoxelWorld } from './worlds/voxel.js';
import { createJsGameWorld } from './worlds/js-game.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export function loadPlayerPhysics() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'player-physics.json'), 'utf8'));
}

/** コースのファイルを読む（相対パスはコースのファイルの場所から） */
export function readCourse(file) {
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  course.baseDir = path.dirname(path.resolve(file));
  return course;
}

/** コースからワールドを作る */
export function createWorld(course) {
  const w = course.world ?? {};
  const kind = w.kind ?? 'voxel';
  if (kind === 'voxel') return createVoxelWorld({ ...w, profile: w.profile ?? loadPlayerPhysics() });
  if (kind === 'js') return createJsGameWorld({ ...w, baseDir: course.baseDir ?? process.cwd() });
  throw new Error(`知らないワールドの種類です: ${kind}（voxel | js）`);
}
