// リクエストの既定値と正規化（上限を安全な範囲に丸める）。

export const DEFAULT_LIMITS = Object.freeze({
  ticks: 100, // 動かす tick 数（20 tick = 1 秒）
  hangMs: 3000, // 1 tick がこれを超えたら watchdog で止める（実機 BDS の既定は 10000）
  spikeMs: 100, // これを超えた tick を「スパイク」として記録する（実機の既定と同じ）
  wallMs: 30000, // 子プロセス全体の上限
  memoryMb: 256, // 子プロセスのヒープ上限
  maxLogLines: 2000,
  maxDiffBlocks: 5000,
  jobStepsPerTick: 1000,
});

/** 動かせる tick 数の上限（10 分） */
const MAX_TICKS = 20 * 60 * 10;

/** 受け取ったリクエストを検証し、上限を丸めたコピーを返す */
export function normalizeRequest(req) {
  if (!req || typeof req !== 'object') throw new TypeError('リクエストはオブジェクトで渡してください');
  const hasCode = typeof req.code === 'string';
  const hasFiles = req.files && typeof req.files === 'object';
  if (!hasCode && !hasFiles) throw new TypeError('code（文字列）か files（{ パス: 中身 }）が要ります');
  const limits = { ...DEFAULT_LIMITS, ...(req.limits ?? {}) };
  limits.ticks = Math.max(0, Math.min(MAX_TICKS, Math.floor(Number(limits.ticks) || 0)));
  limits.hangMs = Math.max(50, Math.min(10000, Number(limits.hangMs) || DEFAULT_LIMITS.hangMs));
  limits.wallMs = Math.max(1000, Math.min(10 * 60000, Number(limits.wallMs) || DEFAULT_LIMITS.wallMs));
  limits.memoryMb = Math.max(32, Math.min(4096, Number(limits.memoryMb) || DEFAULT_LIMITS.memoryMb));
  return { ...req, limits };
}
