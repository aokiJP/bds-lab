// realplayer.mjs が要るのは「実機で測ったプレイヤーの物理の値」だけ。
// sandbox-be の src/play/load.js から、その 1 つだけを抜き出したもの
//（コースの読み込みや JS ゲームの世界は、この zip には入れていない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export function loadPlayerPhysics() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'player-physics.json'), 'utf8'));
}
