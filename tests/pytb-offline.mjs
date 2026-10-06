#!/usr/bin/env node
// common/pytb.mjs: an Endstone (Python) traceback, one E line per line in the server log, becomes one E line: what Endstone was
// doing, what was raised, and the unit's own file:line with that line of code (the 10-line cut used to leave the cause out)
import { compactPyTracebacks } from '../common/pytb.mjs';
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + d}`); if (!c) fails++; };
const o = ['@A hi', "E Error occurred when trying to load plugin from entry point 'qrmap':", 'E Traceback (most recent call last):',
  'E File "/x/end/.lab/py/lib/python3.13/site-packages/endstone/plugin/plugin_loader.py", line 190, in _load_plugin_from_ep', 'E cls = ep.load()',
  'E File "/usr/lib/python3.13/importlib/__init__.py", line 88, in import_module', 'E return _bootstrap._gcd_import(name[level:], package, level)', 'E ~~~~~~~^^^^^^',
  'E File "<frozen importlib._bootstrap>", line 1395, in _gcd_import', 'E File "/x/end/plugins/qrmap/src/endstone_qrmap/plugin.py", line 14, in <module>', 'E SIZE = _CFG["size"]', 'E ~~~~^^^^^^^^',
  "E KeyError: 'size'", 'E plugin qrmap did not load'];
compactPyTracebacks(o, (f) => f.replace('/x/end/', ''));
ok(o.length === 3 && o[1] === `E Error occurred when trying to load plugin from entry point 'qrmap': KeyError: 'size' (plugins/qrmap/src/endstone_qrmap/plugin.py:14: SIZE = _CFG["size"])` && o[2] === 'E plugin qrmap did not load', 'a load failure: one line with the context, what was raised and the plugin\'s own line', o.join('\n'));
const c = ['E Traceback (most recent call last):', 'E File "/p/plugin.py", line 3, in on_command', 'E x = int(a)', "E ValueError: invalid literal for int() with base 10: 'z'", 'E During handling of the above exception, another exception occurred:', 'E Traceback (most recent call last):', 'E File "/p/plugin.py", line 5, in on_command', 'E raise RuntimeError("bad")', 'E RuntimeError: bad'];
compactPyTracebacks(c);
ok(c.length === 1 && c[0] === 'E RuntimeError: bad (/p/plugin.py:5: raise RuntimeError("bad"))', 'a chained traceback: the last exception, the last own frame', c.join('\n'));
const plain = ['E something failed', 'E Traceback (most recent call last):'];
compactPyTracebacks(plain);
ok(plain.length === 2, 'a traceback that never says what was raised (cut off) is left as it is', plain.join('\n'));
console.log(`${fails ? 'FAIL' : 'PASS'} pytb-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
