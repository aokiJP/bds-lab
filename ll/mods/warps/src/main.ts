// Warps: OP sets named warp points with /setwarp <name> (where they stand), anyone teleports with /warp <name>
// (once per 10 s per player), /warps lists them, OP deletes with /delwarp <name>. Kept in plugins/warps/warps.json.
type Warp = { name: string; x: number; y: number; z: number; dim: 0 | 1 | 2; yaw: number; pitch: number };
const DIR = './plugins/warps';
const FILE = `${DIR}/warps.json`;
const COOLDOWN_MS = 10_000;
const DIM_NAME = ['overworld', 'nether', 'the_end'];

File.mkdir(DIR);
let warps: Record<string, Warp> = {};
try { warps = JSON.parse(File.readFrom(FILE) ?? '{}') ?? {}; } catch { warps = {}; }
const persist = (): void => { File.writeTo(FILE, JSON.stringify(warps, null, 2)); };
const keyOf = (name: string): string => name.trim().toLowerCase();
const lastWarp: Record<string, number> = {};
const r1 = (n: number): number => Math.round(n * 10) / 10;
const where = (w: Warp): string => `${r1(w.x)}, ${r1(w.y)}, ${r1(w.z)} (${DIM_NAME[w.dim] ?? w.dim})`;
const validName = (name: string): string | undefined => {
  const n = name.trim();
  if (n.length < 1 || n.length > 32) return undefined;
  if (/\s/.test(n)) return undefined;
  return n;
};

// /setwarp <name>: operators only, saves where the player stands (and which way they face)
const set = mc.newCommand('setwarp', 'Set a warp point where you stand', PermType.GameMasters);
set.mandatory('name', ParamType.String);
set.overload(['name']);
set.setCallback((_c, origin, out, r: { name: string }) => {
  const pl = origin.player;
  if (!pl) return out.error('プレイヤーだけが使えます (only a player can set a warp)');
  if (!pl.isOP()) return out.error('OPだけが使えます');
  const name = validName(r.name ?? '');
  if (!name) return out.error('名前は空白なしの1〜32文字にしてください');
  const p = pl.feetPos, d = pl.direction;
  const existed = !!warps[keyOf(name)];
  warps[keyOf(name)] = { name, x: p.x, y: p.y, z: p.z, dim: p.dimid, yaw: d?.yaw ?? 0, pitch: d?.pitch ?? 0 };
  persist();
  out.success(`ワープ地点「${name}」を${existed ? '更新' : '作成'}しました: ${where(warps[keyOf(name)])}`);
});
set.setup();

// /warp <name>: anyone, at most once per 10 seconds
const go = mc.newCommand('warp', 'Teleport to a warp point', PermType.Any);
go.mandatory('name', ParamType.String);
go.overload(['name']);
go.setCallback((_c, origin, out, r: { name: string }) => {
  const pl = origin.player;
  if (!pl) return out.error('プレイヤーだけが使えます (only a player can warp)');
  const w = warps[keyOf(r.name ?? '')];
  if (!w) return out.error(`ワープ地点「${(r.name ?? '').trim()}」はありません。/warps で一覧を見られます`);
  const id = pl.xuid || pl.uuid, now = Date.now(), last = lastWarp[id] ?? 0;
  if (now - last < COOLDOWN_MS) {
    const s = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return out.error(`ワープはあと${s}秒待ってください (10秒に1回まで)`);
  }
  if (!pl.teleport(new FloatPos(w.x, w.y, w.z, w.dim), new DirectionAngle(w.pitch, w.yaw))) {
    return out.error(`「${w.name}」へ移動できませんでした`);
  }
  lastWarp[id] = now;
  out.success(`「${w.name}」へワープしました`);
});
go.setup();

// /warps: anyone, lists every warp point
const list = mc.newCommand('warps', 'List warp points', PermType.Any);
list.overload([]);
list.setCallback((_c, _o, out) => {
  const all = Object.values(warps).sort((a, b) => a.name.localeCompare(b.name));
  if (all.length === 0) return out.success('ワープ地点はまだありません');
  out.success(`ワープ地点 (${all.length}): ` + all.map((w) => `${w.name} [${where(w)}]`).join(' | '));
});
list.setup();

// /delwarp <name>: operators only
const del = mc.newCommand('delwarp', 'Delete a warp point', PermType.GameMasters);
del.mandatory('name', ParamType.String);
del.overload(['name']);
del.setCallback((_c, origin, out, r: { name: string }) => {
  if (origin.player && !origin.player.isOP()) return out.error('OPだけが使えます');
  const k = keyOf(r.name ?? ''), w = warps[k];
  if (!w) return out.error(`ワープ地点「${(r.name ?? '').trim()}」はありません`);
  delete warps[k];
  persist();
  out.success(`ワープ地点「${w.name}」を削除しました`);
});
del.setup();

logger.info(`warps loaded: ${Object.keys(warps).length} warp(s)`);
