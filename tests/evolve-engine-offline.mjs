// Invalid compiler configuration must fail, and a timed-out test must not leave its descendants running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { typecheck } from '../common/build.mjs';
import { runTests } from '../common/run-tests.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-evolve-'));
test('unreadable TypeScript configuration is an error, never a clean cached build', () => {
  const dir = temp();
  try {
    const tl = { ts: { sys: {}, getParsedCommandLineOfConfigFile(_f, _o, host) { host.onUnRecoverableConfigFileDiagnostic({ code: 5083, messageText: 'Cannot read tsconfig.json' }); return undefined; }, flattenDiagnosticMessageText: (s) => s } };
    for (let n = 0; n < 2; n++) {
      const result = typecheck({ tl, addon: dir, cache: path.join(dir, 'cache') });
      assert.ok(result.some((s) => s.includes('TS5083')), JSON.stringify(result));
    }
    assert.ok(!fs.readdirSync(path.join(dir, 'cache', 'tsinfo')).some((f) => f.endsWith('.clean')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a timeout is a failure even if the test parent exited successfully; descendants stop', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const dir = temp(), beat = path.join(dir, 'heartbeat');
  try {
    const code = `import fs from 'node:fs'; setInterval(() => fs.appendFileSync(${JSON.stringify(beat)}, '.'), 15);`;
    fs.writeFileSync(path.join(dir, 'child.mjs'), `import { spawn } from 'node:child_process'; const c = spawn(process.execPath, ['--input-type=module','-e',${JSON.stringify(code)}], {stdio:'inherit'}); c.unref();`);
    const [r] = await runTests(['child.mjs'], { cwd: dir, jobs: 1, timeout: 1500, isolate: false });
    assert.equal(r.ok, false); assert.notEqual(r.code, 0); assert.ok(r.lines.some((l) => l.includes('stopped')));
    assert.ok(fs.existsSync(beat), 'descendant actually ran');
    const size = fs.statSync(beat).size;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fs.statSync(beat).size, size, 'no activity after the runner returns');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
