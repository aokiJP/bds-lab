// パケット ID を、各パケットクラスの getId() の機械語から読む。
//
// MinecraftPacketIds の値の列（enums の cereal 由来）は ID の表ではない。BDS 1.26.52.3 の実測で:
//   - 削除されたパケットの番号は列から抜ける（134 UpdateBlockProperties など）。それより後ろが 1 つずつずれる
//   - 200〜299 は予約で、列では TitleSpecificPacketsStart / End の 2 項目にしかならない（次の CameraInstruction は 300）
//   - 新しいパケットほど列の順番と番号が合わない（CameraAimAssistActorPriority は列では 220 番目、ID は 339）
//   - 列に無いパケットもある（ClientboundDataStore など 20 個以上）
// そこで番号は列ではなくコードから取る。Itanium C++ ABI の RTTI をたどる:
//   型名     "10TextPacket"（長さ + 名前。前後は NUL とは限らない）
//   typeinfo 型名を指す相対再配置の 8 バイト前（{vptr, name, base}）
//   vtable   typeinfo を指す相対再配置。その 8 バイト前が offset-to-top（0・再配置なし）、8 バイト後から仮想関数
//   getId()  仮想関数のうち「定数を返して戻るだけ」の 1 本
//            x86-64: [endbr64] mov eax, imm32; ret / xor eax, eax; ret
//            arm64:  [bti c] movz w0, #imm16; ret / mov w0, wzr; ret
// 何番目の仮想関数が getId かは決め打ちしない。定数を返す関数の値がいちばんばらける位置を選び、
// どの版でも変わらない TextPacket = 9 と LoginPacket = 1 で確かめる。合わなければ何も出さない（推測の番号は出さない）。
import { relativeRelocations } from '../elf/relocs.js';

const SHF_EXECINSTR = 4n;
const SLOTS = 8; // 仮想関数を何本目まで見るか（~Packet() 2 本、getId、getName ...）
export const ANCHORS = { TextPacket: 9, LoginPacket: 1 };

/** 関数の先頭が「定数を返して戻る」だけなら、その定数。違えば null */
export function constantReturn(code, machine) {
  if (!code || code.length < 8) return null;
  if (machine === 0x3e) {
    let p = 0;
    if (code.readUInt32BE(0) === 0xf30f1efa) p = 4; // endbr64
    if (code.length >= p + 6 && code[p] === 0xb8 && code[p + 5] === 0xc3) return code.readUInt32LE(p + 1);
    if (code.length >= p + 3 && code[p] === 0x31 && code[p + 1] === 0xc0 && code[p + 2] === 0xc3) return 0;
    return null;
  }
  if (machine === 0xb7) {
    let p = 0;
    const first = code.readUInt32LE(0);
    if (first === 0xd503245f || first === 0xd503241f) p = 4; // bti c / bti
    if (code.length < p + 8) return null;
    const a = code.readUInt32LE(p);
    const b = code.readUInt32LE(p + 4);
    if (b !== 0xd65f03c0) return null; // ret
    if (((a & 0xffe0001f) >>> 0) === 0x52800000) return (a >>> 5) & 0xffff; // movz w0, #imm16 (lsl 0)
    if (a === 0x2a1f03e0) return 0; // mov w0, wzr
    return null;
  }
  return null;
}

/** .rodata などから「長さ + 名前」の型名を探す。{class: vaddr}（vaddr は長さの数字の先頭） */
export function findTypeNames(elf, suffix = 'Packet') {
  const out = new Map();
  const tail = Buffer.from(`${suffix}\0`, 'latin1');
  for (const s of elf.sections) {
    if (s.type !== 1 || s.size === 0 || (s.flags & SHF_EXECINSTR) || Number(s.addr) === 0) continue; // PROGBITS・実行しない
    if (!/^\.rodata/.test(s.name)) continue;
    const d = elf.data(s);
    for (let at = d.indexOf(tail); at >= 0; at = d.indexOf(tail, at + 1)) {
      const end = at + suffix.length;
      for (let len = suffix.length + 1; len <= 96 && end - len > 0; len++) {
        const digits = String(len);
        const start = end - len;
        if (start - digits.length < 0) break;
        if (d.toString('latin1', start - digits.length, start) !== digits) continue;
        const name = d.toString('latin1', start, end);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
        if (!out.has(name)) out.set(name, Number(s.addr) + start - digits.length);
        break;
      }
    }
  }
  return out;
}

/**
 * パケットクラスとその ID。
 * @param {import('../elf/reader.js').ElfFile} elf
 * @param {{relocs?: {offset:number, addend:number}[]}} opts
 * @returns {{basis: 'getId'|null, slot?: number, list: {id:number, class:string}[], reason?: string}}
 */
