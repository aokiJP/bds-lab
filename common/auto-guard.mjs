// The floor under the autopilot (common/auto.mjs): the few things the AI may never decide for itself. Everything else in
// bds-lab — what to build, what to fix, its own engine, its backlog, its lessons, merging, releasing — the AI decides.
//   1. the kill switch   auto/STOP exists (node lab.mjs auto stop) → nothing runs, not even a call to the AI
//   2. the money         auto/policy.json dailyTokens / taskTokens: no tick starts once today's tokens reach the cap
//   3. this floor        the files below are never written by the AI: an engine change that touches one is put back whole
// The person owns auto/policy.json (by hand, or `node lab.mjs auto policy key=value`); the AI only reads it. It holds only what
// the person changed: every other key comes from DEFAULT_POLICY below, so a newer lab's defaults (a new gate test) reach it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROTECTED = ['auto/policy.json', 'auto/STOP', 'common/auto-guard.mjs', '.github/workflows/auto.yml', '.env', '.env.local', '.env.example'];
// never readable or writable by the engine agent either (secrets), whatever the path is spelled like
export const SECRET = /(^|\/)(\.env(\.[^/]*)?|github\.token|.*\.pem|.*\.key)$/;
export const isProtected = (rel) => { const r = rel.split(path.sep).join('/').replace(/^\.\//, ''); return PROTECTED.includes(r) || SECRET.test(r) || r.startsWith('.git/'); };

export const DEFAULT_POLICY = {
  merge: 'auto',          // auto: a passing, reviewed change is committed to the current branch (main) and pushed | pr: a branch + pull request | local: commit only, never push
  push: true,             // push commits when there is a remote
  release: true,          // a unit that changed and passes is released (version +1, CHANGELOG, .mcaddon, GitHub Release when connected)
  review: true,           // a second AI reads the diff before it is merged (REJECT → the change is put back)
  dailyTokens: 3000000,   // no tick starts once today's tokens reach this
  taskTokens: 400000,     // one task may spend at most this (make --budget)
  sleepMinutes: 20,       // auto run --forever: the pause between ticks
  reflectEvery: 8,        // every n ticks the AI rereads its ledger and lessons and rewrites its own backlog
  upkeepHours: 24,        // maintain (newest Minecraft, every unit) at most this often
  issueLabel: 'auto',     // open GitHub issues with this label are requests the AI takes (labels need triage rights: trusted)
  gateOn: 'local',        // an engine change's gate: local (here) | auto (a lender's host with the most minutes left: node lab.mjs host) | <owner/repo>; where no host can take it, here
  kinds: { repair: true, upkeep: true, issue: true, release: true, backlog: true, lab: true, playtest: true, harden: true, reflect: true, invent: true, share: true, forge: true },
  // an engine change (`lab:` backlog items) is kept only when every one of these still passes (and passed before it)
  gate: ['tests/docs-offline.mjs', 'tests/dev-offline.mjs', 'tests/kit-offline.mjs', 'tests/make-offline.mjs', 'tests/ci-offline.mjs', 'tests/auto-offline.mjs', 'tests/update-offline.mjs', 'tests/share-offline.mjs', 'tests/sim-offline.mjs', 'tests/status-offline.mjs', 'tests/deploy-offline.mjs', 'tests/c2s-offline.mjs', 'tests/upkeep-front-offline.mjs', 'tests/ts-offline.mjs', 'tests/bb-offline.mjs', 'tests/schema-offline.mjs', 'tests/pytb-offline.mjs', 'tests/sample-offline.mjs', 'tests/import-offline.mjs', 'tests/skills-offline.mjs', 'tests/rp-offline.mjs', 'tests/forge-offline.mjs', 'tests/cli-offline.mjs', 'tests/scratch-offline.mjs', 'tests/lint-offline.mjs', 'tests/colony-offline.mjs', 'tests/ui-offline.mjs'],
};

export function policy(TOP) {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(path.join(TOP, 'auto', 'policy.json'), 'utf8')); } catch { /* defaults */ }
  const r = { ...DEFAULT_POLICY, ...p, kinds: { ...DEFAULT_POLICY.kinds, ...(p.kinds ?? {}) } };
  // the money caps fail closed: a hand-edited "3e6x" or a string is 0 (nothing runs), never "no cap" (`spent >= "abc"` is false)
  for (const k of ['dailyTokens', 'taskTokens']) { const n = Number(r[k]); r[k] = Number.isFinite(n) && n >= 0 ? n : 0; }
  return r;
}
export const stopped = (TOP) => { try { return fs.readFileSync(path.join(TOP, 'auto', 'STOP'), 'utf8').trim() || 'stopped'; } catch { return null; } };
// the fingerprint of the floor: checked before and after every engine change
export function floorHash(TOP) {
  const h = crypto.createHash('sha1');
  for (const r of PROTECTED) { const f = path.join(TOP, r); h.update(r).update(fs.existsSync(f) ? fs.readFileSync(f) : '-'); }
  return h.digest('hex').slice(0, 12);
}
// may the AI spend `want` more tokens today?
export function canSpend(pol, spentToday, want = 0) {
  if (spentToday >= pol.dailyTokens) return { ok: false, why: `today's tokens ${spentToday.toLocaleString('en')} ≥ dailyTokens ${pol.dailyTokens.toLocaleString('en')}` };
  return { ok: true, left: Math.max(0, Math.min(pol.taskTokens, pol.dailyTokens - spentToday - want)) };
}
