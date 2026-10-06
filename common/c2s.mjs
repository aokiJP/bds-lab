// node lab.mjs c2s "<command>" ... | --file <x.mcfunction> [--check]: vanilla commands → Script API code, with cmd2script
// (cmdscript-be: put its folder at bds-lab/cmdscript-be, or SANDBOX_BE_CMDSCRIPT=<its src/index.js>). No AI, no tokens:
// the code to paste into src/main.ts, how faithful each line is, and with --check the sandbox runs the commands and the
// code side by side and says whether the world comes out the same (sandbox-be compareCommands).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const c2sHome = () => [process.env.SANDBOX_BE_CMDSCRIPT, path.join(TOP, 'cmdscript-be', 'src', 'index.js')].find((f) => f && fs.existsSync(f)) ?? null;
const HOW = 'cmd2script (cmdscript-be) is not here: put its folder at bds-lab/cmdscript-be (github.com/Au12jp/cmdscript-be), or SANDBOX_BE_CMDSCRIPT=<its src/index.js>';

export function commandsOf(args) {
  const i = args.indexOf('--file');
  if (i >= 0) return fs.readFileSync(args[i + 1], 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--file').flatMap((a) => a.split(/\r?\n/)).map((l) => l.trim().replace(/^\//, '')).filter(Boolean);
}
export async function c2sCmd(args, out = console.log) {
  const home = c2sHome();
  if (!home) { out(`ERR ${HOW}`); return false; }
  process.env.SANDBOX_BE_CMDSCRIPT ??= home;   // (sandbox-be's compareCommands finds it the same way)
  const cmds = commandsOf(args);
  if (!cmds.length) { out('usage: node lab.mjs c2s "<command>" ["<command>" ...] | --file <x.mcfunction> [--check]'); return false; }
  const C = await import(pathToFileURL(home).href);
  if (typeof C.commands2script !== 'function') { out(`ERR ${home}: no commands2script export`); return false; }
  const conv = C.commands2script(cmds);
  const loose = conv.filter((c) => c.fidelity && !/^(exact|same|full)$/i.test(c.fidelity));
  out('// from cmd2script: paste into src/main.ts (inside an event, ready() or system.run; `entity` = who runs it, `dimension` its dimension)');
  for (const c of conv) out(`// ${c.command}${c.fidelity && !/^(exact|same|full)$/i.test(c.fidelity) ? `   [${c.fidelity}${c.notes?.length ? ': ' + c.notes.join('; ') : ''}]` : ''}\n${c.code}`);
  if (C.PRELUDE && conv.some((c) => /\b__c2s|\bc2s\w*\(/.test(c.code))) out(`// helpers it uses (once per file):\n${String(C.PRELUDE).replace(/^import[^\n]*\n/gm, '')}`);
  let ok = true;
  if (args.includes('--check')) {
    const { compareCommands } = await import(pathToFileURL(path.join(TOP, 'sandbox-be', 'src', 'index.js')).href);
    const r = await compareCommands({ commands: cmds });
    ok = ['same', 'approximate'].includes(r.verdict);
    out(`${ok ? 'OK' : 'FAIL'} c2s --check: ${r.verdict} in the sandbox${r.differences?.length ? ` (${r.differences.slice(0, 3).map((d) => d.kind).join(', ')})` : ''}${r.commandErrors?.length ? ` · command errors: ${r.commandErrors.slice(0, 2).join(' | ')}` : ''}${r.scriptErrors?.length ? ` · script errors: ${r.scriptErrors.slice(0, 2).join(' | ')}` : ''}`);
  } else out(`OK c2s: ${conv.length} command(s)${loose.length ? `, ${loose.length} approximate (see [..])` : ''}; --check runs both in the sandbox and compares the worlds`);
  return ok;
}