export function extractPacketIds(elf, { relocs } = {}) {
  const machine = elf.machine;
  if (machine !== 0x3e && machine !== 0xb7) return { basis: null, list: [], reason: `${elf.machineName} は未対応です` };
  const names = findTypeNames(elf);
  if (!names.size) return { basis: null, list: [], reason: 'パケットクラスの型名（RTTI）がありません' };
  const rel = relocs ?? relativeRelocations(elf);

  // 型名 → typeinfo → vtable を、必要なアドレスだけ索引にして 1 段ずつたどる
  const index = (wanted) => {
    const m = new Map();
    for (const r of rel) if (wanted.has(r.addend)) (m.get(r.addend) ?? m.set(r.addend, []).get(r.addend)).push(r.offset);
    return m;
  };
  const byName = index(new Set(names.values()));
  const typeinfoOf = new Map(); // typeinfo アドレス → クラス名
  for (const [cls, nameAddr] of names) for (const off of byName.get(nameAddr) ?? []) typeinfoOf.set(off - 8, cls);
  const byTypeinfo = index(new Set(typeinfoOf.keys()));
  // vtable の前後のスロットだけを引けるようにする（全再配置の索引は 70 万件を超える）
  const slots = new Set();
  for (const refs of byTypeinfo.values()) for (const ref of refs) for (let i = -1; i <= SLOTS; i++) slots.add(ref + 8 * i);
  const relocAt = new Map();
  for (const r of rel) if (slots.has(r.offset)) relocAt.set(r.offset, r.addend);
  const word = (addr) => {
    if (relocAt.has(addr)) return relocAt.get(addr);
    const o = elf.offsetOf(addr);
    return o === null || o + 8 > elf.buf.length ? null : Number(elf.buf.readBigUInt64LE(o));
  };
  const isCode = (addr) => {
    const s = addr ? elf.sectionOf(addr) : null;
    return Boolean(s && (s.flags & SHF_EXECINSTR));
  };

  const vtables = []; // {class, fns}
  for (const [ti, cls] of typeinfoOf) {
    for (const ref of byTypeinfo.get(ti) ?? []) {
      // 派生クラスの typeinfo の基底ポインタも typeinfo を指す。vtable だけを、offset-to-top が 0 で再配置でないことで選ぶ
      if (relocAt.has(ref - 8) || word(ref - 8) !== 0) continue;
      const fns = Array.from({ length: SLOTS }, (_, i) => word(ref + 8 * (i + 1)));
      if (!isCode(fns[0]) || !isCode(fns[1])) continue;
      vtables.push({ class: cls, fns });
    }
  }
  if (!vtables.length) return { basis: null, list: [], reason: 'パケットクラスの vtable が見つかりません' };

  const valueAt = (fn) => {
    if (!isCode(fn)) return null;
    const o = elf.offsetOf(fn);
    return o === null ? null : constantReturn(elf.buf.subarray(o, o + 16), machine);
  };
  // getId はどの位置か: 定数の値がいちばんばらける位置（ほかの定数関数は全クラス同じ値を返す）
  let best = null;
  for (let k = 0; k < SLOTS; k++) {
    const vals = new Map();
    for (const v of vtables) {
      const x = valueAt(v.fns[k]);
      if (x !== null) vals.set(v.class, x);
    }
    const distinct = new Set(vals.values()).size;
    if (!best || distinct > best.distinct) best = { slot: k, vals, distinct };
  }
  const bad = Object.entries(ANCHORS).filter(([c, id]) => best.vals.has(c) && best.vals.get(c) !== id);
  const seen = Object.keys(ANCHORS).filter((c) => best.vals.has(c));
  if (!seen.length || bad.length) {
    return { basis: null, list: [], reason: bad.length ? `照合に失敗: ${bad.map(([c, id]) => `${c} は ${id} のはずが ${best.vals.get(c)}`).join(', ')}` : '照合用の TextPacket / LoginPacket がありません' };
  }
  // 同じ ID を 2 つのクラスが返すなら、どちらも信用しない（getId 以外の定数関数を拾っている）
  const count = new Map();
  for (const id of best.vals.values()) count.set(id, (count.get(id) ?? 0) + 1);
  const list = [...best.vals].filter(([, id]) => count.get(id) === 1).map(([cls, id]) => ({ id, class: cls })).sort((a, b) => a.id - b.id);
  return { basis: 'getId', slot: best.slot, list, dropped: best.vals.size - list.length };
}

const norm = (s) => s.replace(/Packet$/, '').toLowerCase();

/**
 * MinecraftPacketIds の値（列挙子の名前）をクラスに結び付ける。
 *   1. 名前が同じ（Text ↔ TextPacket、ItemRegistryPacket ↔ ItemRegistryPacket）
 *   2. 名前が変わったもの（MoveAbsoluteActor ↔ MoveActorAbsolutePacket）は、列の中で前後が結び付いていて、
 *      その間の列挙子の数と番号の数がぴったり同じときだけ順に当てる。列は古いパケットの範囲では番号順なので、
 *      間の番号はすべて埋まっている（クラスが無い番号は、削除されたパケットの列挙子に当たる）
 * @returns {{list: {id:number, class:string, name:string|null}[], noClass: {name:string, id:number|null}[]}}
 */
export function linkPacketNames(list, enumValues = []) {
  const byNorm = new Map(enumValues.map((v) => [norm(v), v]));
  const out = list.map((p) => ({ ...p, name: byNorm.get(norm(p.class)) ?? null }));
  const byId = new Map(out.map((p) => [p.id, p]));
  const idOfName = new Map(out.filter((p) => p.name).map((p) => [p.name, p.id]));
  const inferred = new Map(); // 列挙子 → 番号（クラスの無いもの）
  let prev = { i: -1, id: -1 };
  for (let i = 0; i <= enumValues.length; i++) {
    const id = i < enumValues.length ? idOfName.get(enumValues[i]) : undefined;
    if (id === undefined && i < enumValues.length) continue;
    const run = enumValues.slice(prev.i + 1, i);
    const hi = i < enumValues.length ? id : null;
    if (run.length && hi !== null && hi > prev.id && hi - prev.id - 1 === run.length) {
      run.forEach((v, k) => {
        const n = prev.id + 1 + k;
        const p = byId.get(n);
        if (p && !p.name) p.name = v;
        else if (!p) inferred.set(v, n);
      });
    }
    if (hi !== null) prev = { i, id: hi };
  }
  const named = new Set(out.map((p) => p.name).filter(Boolean));
  const noClass = enumValues.filter((v) => !named.has(v)).map((v) => ({ name: v, id: inferred.get(v) ?? null }));
  return { list: out, noClass };
}
