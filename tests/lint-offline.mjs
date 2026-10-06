#!/usr/bin/env node
// The repository's own hygiene, checked in seconds with no network and no dependencies (what a linter and a reviewer would
// catch before a person or an AI ever runs a command):
//   syntax       every engine script parses (node --check)
//   data         every JSON file of the engine, skills and lessons parses
//   commands     every lab-level command (lab.mjs) points at a module that exports its function, and is documented
//   modules      every module under common/ says what it is in its first lines and is on the map (docs/ARCHITECTURE.md)
//   gate         every test in the autopilot's gate exists; every offline test is in the gate or run by CI
//   bug classes  patterns that caused real bugs here: a prompt put into a command with String.replace and a string (its
//                $& $` $' rewrote the text), a token-spending default (`skill bench` ran the claude CLI with no --via)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(0, 20).join('\n  ')}`); if (!c) fails++; };
const rd = (r) => fs.readFileSync(path.join(TOP, r), 'utf8');
// the engine's own files (not units, caches, vendored upstream fragments or generated data)
const SKIP = /(^|\/)(node_modules|\.lab|\.git|runs|dist|vendor|carry|\.lab-tools)(\/|$)|^(bds|end|ll)\/(addons|plugins|mods)\/|^training\/|^app\/runs\//;
const FRAGMENTS = /^sandbox-be\/src\/vm\/(commands|runtime)\//;   // concatenated into one script by sandbox-be: not modules on their own
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(TOP, d), { withFileTypes: true })) { const r = d ? `${d}/${e.name}` : e.name; if (SKIP.test(r)) continue; if (e.isDirectory()) walk(r); else files.push(r); } };
walk('');

// syntax
const scripts = files.filter((f) => /\.(mjs|cjs|js)$/.test(f) && !FRAGMENTS.test(f));
const bad = [];
for (const f of scripts) { const r = spawnSync(process.execPath, ['--check', path.join(TOP, f)], { encoding: 'utf8' }); if (r.status !== 0) bad.push(`${f}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) ?? r.stderr.slice(0, 200)}`); }
ok(!bad.length, `syntax: ${scripts.length} scripts parse (node --check)`, bad.join('\n'));

