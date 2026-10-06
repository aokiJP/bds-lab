import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../src/lib/args.js';
import { compareVersionStrings, previousProfile, inferChannel, inferVersion } from '../src/lib/versions.js';

test('値を取らないフラグは後ろの引数を吸わない', () => {
  assert.deepEqual(parseArgs(['p.json', '--dead', 'Block']), { args: ['p.json', 'Block'], flags: { dead: true } });
  assert.deepEqual(parseArgs(['--out', 'x.md', 'a', 'b']), { args: ['a', 'b'], flags: { out: 'x.md' } });
  assert.deepEqual(parseArgs(['--abi=x86_64', '--scan', 'dir']), { args: ['dir'], flags: { abi: 'x86_64', scan: true } });
  assert.deepEqual(parseArgs(['--version']), { args: [], flags: { version: true } });
  assert.deepEqual(parseArgs(['--', '--not-a-flag']), { args: ['--not-a-flag'], flags: {} });
});

test('版番号はゼロ埋めの違いを同じとみなして比べる', () => {
  assert.equal(compareVersionStrings('1.21.124.2', '1.21.124.02'), 0);
  assert.ok(compareVersionStrings('1.21.130.28', '1.21.124.2') > 0);
  assert.ok(compareVersionStrings('1.9', '1.10') < 0);
});

test('前版のプロファイルは同じ channel の「より古い最新」を選ぶ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-prof-'));
  for (const f of ['release-1.21.100.1.json', 'release-1.21.124.2.json', 'release-1.21.124.20.json', 'preview-1.21.130.28.json', 'android-1.21.124.02.json', 'notes.txt']) {
    fs.writeFileSync(path.join(dir, f), '{}');
  }
  assert.equal(previousProfile(dir, 'release', '1.21.124.2').version, '1.21.100.1');
  assert.equal(previousProfile(dir, 'release', '1.21.124.20').version, '1.21.124.2');
  assert.equal(previousProfile(dir, 'android', '1.21.124.02'), null);
  assert.equal(previousProfile(path.join(dir, 'missing'), 'release', '1'), null);
});

test('パスから版と channel を推定する', () => {
  assert.equal(inferVersion('work/release/1.21.124.2/bedrock_server'), '1.21.124.2');
  assert.equal(inferChannel('work/release/1.21.124.2/bedrock_server'), 'release');
  assert.equal(inferChannel('work/android/1.21.124.02/arm64-v8a/libminecraftpe.so'), 'android');
  assert.equal(inferChannel('/tmp/x'), null);
});
