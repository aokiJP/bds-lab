// シンボル表を読む。
//
// bedrock_server 本体はストリップされているが、配布 zip には
// bedrock_server_symbols.debug（デバッグ情報つきの別ファイル）が同梱されることがある。
// これがあると、関数のアドレスに本物の名前がつく。名前は C++ のマングル名なので、
// ここでは完全な demangle はせず「長さつきの部品を並べ直す」だけの軽い復元を行う。
// enum の型名を取り出すにはそれで足りる。
//
//   _ZN6cereal12BasicFactoryI18MinecraftPacketIdsE5scopeEv
//     → cereal / BasicFactory / <MinecraftPacketIds> / scope
//
// 目的は 1 つ。型名の出どころを cereal の文字列だけに頼らないこと。
// 文字列が消えたビルドでも、シンボルがあれば enum に正しい名前がつく。

import { SHT } from './reader.js';

/** enum を登録するファクトリ。この直後のテンプレート引数が型名 */
const FACTORIES = ['BasicFactory', 'TypeSchema'];

export class SymbolTable {
  /** @param {import('./reader.js').ElfFile} elf */
  constructor(elf) {
    /** @type {Map<number, string>} 関数の先頭アドレス → マングル名 */
    this.byAddress = new Map();
    this.count = 0;

    const sec = elf.sections.find((s) => s.type === SHT.SYMTAB) ?? elf.sections.find((s) => s.type === SHT.DYNSYM);
    if (!sec || !sec.size) return;
    const strtab = elf.sections[sec.link];
    if (!strtab) return;

    const data = elf.data(sec);
    const str = elf.data(strtab);
    const entsize = sec.entsize || 24;
    for (let o = 0; o + entsize <= data.length; o += entsize) {
      const nameOff = data.readUInt32LE(o);
      const info = data[o + 4];
      const value = Number(data.readBigUInt64LE(o + 8));
      if (!nameOff || !value) continue;
      // STT_FUNC のみ。オブジェクトや通知シンボルは要らない
      if ((info & 0xf) !== 2) continue;
      let end = nameOff;
      while (end < str.length && str[end] !== 0) end++;
      const name = str.toString('latin1', nameOff, end);
      if (!name) continue;
      this.count++;
      if (!this.byAddress.has(value)) this.byAddress.set(value, name);
    }
  }

  nameAt(addr) {
    return addr == null ? null : this.byAddress.get(addr) ?? null;
  }
}

/** マングル名を「部品の列」に割る。長さつきの部品だけを順に拾う */
export function mangledParts(name) {
  const out = [];
  for (let i = 0; i < name.length; ) {
    const m = /^(\d+)/.exec(name.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const len = Number(m[1]);
    const start = i + m[1].length;
    if (len <= 0 || start + len > name.length) break;
    out.push(name.slice(start, start + len));
    i = start + len;
  }
  return out;
}

/** 位置 pos から「名前」を 1 つ読む。N...E の入れ子は :: でつなぐ */
function readName(s, pos) {
  const parts = [];
  let i = pos;
  const nested = s[i] === 'N';
  if (nested) i++;
  for (;;) {
    const m = /^(\d+)/.exec(s.slice(i));
    if (!m) break;
    const len = Number(m[1]);
    const start = i + m[1].length;
    if (start + len > s.length) break;
    parts.push(s.slice(start, start + len));
    i = start + len;
    if (!nested) break;
  }
  if (nested && s[i] === 'E') i++;
  return parts.length ? { name: parts.join('::'), next: i } : null;
}

/**
 * シンボル名が enum の登録関数なら、その enum の型名を返す。
 * cereal::BasicFactory<T>::scope / cereal::internal::TypeSchema<T> のどちらにも当たる。
 * @returns {string|null}
 */
export function enumTypeFromSymbol(mangled) {
  if (typeof mangled !== 'string' || !mangled.startsWith('_Z')) return null;
  for (const f of FACTORIES) {
    let at = -1;
    for (;;) {
      at = mangled.indexOf(f, at + 1);
      if (at < 0) break;
      // 部品の直前は長さの数字。BasicFactory なら 12
      const before = mangled.slice(0, at);
      if (!new RegExp(`${f.length}$`).test(before)) continue;
      let i = at + f.length;
      if (mangled[i] !== 'I') continue; // テンプレート引数が続かない
      const r = readName(mangled, i + 1);
      if (r && /^[A-Za-z_]/.test(r.name)) return r.name;
    }
  }
  return null;
}
