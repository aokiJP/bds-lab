// sandbox-be — 実機なしで Script API のコードを検証する
export type Vec3 = { x: number; y: number; z: number };

export interface SandboxLimits {
  /** 動かす tick 数（既定 100、最大 12000） */
  ticks?: number;
  /** 1 tick の上限。超えたら watchdog（既定 3000ms） */
  hangMs?: number;
  /** スパイクとして記録する 1 tick の時間（既定 100ms） */
  spikeMs?: number;
  /** 子プロセス全体の上限（既定 30000ms） */
  wallMs?: number;
  /** 子プロセスのヒープ上限（既定 256MB） */
  memoryMb?: number;
}

export type SandboxAction =
  | { tick: number; type: 'command'; player?: string; command: string }
  | { tick: number; type: 'chat'; player: string; message: string }
  | { tick: number; type: 'scriptEvent'; id: string; message?: string }
  | { tick: number; type: 'breakBlock' | 'placeBlock' | 'interactWithBlock' | 'hitBlock' | 'startBreaking' | 'cancelBreaking' | 'pushButton' | 'pullLever' | 'openContainer' | 'closeContainer'; player: string; at: Vec3; [k: string]: unknown }
  | { tick: number; type: 'button'; player: string; button: 'Jump' | 'Sneak'; state?: 'Pressed' | 'Released' }
  | { tick: number; type: 'inputMode'; player: string; mode: 'Gamepad' | 'KeyboardAndMouse' | 'MotionController' | 'Touch' }
  | { tick: number; type: 'moveInput'; player: string; x: number; y: number }
  | { tick: number; type: 'stepOn' | 'stepOff' | 'tripWire' | 'piston'; player: string; at: Vec3; count?: number; powered?: boolean; expanding?: boolean }
  | { tick: number; type: 'projectileHit'; player: string; target?: string; block?: Vec3; projectile?: string; damage?: number; power?: number }
  | { tick: number; type: 'tame' | 'openEntityContainer' | 'closeEntityContainer'; player: string; entity: string }
  | { tick: number; type: string; player?: string; [k: string]: unknown };

export type SandboxExpectation =
  | { block: { at: Vec3; is: string; dimension?: string } }
  | { chat: { contains?: string; equals?: string; to?: string; count?: number } }
  | { score: { objective: string; participant: string; equals?: number; min?: number; max?: number; exists?: boolean } }
  | { entity: { type?: string; name?: string; tag?: string; dimension?: string; count?: number; min?: number; max?: number } }
  | { player: { name: string; hasItem?: string | { id: string; amount?: number }; tag?: string; gameMode?: string; at?: Vec3; within?: number; health?: number } }
  | { log: { contains?: string; level?: 'info' | 'warn' | 'error'; absent?: boolean } }
  | { effect: { kind: string; id?: string; to?: string; text?: string } }
  | { form: { kind?: string; to?: string } }
  | { error: { name?: string; contains?: string } };

export interface SandboxRequest {
  code?: string;
  files?: Record<string, string>;
  entry?: string;
  versions?: Record<string, string>;
  world?: {
    generator?: 'flat' | 'void';
    blocks?: Array<{ at?: Vec3; from?: Vec3; to?: Vec3; type: string; states?: Record<string, string | number | boolean>; dimension?: string }>;
    tickingAreas?: Array<{ dimension?: string; from: Vec3; to?: Vec3 }>;
    loadAll?: boolean;
    gameRules?: Record<string, boolean | number>;
    difficulty?: string;
    seed?: string;
    [k: string]: unknown;
  };
  players?: Array<{ name: string; location?: Vec3; gameMode?: string; op?: boolean; inventory?: unknown[]; tags?: string[] }>;
  actions?: SandboxAction[];
  ui?: Array<{ player: string; selection?: number; formValues?: unknown[]; canceled?: boolean | string; afterTicks?: number;
    /** CustomForm: 値を持つ部品（textField / slider / toggle / dropdown）に順に入れる値 */
    values?: unknown[];
    /** CustomForm: 押すボタンの番号 */
    clicks?: number[];
    closeReason?: 'ClientClosed' | 'ServerClosed' | 'UserBusy' }>;
  expect?: SandboxExpectation[];
  allowErrors?: boolean;
  seed?: number;
  limits?: SandboxLimits;
}

export type SandboxVerdict = 'pass' | 'fail' | 'error' | 'timeout' | 'watchdog' | 'crashed' | 'inconclusive';

