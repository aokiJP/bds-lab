// Broken schedules and incomplete CI evidence must never be mistaken for a successful run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readSchedule, scheduleCmd } from '../common/schedule.mjs';
import { select, mergeState, parseResults } from '../common/verify-plan.mjs';
const now = Date.parse('2026-10-15T07:00:00Z'), env = 'linux-x64 node22', unit = 'tests/example-offline.mjs';
const entry = (deps, extra = {}) => ({ deps, at: new Date(now - 1000).toISOString(), ms: 20000, env, ...extra });
test('invalid dependencies, timing and state versions force CI to run again', () => {
  for (const record of [entry([]), entry({}), entry({ x: null }), entry({ x: '' }), entry({ x: 'v' }, { at: 'broken' }), entry({ x: 'v' }, { at: new Date(now + 864e5).toISOString() }), entry({ x: 'v' }, { ms: -1 })]) {
    assert.ok(select({ v: 1, units: { [unit]: record } }, [unit], { x: 'v' }, { env, now, cheapMs: 0 }).has(unit), JSON.stringify(record));
  }
  assert.ok(select({ v: 999, units: { [unit]: entry({ x: 'v' }) } }, [unit], { x: 'v' }, { env, now, cheapMs: 0 }).has(unit));
  assert.equal(select({ v: 1, units: { [unit]: entry({ x: 'v' }) } }, [unit], { x: 'v' }, { env, now, cheapMs: 0 }).size, 0);
});
test('a failure or unknown dependencies win over a duplicate success in either order', () => {
  const good = { unit, ok: true, deps: { x: 'v' }, ms: 3, env };
  for (const bad of [{ ...good, ok: false }, { ...good, deps: {} }, { ...good, deps: [] }]) {
    for (const rows of [[good, bad], [bad, good]]) assert.equal(Object.hasOwn(mergeState(null, rows, { now }).units, unit), false);
  }
});
test('strict artifact parsing refuses truncated or invalid evidence', () => {
  for (const text of ['{"unit":"a","ok":true}\n{broken', '{"unit":3,"ok":true}']) assert.throws(() => parseResults(text, { strict: true }));
  assert.equal(parseResults('{broken').length, 0, 'non-strict callers keep the existing API');
});
test('JSON null is a corrupt existing schedule, not an absent file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-sched-evolve-')), file = path.join(dir, 'schedule.json');
  try {
    fs.writeFileSync(file, 'null'); assert.ok(readSchedule(file).errors.length);
    let calls = 0;
    assert.equal(await scheduleCmd(['ci'], { file, now, env: { GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'o/lab' }, out() {}, fetchImpl: async () => { calls++; return new Response(null, { status: 204 }); } }), false);
    assert.equal(calls, 0, 'neither a dispatch nor a scheduler-disable request is sent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invalid clock input fails clearly before contacting GitHub', async () => {
  const output = []; let calls = 0;
  assert.equal(await scheduleCmd(['ci'], { now: 'invalid-date', out: (s) => output.push(s), fetchImpl: async () => { calls++; } }), false);
  assert.equal(calls, 0); assert.ok(output.some((s) => /時刻/.test(s)));
});
