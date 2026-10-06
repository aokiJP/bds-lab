// 子プロセス（host/child.js）を、分離をかけて起動する。
//
//   - 別プロセスで動かす。時間・メモリ・出力の上限を超えたら子ごと止める
//   - 使える Node なら permission model で、子のファイル書き込み・子プロセス・ワーカーを禁じる
//   - 子の環境変数は空にする（GH_TOKEN などを渡さない）
import { spawn } from 'node:child_process';
import { CHILD_ENTRY, DATA_DIR, SRC_DIR } from './paths.js';

function nodeMajorMinor() {
  const [a, b] = process.versions.node.split('.').map(Number);
  return { major: a, minor: b };
}

/** 使える permission model の引数 */
export function isolationFlags() {
  const { major, minor } = nodeMajorMinor();
  if (process.env.BEDROCK_WS_SANDBOX_NO_PERMISSION === '1') return { flags: [], permission: false };
  const read = [SRC_DIR, DATA_DIR];
  let flag = null;
  if (major > 23 || (major === 23 && minor >= 5) || (major === 22 && minor >= 13)) flag = '--permission';
  else if (major >= 20) flag = '--experimental-permission';
  if (!flag) return { flags: [], permission: false };
  return { flags: [flag, ...read.map((p) => `--allow-fs-read=${p}`)], permission: true };
}


/**
 * 正規化済みのリクエストで子を 1 回動かす。
 * @returns {Promise<{ parsed: object|null, code: number|null, signal: string|null, killed: string|null, stderr: string, ms: number, permission: boolean }>}
 */
export function spawnChild(req) {
  const { flags, permission } = isolationFlags();
  const args = [
    '--experimental-vm-modules',
    '--no-warnings',
    '--disallow-code-generation-from-strings',
    `--max-old-space-size=${req.limits.memoryMb}`,
    ...flags,
    CHILD_ENTRY,
  ];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: SRC_DIR,
      // 何も渡さない（NODE_OPTIONS の --inspect なども効かせない）。
      // 例外は実測データの差し替え口だけ（測り直したファイルを試すため）
      env: process.env.SANDBOX_BE_MEASURED ? { SANDBOX_BE_MEASURED: process.env.SANDBOX_BE_MEASURED } : {},
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let killed = null;
    const timer = setTimeout(() => { killed = 'wall'; child.kill('SIGKILL'); }, req.limits.wallMs);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 64 * 1024 * 1024) { killed = 'output'; child.kill('SIGKILL'); } });
    child.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      let parsed = null;
      try { parsed = line ? JSON.parse(line) : null; } catch { parsed = null; }
      resolve({ parsed, code, signal, killed, stderr, ms: Date.now() - started, permission });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(req));
  });
}
