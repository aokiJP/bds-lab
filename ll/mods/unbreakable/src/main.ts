// /unbreakable: the item in hand never wears out (NBT tag Unbreakable), /nbt shows the held item's full NBT.
// BDS scripts cannot read or write item NBT (only the few properties the API exposes).
const unb = mc.newCommand('unbreakable', 'Make the held item unbreakable', PermType.GameMasters);
unb.overload([]);
unb.setCallback((_c, origin, output) => {
  const pl = origin.player;
  if (!pl) return output.error('players only');
  const it = pl.getHand();
  if (it.isNull()) return output.error('hold an item');
  const nbt = it.getNbt();
  const tag = (nbt.getTag('tag') as NbtCompound | undefined) ?? new NbtCompound({});
  tag.setTag('Unbreakable', new NbtByte(1));
  nbt.setTag('tag', tag);
  it.setNbt(nbt);
  pl.refreshItems();
  output.success(`${it.type} is unbreakable`);
});
unb.setup();
const show = mc.newCommand('nbt', 'Show the held item NBT', PermType.Any);
show.overload([]);
show.setCallback((_c, origin, output) => {
  const it = origin.player?.getHand();
  if (!it || it.isNull()) return output.error('hold an item');
  output.success(it.getNbt().toSNBT());
});
show.setup();
