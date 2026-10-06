// CLI を実際に起動して、利用者が最初に触る部分の振る舞いを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/commands/index.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DEBUG: '' } });

test('引数なしでヘルプと最初の一歩を出す', () => {
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /はじめに/);
  assert.match(r.stdout, /npm start/);
  for (const name of Object.keys(COMMANDS)) assert.match(r.stdout, new RegExp(`\\b${name}\\b`));
});

test('help は正常終了する', () => {
  assert.equal(run('help').status, 0);
});

test('すべてのコマンドが --help に答える', () => {
  for (const name of Object.keys(COMMANDS)) {
    const r = run(name, '--help');
    assert.equal(r.status, 0, name);
    assert.match(r.stdout, /使い方: npm run bb -- /, name);
  }
});

test('打ち間違いには候補を出し、スタックトレースは出さない', () => {
  const r = run('strin');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /知らないコマンドです: strin/);
  assert.match(r.stderr, /もしかして: .*strings/);
  assert.doesNotMatch(r.stderr, /at .+\.js:\d+/);
});

test('引数が足りなければ使い方を示す', () => {
  const r = run('diff', 'a.json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /引数が足りません/);
  assert.match(r.stderr, /diff <前のプロファイル> <後のプロファイル>/);
});

test('無いファイルは名前を出して止まる', () => {
  const r = run('report', '/nonexistent/profile.json');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\/nonexistent\/profile\.json がありません/);
});

test('android は track できないことを、代わりの手順つきで伝える', () => {
  const r = run('track', 'android');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /apk <APK のフォルダ> --scan/);
});

test('doctor --offline は通信せずに環境を報告する', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-doctor-'));
  const r = run('doctor', '--offline', '--work', work);
  assert.match(r.stdout, /Node\.js/);
  assert.match(r.stdout, /作業フォルダ/);
  assert.doesNotMatch(r.stdout, /BDS 配布 API/);
});

// profiles/ はリポジトリの履歴。持たない写し（bds-lab の配布 zip は入れない）では作る元が無いので飛ばす
const PROFILES = fs.existsSync('profiles') ? fs.readdirSync('profiles').filter((f) => f.endsWith('.json')).sort() : [];
test('リポジトリのプロファイルから docs と report が作れる', { skip: PROFILES.length ? false : 'profiles/ がありません（履歴を持たない写し）' }, () => {
  const profile = PROFILES[0];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-site-'));
  const r = run('docs', path.join('profiles', profile), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'metadata/packet_modules/mojang-packet-ids.json')));
  // getId() の番号を持つプロファイルなら、パケット ID はその番号で出る
  if (JSON.parse(fs.readFileSync(path.join('profiles', profile), 'utf8')).packets?.basis === 'getId') {
    const item = JSON.parse(fs.readFileSync(path.join(out, 'metadata/packet_modules/mojang-packet-ids.json'), 'utf8')).data_items[0];
    assert.equal(item.id_basis, 'code_getid');
    assert.equal(item.values.find((v) => v.class === 'TextPacket')?.id, 9);
  }
  const md = path.join(out, 'r.md');
  assert.equal(run('report', path.join('profiles', profile), '--out', md).status, 0);
  assert.ok(fs.statSync(md).size > 1000);
});
