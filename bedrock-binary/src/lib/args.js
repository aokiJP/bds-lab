// コマンドライン引数の解釈。
//
// 値を取らないフラグ（--dead, --cereal など）は明示しておく。
// そうしないと `strings p.json --dead Block` の Block がフラグの値に吸われ、
// 検索パターンが消える。

export const BOOLEAN_FLAGS = new Set(['offline', 'dead', 'cereal', 'scan', 'report', 'diff', 'any-package', 'help', 'quiet', 'json', 'dry-run']);

/**
 * @param {string[]} argv コマンド名より後ろ
 * @returns {{args:string[], flags:Record<string,string|true>}}
 */
export function parseArgs(argv, booleans = BOOLEAN_FLAGS) {
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--') || a.length === 2) {
      args.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 2) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const k = a.slice(2);
    if (booleans.has(k)) {
      flags[k] = true;
      continue;
    }
    const next = argv[i + 1];
    flags[k] = next !== undefined && !next.startsWith('--') ? argv[++i] : true;
  }
  return { args, flags };
}

/** 文字列で来るはずのフラグ。値なしで渡されたら null */
export const str = (v) => (typeof v === 'string' ? v : null);
