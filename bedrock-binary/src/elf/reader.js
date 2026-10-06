// 依存ゼロの ELF64 リーダ。
// 対象は bedrock_server (x86-64) と libminecraftpe.so (arm64)。どちらも ELF64 LE。
// 目的は「読むこと」だけで、書き換えは一切しない。

const EI_CLASS = 4;
const EI_DATA = 5;

export const SHT = { PROGBITS: 1, SYMTAB: 2, STRTAB: 3, RELA: 4, DYNAMIC: 6, NOBITS: 8, DYNSYM: 11 };
export const MACHINE = { 0x3e: 'x86-64', 0xb7: 'aarch64', 0x28: 'arm', 0x03: 'i386' };

export class ElfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ElfError';
  }
}

export class ElfFile {
  /** @param {Buffer} buf ファイル全体 */
  constructor(buf) {
    if (buf.length < 64) throw new ElfError('ファイルが小さすぎて ELF ヘッダが入りません');
    if (buf.readUInt32BE(0) !== 0x7f454c46) throw new ElfError('ELF マジックがありません');
    if (buf[EI_CLASS] !== 2) throw new ElfError('ELF32 は未対応です（対象の Bedrock バイナリはすべて 64bit）');
    if (buf[EI_DATA] !== 1) throw new ElfError('ビッグエンディアンは未対応です');

    this.buf = buf;
    this.type = buf.readUInt16LE(0x10);
    this.machine = buf.readUInt16LE(0x12);
    this.entry = buf.readBigUInt64LE(0x18);
    this.sections = readSections(buf);
    this.byName = new Map(this.sections.map((s) => [s.name, s]));
  }

  static from(path, fs) {
    return new ElfFile(fs.readFileSync(path));
  }

  get machineName() {
    return MACHINE[this.machine] ?? `unknown(0x${this.machine.toString(16)})`;
  }

  get isPie() {
    return this.type === 3; // ET_DYN
  }

  /** セクションを名前で引く。無ければ undefined */
  section(name) {
    return this.byName.get(name);
  }

  /** 無いと困る場面用 */
  require(name) {
    const s = this.byName.get(name);
    if (!s) {
      throw new ElfError(
        `セクション ${name} がありません（あるのは ${this.sections.map((x) => x.name).filter(Boolean).slice(0, 12).join(', ')} ...）`,
      );
    }
    return s;
  }

  /** セクションの中身だけを切り出す。NOBITS はファイル上に実体が無いので空を返す */
  data(nameOrSection) {
    const s = typeof nameOrSection === 'string' ? this.require(nameOrSection) : nameOrSection;
    if (s.type === SHT.NOBITS) return Buffer.alloc(0);
    return this.buf.subarray(s.offset, s.offset + s.size);
  }

  /** 仮想アドレス → ファイルオフセット。どのセクションにも属さなければ null */
  offsetOf(vaddr) {
    for (const s of this.sections) {
      if (s.type === SHT.NOBITS || s.size === 0) continue;
      const a = Number(s.addr);
      if (a === 0) continue;
      if (vaddr >= a && vaddr < a + s.size) return s.offset + (vaddr - a);
    }
    return null;
  }

  sectionOf(vaddr) {
    for (const s of this.sections) {
      const a = Number(s.addr);
      if (a !== 0 && vaddr >= a && vaddr < a + s.size) return s;
    }
    return null;
  }

  /** GNU build id。同じ版のビルド同一性を確かめるのに使う */
  buildId() {
    const s = this.section('.note.gnu.build-id');
    if (!s) return null;
    const d = this.data(s);
    const nameSz = d.readUInt32LE(0);
    const descSz = d.readUInt32LE(4);
    // note のレイアウトは namesz(4) descsz(4) type(4) name(4 バイト境界に揃う)
    const off = 12 + ((nameSz + 3) & ~3);
    return d.subarray(off, off + descSz).toString('hex');
  }

  summary() {
    return {
      machine: this.machineName,
      type: this.isPie ? 'PIE/shared' : 'exec',
      buildId: this.buildId(),
      sections: this.sections.length,
      size: this.buf.length,
      stripped: !this.section('.symtab'),
    };
  }
}

function readSections(buf) {
  const shoff = Number(buf.readBigUInt64LE(0x28));
  const shentsize = buf.readUInt16LE(0x3a);
  const shnum = buf.readUInt16LE(0x3c);
  const shstrndx = buf.readUInt16LE(0x3e);
  if (shoff === 0 || shnum === 0) throw new ElfError('セクションヘッダがありません（完全にストリップされています）');
  if (shoff + shnum * shentsize > buf.length) throw new ElfError('セクションヘッダがファイル範囲外を指しています');

  const raw = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    raw.push({
      index: i,
      nameOff: buf.readUInt32LE(o + 0x00),
      type: buf.readUInt32LE(o + 0x04),
      flags: buf.readBigUInt64LE(o + 0x08),
      addr: buf.readBigUInt64LE(o + 0x10),
      offset: Number(buf.readBigUInt64LE(o + 0x18)),
      size: Number(buf.readBigUInt64LE(o + 0x20)),
      link: buf.readUInt32LE(o + 0x28),
      entsize: Number(buf.readBigUInt64LE(o + 0x38)),
    });
  }

  const strtab = raw[shstrndx];
  const name = (off) => {
    if (!strtab) return '';
    let start = strtab.offset + off;
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('latin1', start, end);
  };
  return raw.map((s) => ({ ...s, name: name(s.nameOff) }));
}
