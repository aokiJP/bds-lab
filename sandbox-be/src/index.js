// sandbox-be の公開 API（ここは再エクスポートだけ）。
//
//   import { runSandbox, compareCommands, sandboxCoverage } from 'sandbox-be';
//
// コードを渡すと、実機を使わずに「実機と同じ形の API」と「仮想の世界」で動かし、
// 何が起きたか（ブロック・エンティティ・スコア・チャット・ログ・例外・watchdog）を返す。
//
// 構成:
//   src/api/   公開する関数（リクエスト → 子プロセス → 判定）
//   src/host/  Node 側の土台（子プロセスの起動・vm の組み立て・場所）
//   src/vm/    vm の文脈の中で動くもの（import/export なし。host/assemble.js が連結する）
//
// 分離の限界: node:vm は Node 自身が「安全の仕組みではない」としている。見知らぬ人のコードを
// 受ける公開サーバーにするなら、コンテナや VM の中で動かすこと（README.md「分離と、その限界」）。

export { DEFAULT_LIMITS } from './api/request.js';
export { runSandbox } from './api/run.js';
export { checkExpectation } from './api/expect.js';
export { compareCommands, commandsToProgram, loadConverter } from './api/compare.js';
export { sandboxCoverage, readApiSummary } from './api/coverage.js';
export { isolationFlags } from './host/spawn.js';

// ---- クリアできるかを確かめる層（docs/play.md）。ゲームを知らない部分と、ワールドの実装 ----
export { TAPE_FORMAT, validateTape, expandTape, compressTape, sliceTape, tapeLength } from './play/tape.js';
export { evaluate, distance, judge, normalizeGoal, getPath } from './play/goal.js';
export { replay, checkDeterminism, checkSnapshot, firstDifference, diffValues } from './play/run.js';
export { solve, explore } from './play/solve.js';
export { createVoxelWorld } from './play/worlds/voxel.js';
export { createJsGameWorld } from './play/worlds/js-game.js';
export { readCourse, createWorld, loadPlayerPhysics } from './play/load.js';
