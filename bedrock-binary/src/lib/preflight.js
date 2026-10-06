// 生成を始める前に前提を確かめる。
// 途中で落ちて半端な site/ を Pages に publish するより、最初に止めたほうがいい。
import fs from 'node:fs';

export class PreflightError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'PreflightError';
    this.hint = hint;
  }
}

export function requireNode(major = 20) {
  const cur = Number(process.versions.node.split('.')[0]);
  if (cur < major) {
    throw new PreflightError(
      `Node ${major} 以上が必要です（現在 ${process.versions.node}）`,
      'nvm use 22 か、Actions なら setup-node の node-version を上げてください。',
    );
  }
}

export function assert(cond, message) {
  if (!cond) throw new PreflightError(message);
}

/** エラーを人間に読める形で出して終了する。スタックトレースは DEBUG=1 のときだけ。 */
export function requireFile(p, hint) {
  if (!fs.existsSync(p)) throw new PreflightError(`${p} がありません`, hint);
  return p;
}

export function die(e) {
  // 自前のエラー型は hint を持つ。持っていなければ本文だけ出す
  console.error(`\n✗ ${e?.message ?? e}`);
  if (e?.hint) console.error(`  ${e.hint}`);
  // 想定内のエラー（使い方の誤りや入力の不備）には、スタックトレースも案内も出さない
  const expected = typeof e?.hint === 'string' || /Error$/.test(e?.name ?? '') && e.name !== 'Error' && e.name !== 'TypeError' && e.name !== 'RangeError';
  if (process.env.DEBUG) console.error(e?.stack);
  else if (!expected) console.error('  想定外のエラーです。DEBUG=1 を付けて再実行し、表示された内容を issue に貼ってください。');
  process.exit(1);
}

/** トップレベルで一度だけ呼ぶ。未処理の例外も同じ体裁で出す。 */
export function installErrorHandler() {
  process.on('unhandledRejection', die);
  process.on('uncaughtException', die);
}
