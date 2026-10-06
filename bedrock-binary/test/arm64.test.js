import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAdrp, decodeAdr, decodeAddImm, decodeLdrImm, scanArm64, WINDOW } from '../src/elf/arm64.js';
import { adrp, adr, addImm, ldrImm, NOP, MOV } from './helpers-android.js';

const insn = (b) => b.readUInt32LE(0);

test('adrp はページ単位の相対アドレスを復元する（前方・後方とも）', () => {
  assert.deepEqual(decodeAdrp(insn(adrp(0x401234, 0x7ab000, 3)), 0x401234), { rd: 3, page: 0x7ab000 });
  assert.deepEqual(decodeAdrp(insn(adrp(0x7ab004, 0x401000, 9)), 0x7ab004), { rd: 9, page: 0x401000 });
  assert.equal(decodeAdrp(insn(NOP), 0), null);
});

test('adr は ±1MB の直接参照を復元する', () => {
  assert.deepEqual(decodeAdr(insn(adr(0x10000, 0x10abc, 1)), 0x10000), { rd: 1, target: 0x10abc });
  assert.deepEqual(decodeAdr(insn(adr(0x90000, 0x10000, 2)), 0x90000), { rd: 2, target: 0x10000 });
});

test('add #imm と add #imm, lsl #12 を区別する', () => {
  assert.deepEqual(decodeAddImm(insn(addImm(0, 8, 0x345))), { rd: 0, rn: 8, imm: 0x345, shifted: false });
  assert.deepEqual(decodeAddImm(insn(addImm(8, 8, 0x12, 1))), { rd: 8, rn: 8, imm: 0x12000, shifted: true });
  assert.equal(decodeAddImm(insn(MOV)), null);
});

test('ldr のオフセットは 8 倍される', () => {
  assert.deepEqual(decodeLdrImm(insn(ldrImm(1, 8, 0x40))), { rt: 1, rn: 8, imm: 0x40 });
});

function scan(code, textAddr = 0x1000, funcStarts = [0x1000]) {
  const refs = [];
  const functions = { count: funcStarts.length, addressOf: (i) => funcStarts[i] };
  scanArm64(code, { offset: 0, size: code.length, addr: textAddr }, functions, (kind, target, pc, func) =>
    refs.push({ kind, target, pc, func }),
  );
  return refs;
}

test('adrp + add を組にして報告する', () => {
  const code = Buffer.concat([adrp(0x1000, 0x55678, 8), addImm(8, 8, 0x678)]);
  assert.deepEqual(scan(code), [{ kind: 'addr', target: 0x55678, pc: 0x1004, func: 0 }]);
});

test('別レジスタへの add でも元のページから解決する', () => {
  const code = Buffer.concat([adrp(0x1000, 0x55000, 8), addImm(0, 8, 0x10), addImm(1, 8, 0x20)]);
  assert.deepEqual(scan(code).map((r) => r.target), [0x55010, 0x55020]);
});

test('add で上書きされたレジスタは再利用しない', () => {
  const code = Buffer.concat([adrp(0x1000, 0x55000, 8), addImm(8, 8, 0x10), addImm(0, 8, 0x20)]);
  assert.deepEqual(scan(code).map((r) => r.target), [0x55010]);
});

test('lsl #12 付きの add は途中値として持ち回る', () => {
  const code = Buffer.concat([adrp(0x1000, 0x100000, 8), addImm(8, 8, 0x12, 1), addImm(8, 8, 0x345)]);
  assert.deepEqual(scan(code).map((r) => r.target), [0x112345]);
});

test('ldr はスロット参照として報告する', () => {
  const code = Buffer.concat([adrp(0x1000, 0x80000, 9), ldrImm(0, 9, 0x18)]);
  assert.deepEqual(scan(code), [{ kind: 'slot', target: 0x80018, pc: 0x1004, func: 0 }]);
});

test(`adrp から ${WINDOW} 命令より離れた add は組にしない`, () => {
  const near = Buffer.concat([adrp(0x1000, 0x55000, 8), ...Array(WINDOW - 1).fill(NOP), addImm(0, 8, 1)]);
  const far = Buffer.concat([adrp(0x1000, 0x55000, 8), ...Array(WINDOW + 1).fill(NOP), addImm(0, 8, 1)]);
  assert.equal(scan(near).length, 1);
  assert.equal(scan(far).length, 0);
});

test('関数境界をまたいだら adrp の状態を捨てる', () => {
  const code = Buffer.concat([NOP, adrp(0x1004, 0x55000, 8), addImm(0, 8, 1)]);
  // 0x1008 から次の関数
  const refs = scan(code, 0x1000, [0x1000, 0x1008]);
  assert.equal(refs.length, 0);
  const same = scan(code, 0x1000, [0x1000]);
  assert.deepEqual(same.map((r) => r.func), [0]);
});

test('最初の関数より前の命令は func=-1 で報告する', () => {
  const code = Buffer.concat([adr(0x1000, 0x2000, 0)]);
  assert.deepEqual(scan(code, 0x1000, [0x5000]).map((r) => r.func), [-1]);
});
