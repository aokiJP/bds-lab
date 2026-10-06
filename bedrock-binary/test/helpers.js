// テスト用に最小の ELF64 を組み立てる。本物のバイナリは 243 MB あって CI に置けない。
export function buildElf({ sections = [], machine = 0x3e, type = 3 } = {}) {
  const names = ['', ...sections.map((s) => s.name), '.shstrtab'];
  const strtab = Buffer.from(names.join('\0') + '\0', 'latin1');
  const nameOffset = new Map();
  let off = 0;
  for (const n of names) {
    nameOffset.set(n, off);
    off += n.length + 1;
  }

  const all = [
    { name: '', data: Buffer.alloc(0), addr: 0, type: 0 },
    ...sections,
    { name: '.shstrtab', data: strtab, addr: 0, type: 3 },
  ];

  const ehsize = 64;
  const shentsize = 64;
  let cursor = ehsize;
  for (const s of all) {
    s.offset = cursor;
    cursor += s.data.length;
  }
  const shoff = cursor;
  const buf = Buffer.alloc(shoff + all.length * shentsize);

  buf.writeUInt32BE(0x7f454c46, 0);
  buf[4] = 2; // ELF64
  buf[5] = 1; // little endian
  buf[6] = 1;
  buf.writeUInt16LE(type, 0x10);
  buf.writeUInt16LE(machine, 0x12);
  buf.writeBigUInt64LE(BigInt(shoff), 0x28);
  buf.writeUInt16LE(ehsize, 0x34);
  buf.writeUInt16LE(shentsize, 0x3a);
  buf.writeUInt16LE(all.length, 0x3c);
  buf.writeUInt16LE(all.length - 1, 0x3e);

  for (const s of all) s.data.copy(buf, s.offset);

  all.forEach((s, i) => {
    const o = shoff + i * shentsize;
    buf.writeUInt32LE(nameOffset.get(s.name) ?? 0, o);
    buf.writeUInt32LE(s.type ?? 1, o + 4);
    buf.writeBigUInt64LE(BigInt(s.flags ?? 0), o + 0x08);
    buf.writeUInt32LE(s.link ?? 0, o + 0x28);
    buf.writeBigUInt64LE(BigInt(s.entsize ?? 0), o + 0x38);
    buf.writeBigUInt64LE(BigInt(s.addr ?? 0), o + 0x10);
    buf.writeBigUInt64LE(BigInt(s.offset), o + 0x18);
    buf.writeBigUInt64LE(BigInt(s.data.length), o + 0x20);
  });
  return buf;
}

/** lea r64, [rip+disp32]。target は絶対アドレス */
export function lea(insnAddr, target, reg = 6) {
  const b = Buffer.alloc(7);
  b[0] = 0x48;
  b[1] = 0x8d;
  b[2] = 0x05 | (reg << 3);
  b.writeInt32LE(target - (insnAddr + 7), 3);
  return b;
}

/** .eh_frame_hdr（datarel|sdata4 のテーブル） */
export function ehFrameHdr(baseAddr, funcAddrs) {
  const b = Buffer.alloc(12 + funcAddrs.length * 8);
  b[0] = 1;
  b[1] = 0x1b;
  b[2] = 0x03;
  b[3] = 0x3b;
  b.writeInt32LE(0, 4);
  b.writeInt32LE(funcAddrs.length, 8);
  funcAddrs.forEach((a, i) => {
    b.writeInt32LE(a - baseAddr, 12 + i * 8);
    b.writeInt32LE(0, 16 + i * 8);
  });
  return b;
}

export const cstrings = (...v) => Buffer.from(v.join('\0') + '\0', 'latin1');

/**
 * .symtab と .strtab を組み立てる。syms は [{name, addr}]（すべて STT_FUNC 扱い）。
 * sections に並べるときは symtab.link に strtab の番号を入れること。
 */
export function symtab(syms) {
  const names = ['', ...syms.map((s) => s.name)];
  const str = Buffer.from(names.join('\0') + '\0', 'latin1');
  const off = new Map();
  let p = 0;
  for (const n of names) {
    off.set(n, p);
    p += n.length + 1;
  }
  const data = Buffer.alloc((syms.length + 1) * 24);
  syms.forEach((s, i) => {
    const o = (i + 1) * 24;
    data.writeUInt32LE(off.get(s.name), o);
    data[o + 4] = 0x12; // GLOBAL | FUNC
    data.writeBigUInt64LE(BigInt(s.addr), o + 8);
  });
  return { data, str };
}
