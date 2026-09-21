// 仕様書（specs/*.spec.mjs）を書くときの型。エディタと AI の補完のために置いてある。
// 使い方（仕様書の先頭に 1 行）:
//   /** @type {import('../types/spec').Spec[]} */
//   export default [ … ];

export type Vec3 = { x: number; y: number; z: number };
export type Rot = { x: number; y: number };   // x=ピッチ, y=ヨー

/** sim と real の両方で使える道具（同じ名前・同じ意味） */
export interface Ctx {
  /** SimulatedPlayer を作る（real では仕切り直し） */
  spawn(args?: { at?: Vec3; name?: string; gameMode?: string }): Promise<unknown>;
  gamemode(mode: 'Survival' | 'Creative' | 'Adventure' | 'Spectator'): Promise<unknown>;
  tp(at: Vec3, rotation?: Rot): Promise<Vec3>;
  look(yaw: number, pitch?: number): Promise<unknown>;
  /** 移動入力。x は左右（+ が左）、y は前後（+ が前） */
  move(x: number, y: number): Promise<unknown>;
  stop(): Promise<unknown>;
  jump(): Promise<unknown>;
  sneak(on: boolean): Promise<unknown>;
  /** ボタンを押しっぱなし／離す */
  hold(button: 'Jump' | 'Sneak', on: boolean): Promise<unknown>;
  /** 実機の中の本当の値 */
  read(what: 'location' | 'rotation' | 'view' | 'velocity' | 'gamemode' | 'movementVector' | 'buttons' | 'permissions'): Promise<any>;
  send(id: string, message?: string): Promise<unknown>;

  // --- sim と real の両方で同じように使えるもの（値はいつも実機の中で読む） ---
  /** 近くの生き物を近い順に返す。type は 'zombie' でも 'minecraft:zombie' でも可 */
  entities(type?: string | null, radius?: number): Promise<Array<{ typeId: string; name: string; location: Vec3; health: number }>>;
  /** 持ち物を渡す（コマンド経由なので本物のプレイヤーにも効く） */
  give(item: string, count?: number, slot?: number | null): Promise<unknown>;
  /** 場面を作る。tickingarea の中（既定 0,0〜63,63）に置くこと */
  setBlock(at: Vec3, block?: string): Promise<unknown>;
  health(): Promise<{ current: number; max: number }>;
  /** 近くの相手を殴る。sim はサーバー側、real はクライアントが殴る */
  attack(type?: string | null, radius?: number): Promise<{ hit: boolean; typeId?: string; why?: string }>;
  /** 手に持っているものを使う */
  use(): Promise<unknown>;
  /** ブロックを壊す */
  dig(at: Vec3): Promise<unknown>;
  cmd(command: string): Promise<unknown>;
  ticks(n: number): Promise<unknown>;

  /** この仕様書が始まってからのログ（アドオンの console.warn） */
  logs(): string[];
  /** 読み込み直後からのログ。起動時に 1 度だけ出る行はこちらで見る */
  logsSinceLoad?(): string[];
  /** 読み込み時のログを待つ（loaded など） */
  expectLoadLog?(re: RegExp): Promise<true>;
  expect(cond: unknown, why?: string): true;
  expectLog(re: RegExp, o?: { within?: number }): Promise<true>;
  expectNoLog(re: RegExp): Promise<true>;
  near(a: number, b: number, eps?: number): boolean;
  /** 実機で読んだ値を結果に残す（AI が次の手を決める材料になる） */
  note(s: string): void;

  // ---- sim のときだけ ----
  component?(id: string): Promise<{ present: boolean; value?: number; currentValue?: number; defaultValue?: number }>;
  api?(path: string): Promise<{ exists: boolean; type?: string }>;
  /** この実機に実在する API の一覧。推測の代わりに使う */
  reflect?(depth?: number): Promise<Record<string, unknown>>;
  /** アドオンが lab.note / lab.metric / lab.fail で伝えてきたもの */
  fromAddon?(): { notes: string[]; metrics: Record<string, unknown>; failures: string[] };
  session?: any;
}

export interface Spec {
  /** 何を確かめるか（結果にそのまま出る） */
  name: string;
  /** どの決めごとが破れたのかが分かる印（例: '§4.2'） */
  why?: string;
  /** 'sim'（既定・速い）か 'real'（本物のクライアント・入力まわり） */
  tags?: Array<'sim' | 'real'>;
  run(t: Ctx): Promise<void> | void;
}