export interface SandboxResult {
  ok: boolean;
  verdict: SandboxVerdict;
  message?: string;
  versions?: Record<string, string>;
  notes?: string[];
  fatal?: { stage: string; name: string; message: string };
  hang?: { stage: string; tick?: number; ms: number; running?: string } | null;
  spikes?: Array<{ tick: number | 'load'; ms: number }>;
  expectations: Array<{ ok: boolean; expect: SandboxExpectation; actual?: unknown }>;
  summary?: { ticks: number; errors: number; warnings: number; blocksChanged: number; entitiesAdded: number; entitiesRemoved: number; chat: number; unsupported: string[] };
  report?: {
    ticks: number;
    uncaught: number;
    inconclusive: number;
    log: Array<{ tick: number; level: 'info' | 'warn' | 'error'; message: string; [k: string]: unknown }>;
    chat: Array<{ tick: number; to: string; text: string }>;
    forms: Array<{ tick: number; kind: string; to: string; [k: string]: unknown }>;
    effects: Array<{ tick: number; kind: string; [k: string]: unknown }>;
    commands: Array<{ tick: number; source: string; command: string; result?: unknown }>;
    unsupported: Record<string, number>;
    usage: Record<string, number>;
    diff: { blockCount: number; blocks: Array<{ dimension: string; at: Vec3; before: string; after: string; states?: Record<string, unknown> }>; entities: { added: string[]; removed: string[] } };
    final: { entities: Record<string, any>; scores: Record<string, Record<string, number>>; world: Record<string, unknown> };
  };
  isolation: { process: boolean; permission: boolean; codeGeneration: boolean; node: string };
  elapsedMs: number;
}

export interface CoverageBucket { total: number; done: number; percent: number; missing: string[] }
export type SandboxCoverage = Record<string, { version: string; functions: CoverageBucket; properties: CoverageBucket; events: CoverageBucket }>;

export const DEFAULT_LIMITS: Readonly<Required<SandboxLimits> & { maxLogLines: number; maxDiffBlocks: number; jobStepsPerTick: number }>;
export function runSandbox(req: SandboxRequest): Promise<SandboxResult>;
export function compareCommands(opts: { commands: string[] | string; world?: SandboxRequest['world']; players?: SandboxRequest['players']; ticks?: number; player?: string; limits?: SandboxLimits }): Promise<{
  ok: boolean;
  verdict: 'same' | 'approximate' | 'different' | 'inconclusive' | 'fail' | 'error';
  differences: Array<{ kind: string; expected?: boolean; [k: string]: unknown }>;
  commandErrors: string[];
  scriptErrors: string[];
  unsupported: Record<string, number>;
  conversions: Array<{ command: string; fidelity: string; notes: string[] }>;
  program: string;
}>;
/** cmdscript-be が要る */
export function commandsToProgram(lines: string[] | string, opts?: { player?: string }): Promise<{ code: string; conversions: unknown[] }>;
/** cmdscript-be を探して読み込む（npm → 隣のフォルダ）。無ければ reject */
export function loadConverter(): Promise<Record<string, any>>;
export function sandboxCoverage(): Promise<SandboxCoverage>;
export function checkExpectation(exp: SandboxExpectation, result: SandboxResult, req: SandboxRequest): { ok: boolean; expect: SandboxExpectation; actual?: unknown };
export function isolationFlags(): { flags: string[]; permission: boolean };
export function readApiSummary(): { game: string; version: string; classes: number; functions: number; properties: number };

// ---- クリアできるかを確かめる層（docs/play.md） ----------------------------------------
export interface Tape { format?: 'sandbox-be/tape@1'; ticks?: number; inputs: Array<{ tick: number; [field: string]: unknown }>; }
export type Condition = Record<string, unknown> | boolean;
export interface Goal { reach?: Condition; avoid?: Condition; stuck?: Condition; toward?: Condition; deadline?: number; }
export interface PlayWorld {
  reset(): void;
  step(input: Record<string, unknown>): void;
  observe(): Record<string, unknown>;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
  issues?(): Array<{ id: string; why: string }>;
  errors?(): Array<{ tick: number; name: string; message: string }>;
  fingerprint?(): string;
  predicates?: Record<string, (obs: any, arg: any) => boolean>;
  readonly tick: number;
}
export interface Action { input?: Record<string, unknown>; hold?: number; frames?: Record<string, unknown>[]; until?: Condition; then?: Record<string, unknown>; min?: number; max?: number; }
export function expandTape(tape: Tape): Record<string, unknown>[];
export function compressTape(frames: Record<string, unknown>[]): Tape;
export function replay(world: PlayWorld, tape: Tape, opts?: { goal?: Goal; stopOnResult?: boolean; allowErrors?: boolean; watch?: string[]; breakpoints?: Array<{ when: Condition; label?: string }> }): {
  verdict: 'cleared' | 'failed' | 'stuck' | 'timeout' | 'done' | 'error' | 'inconclusive';
  goal: { status: string; tick: number | null } | null; trace: any[]; issues: any[]; errors: any[]; breakpoints: any[];
};
export function solve(world: PlayWorld, opts: { goal: Goal; actions?: Action[] | ((obs: any) => Action[]); budget?: number; frontier?: number; timeWeight?: number }): {
  status: 'cleared' | 'exhausted' | 'budget'; tape?: Tape; tick?: number; best: any; bugs: any[]; expanded: number;
};
export function explore(world: PlayWorld, opts: { goal: Goal; actions?: Action[]; maxStates?: number; maxDepth?: number }): {
  clearable: boolean; shortest: { tick: number; tape: Tape } | null; softlocks: Array<{ tick: number; tape: Tape; obs: any }>; bugs: Array<{ tick: number; tape: Tape; errors: any[] }>; states: number; complete: boolean;
};
export function createVoxelWorld(spec: Record<string, unknown>): PlayWorld;
export function createJsGameWorld(spec: Record<string, unknown>): PlayWorld;
export function readCourse(file: string): any;
export function createWorld(course: any): PlayWorld;
