---
name: bds-debug
description: Find why a go / test / sim run fails on bds-lab without guessing: read the failure, get the values, see events. Use when go fails and the cause is not plain from its output.
---

# Debugging

Not for a failure whose `rule:` line already says the fix (follow it), or for writing new tests (`bds-tests`).

1. Each ✘ block: the command, `want`, `got`; an E line with `(during: <command>)` and often a `fix:` line.
2. When go did not run it: `node lab.mjs why ["<title>"]`; read it whole before any edit.
3. Watch the suspect spot (tools: AGENTS.md Debug): `trace src/main.ts:<line> [expr]` where the value goes wrong, `events on <name>` for a hook that never fires.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Read the first ✘ / E line of go and its fix/hint line before editing; with no file:line go runs why itself; `why "<title>"` shows the values where it threw. (when missed: edits that do not touch the cause (go says SAME failures)) `debug-read-go`
- sim (about 1 s, no server) is a hint between edits; go on the real server decides. ? UNSURE = the sandbox has not measured that part (movement, a skipped section before). (when missed: trusting a sim pass) `debug-sim`
<!-- rules:end -->

Done when the same `go` shows the ✘ gone (SAME failures: the edit missed the cause). Report the cause with the line and values that show it; a cause you did not see in the output is a guess (say so), and a fix go has not rerun is not verified.
