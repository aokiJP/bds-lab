// src/vm/ の断片を、vm の文脈で評価する 1 本のソースに組み立てる。
//
// なぜ ES モジュールにしないのか:
//   vm の中へは「文字列」しか入れない（ホストの関数やオブジェクトを 1 つでも入れると、
//   constructor をたどって外へ出られる）。import を使うとリンカ＝ホストの関数を通すことになるので、
//   断片をこの順に連結して、2 つのクロージャ（SB_COMMANDS / SB_RUNTIME）の本体にする。
//   断片どうしは同じクロージャの中の変数を共有する（ファイルは「章」、クロージャが「本」）。
//
// 断片の決まり（test/sandbox.test.js で確かめている）:
//   - 1 つの断片は「関数の本体にそのまま置ける文の並び」。途中で切れた式や import/export は置かない
//   - 下の一覧にない .js を src/vm/ に置かない（置き忘れ・消し忘れを検出する）
//   - 順番に意味がある（先に宣言したものを後で使う）。足すときは依存する断片より後ろに置く
//
// 実行中の例外の位置は "sandbox-runtime.js:行" になるので、mapStack() で断片のファイルと行に戻す。
import fs from 'node:fs';
import path from 'node:path';
import { VM_DIR } from './paths.js';

/** コマンド処理（SB_COMMANDS(W)）。W は runtime から渡される世界の操作一式 */
export const COMMAND_PARTS = Object.freeze([
  'commands/context.js',
  'commands/lexer.js',
  'commands/selectors.js',
  'commands/blocks.js',
  'commands/handlers.js',
  'commands/execute.js',
  'commands/dispatch.js',
]);

/** 仮想世界と API（SB_RUNTIME(apiJson, vanillaJson, configJson)） */
export const RUNTIME_PARTS = Object.freeze([
  // 土台
  'runtime/core/prelude.js',
  'runtime/core/report.js',
  'runtime/core/random-errors.js',
  'runtime/world/state.js',
  // API の形（公式メタデータどおり）
  'runtime/binding/bindings.js',
  'runtime/binding/events.js',
  'runtime/binding/handles.js',
  'runtime/world/commands-bridge.js',
  'runtime/world/inventory.js',
  // クラスごとの中身
  'runtime/impl/world-system.js',
  'runtime/impl/dimension-block.js',
  'runtime/impl/entity.js',
  'runtime/impl/items-scoreboard.js',
  'runtime/impl/shared.js',
  'runtime/impl/server-ui.js',
  // 進行
  'runtime/engine/modules.js',
  'runtime/engine/tick.js',
  'runtime/engine/host-api.js',
  // 拡張（仮想の世界で意味が決まるもの）
  'runtime/features/entity-state.js',
  'runtime/features/effects.js',
  'runtime/features/raycast.js',
  'runtime/features/world-misc.js',
  'runtime/features/structures-commands.js',
  'runtime/features/player-actions.js',
  'runtime/features/physics.js',
  'runtime/features/tick-end.js',
  // 実機で測ったデータに基づくもの
  'runtime/measured/block-components.js',
  'runtime/measured/items.js',
  'runtime/measured/entity-extras.js',
  'runtime/measured/player-extras.js',
  'runtime/measured/server-ui-ddui.js',
  'runtime/measured/player-action-events.js',
  'runtime/loot/tables.js',
  'runtime/loot/generation.js',
  'runtime/loot/entity-properties.js',
  'runtime/features/light.js',
  'runtime/features/extras.js',
  'runtime/features/custom-components.js',
  // SoundDefinitionRegistry は features/extras.js で作られるので、その後ろ
  'runtime/measured/sounds.js',
  // 最後: ホストへ渡す口（return）
  'runtime/engine/exports.js',
]);

const CLOSURES = [
  { name: 'SB_COMMANDS', params: 'W', parts: COMMAND_PARTS },
  { name: 'SB_RUNTIME', params: 'apiJson, vanillaJson, configJson', parts: RUNTIME_PARTS },
];

export const VM_FILENAME = 'sandbox-runtime.js';

let cached = null;

/**
 * 組み立てる。戻り値の source は `(() => { …; return (bootstrap); })()` の形の式。
 * @param {Function} bootstrap 文脈の中で評価される入口（ソース文字列としてだけ使う）
 * @returns {{ source: string, spans: Array<{ file: string, from: number, to: number }> }}
 */
export function assembleVmSource(bootstrap) {
  if (cached?.bootstrap === bootstrap) return cached.out;
  const lines = ['(() => {'];
  const spans = [];
  for (const c of CLOSURES) {
    lines.push(`function ${c.name}(${c.params}) {`, "'use strict';");
    for (const rel of c.parts) {
      const body = fs.readFileSync(path.join(VM_DIR, rel), 'utf8').replace(/\s+$/, '').split('\n');
      spans.push({ file: `src/vm/${rel}`, from: lines.length + 1, to: lines.length + body.length });
      lines.push(...body, '');
    }
    lines.push('}');
  }
  lines.push(`return (${bootstrap.toString()});`, '})()');
  const out = { source: lines.join('\n'), spans };
  cached = { bootstrap, out };
  return out;
}

/** 組み立てたソースの行番号 → 断片のファイルと行（見つからなければ null） */
export function locate(spans, line) {
  const s = spans.find((x) => line >= x.from && line <= x.to);
  return s ? { file: s.file, line: line - s.from + 1 } : null;
}

/** スタックの "sandbox-runtime.js:行:列" を "src/vm/…:行:列" に書き換える */
export function mapStack(stack, spans) {
  if (typeof stack !== 'string' || !spans) return stack;
  return stack.replace(new RegExp(`${VM_FILENAME.replace('.', '\\.')}:(\\d+):(\\d+)`, 'g'), (m, l, c) => {
    const at = locate(spans, Number(l));
    return at ? `${at.file}:${at.line}:${c}` : m;
  });
}

/** src/vm/ にあるのに一覧に無い断片（置き忘れ） */
export function strayParts() {
  const listed = new Set([...COMMAND_PARTS, ...RUNTIME_PARTS]);
  const found = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.js')) found.push(path.relative(VM_DIR, full).split(path.sep).join('/'));
    }
  };
  walk(VM_DIR);
  return found.filter((f) => !listed.has(f));
}
