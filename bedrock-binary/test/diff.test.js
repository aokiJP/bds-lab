import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEnumValues, diffList, diffProfiles, isEmptyDiff } from '../src/report/diff.js';
import { renderDiff } from '../src/report/markdown.js';

test('変化が無ければ null', () => {
  assert.equal(diffEnumValues(['A', 'B'], ['A', 'B']), null);
});

test('末尾に足された値は番号をずらさない', () => {
  const d = diffEnumValues(['A', 'B'], ['A', 'B', 'C']);
  assert.deepEqual(d.added, [{ value: 'C', id: 2 }]);
  assert.equal(d.renumbered.length, 0, '既存の番号は動いていない');
});

test('途中への挿入は以降の番号のずれとして出す', () => {
  const d = diffEnumValues(['A', 'B', 'C'], ['A', 'X', 'B', 'C']);
  assert.equal(d.shiftedFrom, 1);
  assert.deepEqual(d.renumbered, [
    { value: 'B', from: 1, to: 2 },
    { value: 'C', from: 2, to: 3 },
  ]);
});

test('削除も番号のずれとして出す', () => {
  const d = diffEnumValues(['A', 'B', 'C'], ['A', 'C']);
  assert.deepEqual(d.removed, [{ value: 'B', id: 1 }]);
  assert.deepEqual(d.renumbered, [{ value: 'C', from: 2, to: 1 }]);
});

test('集合の差分は追加と削除を分けて返す', () => {
  const d = diffList(['a', 'b'], ['b', 'c']);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['a']);
});

const profile = (enums, live = []) => ({
  version: 'x',
  binary: {},
  stats: {},
  enums,
  identifiers: { live, dead: [] },
});

test('プロファイル差分で enum の増減を拾う', () => {
  const a = profile([{ name: 'Keep', values: ['A'] }, { name: 'Gone', values: ['A'] }]);
  const b = profile([{ name: 'Keep', values: ['A'] }, { name: 'New', values: ['A'] }]);
  const d = diffProfiles(a, b);
  assert.deepEqual(d.enums.added.map((x) => x.name), ['New']);
  assert.deepEqual(d.enums.removed.map((x) => x.name), ['Gone']);
});

test('差分が無ければ空と判定する', () => {
  const a = profile([{ name: 'E', values: ['A'] }], ['x']);
  assert.ok(isEmptyDiff(diffProfiles(a, a)));
});

test('並びを裏取りできた enum だけが「壊れる変更」に出る', () => {
  const before = profile([
    { name: 'Solid', ordered: true, values: ['A', 'B'] },
    { name: 'Loose', ordered: false, values: ['A', 'B'] },
  ]);
  const after = profile([
    { name: 'Solid', ordered: true, values: ['X', 'A', 'B'] },
    { name: 'Loose', ordered: false, values: ['X', 'A', 'B'] },
  ]);
  const md = renderDiff(diffProfiles(before, after));
  const breaking = md.slice(md.indexOf('## 番号がずれた enum'), md.indexOf('## 並びが変わった enum'));
  assert.ok(breaking.includes('Solid'));
  assert.ok(!breaking.includes('Loose'));
  assert.ok(md.includes('## 並びが変わった enum'));
});

test('名前だけが変わった enum は増減でなく「名前の変化」に出す', () => {
  const v = ['air', 'dirt', 'wood', 'metal', 'grate', 'water'];
  const prof = (enums) => ({ version: '1', channel: 'release', binary: { machine: 'x86-64' }, enums, identifiers: { live: [], dead: [] }, stats: {} });
  const d = diffProfiles(prof([{ name: 'air', short: 'air', values: v.slice(1) }]), prof([{ name: 'MaterialType', short: 'MaterialType', values: v }]));
  assert.deepEqual(d.enums.added, []);
  assert.deepEqual(d.enums.removed, []);
  assert.equal(d.enums.renamed.length, 1);
  assert.equal(d.enums.renamed[0].to, 'MaterialType');
  assert.match(renderDiff(d), /名前だけが変わった enum[\s\S]*`air` → `MaterialType`/);
  // 中身が違うものは組にしない
  const e = diffProfiles(prof([{ name: 'A', values: ['a', 'b', 'c', 'd', 'e'] }]), prof([{ name: 'B', values: ['v', 'w', 'x', 'y', 'z'] }]));
  assert.equal(e.enums.renamed.length, 0);
  assert.equal(e.enums.added.length, 1);
});
