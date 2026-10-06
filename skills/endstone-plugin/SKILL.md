---
name: endstone-plugin
description: Build an Endstone (Python) plugin proven on a real Endstone server: commands, events, scheduler, PyPI packages. Use for what BDS scripts cannot do: HTTP, files, SQL, per-player sidebar/boss bar, logins, packets.
---

# Endstone plugin

Not for what an addon script can do (`bds-script-api`) or a LeviLamina server (`levilamina-mod`).

1. `node lab.mjs end new <n> "Title" "<request>"`, then read end/AGENTS.md (one screen).
2. tests.txt as for addons, plus `py <code>` lines in the server (`return x`), `py plugin.<attr> = v` to set the plugin up.
3. `node lab.mjs go` = pyright on Endstone's stubs → tests → QA → .whl.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Make waits and limits plugin attributes so a test sets them: `py plugin.idle_seconds = 3` instead of waiting 5 minutes. (when missed: a test that takes minutes) `end-settable`
- PyPI packages: lib add <pkg> (writes pyproject); go installs what pyproject declares and is missing. (when missed: plugin fails to load: No module named ...) `end-deps`
- The Endstone API is server-thread only: no sleep or blocking I/O there; a thread computes, then self.server.scheduler.run_task(self, fn) brings the result back. (when missed: every player freezes) `end-thread`
- A py line's value prints short, not as Python repr: a str as itself, True/False, None as -, lists and tuples as ["B","A",0], dicts as {k=v}: write `=` in that form, or return an f-string. (when missed: want [('B', 'A', 0)] never matches) `end-json`
- Start from the closest working plugin: `node lab.mjs help ideas` lists end/plugins (SQLite and restarts: sqlstats; a report system with cooldowns and an op list: report). (when missed: a structure guessed from scratch) `end-template`
- The lab's players are operators: `deop B` before a section that proves a normal player is refused ("op" permissions). (when missed: a permission check that is never tested) `end-perm`
<!-- rules:end -->

Done when `go` is DONE and gives the .whl (end/dist/). Report which commands and events a `py` or player line proved; anything only typed-checked by pyright is unverified (say so). Hand over with `bds-deliver`.