// data
const jsons = files.filter((f) => /\.json$/.test(f) && !/^(sandbox-be|bedrock-binary)\/data\/|^\.devcontainer\//.test(f));   // (.devcontainer: JSON with comments by its spec)
const badJ = []; for (const f of jsons) { try { JSON.parse(rd(f).replace(/^﻿/, '')); } catch (e) { badJ.push(`${f}: ${e.message}`); } }
ok(!badJ.length, `data: ${jsons.length} JSON files parse`, badJ.join('\n'));
{
  const t = JSON.parse(rd('bds/bench/tasks.json'));
  const skillNames = fs.readdirSync(path.join(TOP, 'skills')).filter((x) => fs.existsSync(path.join(TOP, 'skills', x, 'SKILL.md')));
  const missing = Object.entries(t).filter(([, x]) => !Number.isInteger(x.level) || !x.area || !(x.teaches ?? []).length || !x.teaches.every((s) => skillNames.includes(s))).map(([k]) => k);
  ok(!missing.length, 'lessons: every bench task has a level, an area and the skills it teaches (scratch)', missing.join(' '));
}

// commands: lab.mjs's table → module + exported function; each one documented where an AI or a person looks
{
  const lab = rd('lab.mjs'), m = /const TABLE = \{([\s\S]*?)\};/.exec(lab);
  ok(!!m, 'lab.mjs has its command table', '');
  const rows = [...(m?.[1] ?? '').matchAll(/([a-z][\w-]*): \['([\w.-]+\.mjs)', '(\w+)'/g)].map((x) => ({ cmd: x[1], file: x[2], fn: x[3] }));
  const missingFn = [];
  for (const r of rows) { const src = fs.existsSync(path.join(TOP, 'common', r.file)) ? rd(`common/${r.file}`) : ''; if (!new RegExp(`export (async )?function ${r.fn}\\b`).test(src)) missingFn.push(`${r.cmd} → common/${r.file} ${r.fn}`); }
  ok(rows.length >= 30 && !missingFn.length, `commands: ${rows.length} lab-level commands, each a module exporting its function`, missingFn.join('\n'));
  const docs = ['AGENTS.md', 'common/help.md', 'README.md', ...files.filter((f) => /^docs\/.*\.md$/.test(f))].map(rd).join('\n');
  const undocumented = rows.filter((r) => !new RegExp('(`|lab\\.mjs |\\b)' + r.cmd + '\\b').test(docs)).map((r) => r.cmd);
  ok(!undocumented.length, 'commands: every one is documented (AGENTS.md, help.md, README.md or docs/)', undocumented.join(' '));
}

// modules: a header that says what it is; on the map
{
  const mods = files.filter((f) => /^common\/[^/]+\.(mjs|cjs|js)$/.test(f));
  const noHead = mods.filter((f) => !/^(#!.*\n)?('use strict';\n)?\/\/ \S/.test(rd(f)));
  ok(!noHead.length, `modules: all ${mods.length} files in common/ start with a comment saying what they are`, noHead.join('\n'));
  const arch = fs.existsSync(path.join(TOP, 'docs', 'ARCHITECTURE.md')) ? rd('docs/ARCHITECTURE.md') : '';
  const off = mods.filter((f) => !arch.includes(path.basename(f)));
  ok(arch && !off.length, 'modules: every one is on the map (docs/ARCHITECTURE.md)', off.join(' '));
}

// gate and CI
{
  const { DEFAULT_POLICY } = await import(pathToFileURL(path.join(TOP, 'common', 'auto-guard.mjs')).href);
  const gate = DEFAULT_POLICY.gate, missing = gate.filter((g) => !fs.existsSync(path.join(TOP, g)));
  ok(!missing.length, `gate: all ${gate.length} tests exist`, missing.join(' '));
  // (.lab-github/: the same files where a lender's host carries them — GitHub starts nothing from there: common/hosts.mjs)
  const ci = files.filter((f) => /^\.(lab-)?github\/workflows\/.*\.yml$/.test(f)).map(rd).join('\n');
  // (CI runs `auto gate --all`: every tests/*-offline.mjs and tests/offline.mjs, whatever their names — the same pattern below)
  const all = /node lab\.mjs auto gate --all/.test(ci);
  const loose = files.filter((f) => /^tests\/[\w-]+\.mjs$/.test(f) && /-offline\.mjs$|^tests\/offline\.mjs$/.test(f) && !gate.includes(f) && !ci.includes(f) && !all);
  ok(!loose.length, 'gate: every offline test runs in the gate or in CI (none forgotten)', loose.join(' '));
  ok(all, 'CI: every offline test, side by side (node lab.mjs auto gate --all in .github/workflows)', '');
  for (const t of ['tests/cli-offline.mjs', 'tests/scratch-offline.mjs', 'tests/lint-offline.mjs']) ok(gate.includes(t), `gate: ${t} is in it`, gate.join(' '));
}

// a release carries what its skills point at: every unit a verified rule names as evidence is shipped by share (it was not)
{
  const { samples } = await import(pathToFileURL(path.join(TOP, 'common', 'share.mjs')).href);
  const S = samples(TOP), k = JSON.parse(rd('skills/knowledge.json'));
  const missing = k.rules.filter((r) => r.status === 'verified' && r.evidence?.kind === 'unit').map((r) => r.evidence.ref).filter((ref) => { const m = /^(bds|end|ll)\/(?:addons|plugins|mods)\/([^/]+)$/.exec(ref); return !m || !S[m[1]].includes(m[2]) || !fs.existsSync(path.join(TOP, ref)); });
  ok(!missing.length, 'release: every unit a verified skill rule cites as evidence is here and shipped by share', missing.join(' '));
}

// CI supply chain: every action pinned to a commit (a moved tag cannot change what runs), every workflow says its permissions
{
  const wf = files.filter((f) => /^\.(lab-)?github\/workflows\/.*\.yml$/.test(f));
  const loose = wf.flatMap((f) => rd(f).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /^\s*-?\s*uses: /.test(l) && !/@[0-9a-f]{40}\b/.test(l))).map(([f, i, l]) => `${f}:${i}: ${l.trim()}`);
  ok(!loose.length, `CI: every action in ${wf.length} workflows is pinned to a commit SHA`, loose.join('\n'));
  const noPerm = wf.filter((f) => !/^\s*permissions:/m.test(rd(f)));
  ok(!noPerm.length, 'CI: every workflow declares its permissions (least privilege)', noPerm.join(' '));
}

// bug classes found here
{
  const hits = [];
  for (const f of scripts.filter((x) => /^(common|lab\.mjs|app|bds\/bench)/.test(x))) {
    const t = rd(f).split('\n');
    t.forEach((l, i) => {
      // a placeholder replaced by text that is not ours (a prompt, a request): must be a function, never a string
      if (/\.replace(All)?\('\{(p|prompt|prompt_file)\}', (?!\(\) =>)/.test(l)) hits.push(`${f}:${i + 1}: placeholder replaced with a string (use () => text): ${l.trim().slice(0, 120)}`);
    });
  }
  ok(!hits.length, 'no prompt placed with String.replace and a string (its $& $` $\' patterns rewrite the text)', hits.join('\n'));
  const au = rd('common/auto.mjs');
  ok(/spawnSync\(tpl\[0\][^\n]*LAB_AUTO_AGENT: '1'/.test(au), 'the engine agent CLI the autopilot starts is marked LAB_AUTO_AGENT (it cannot lift STOP or change the policy)', '');
  const mt = rd('common/maint.mjs');
  ok(/ls-files', '--error-unmatch', 'bds\/vendor\/bedrock-server\.zip'/.test(mt), 'maint --fix never deletes a BDS zip git tracks', '');
  const sk = rd('common/skills.mjs');
  ok(!/val\('--via', 'claude'\)/.test(sk) && /--via is required/.test(sk), 'skill bench has no token-spending default (--via is required)', '');
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} lint-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
