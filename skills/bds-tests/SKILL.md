---
name: bds-tests
description: Write tests.txt that proves what the request asks on the real BDS with real clients, and that fails when the code is wrong. Use whenever writing or fixing tests.txt.
---

# tests.txt

1. One `## section` per thing the request asks, named after that request line (line forms `=` `~` `!` `!~`: AGENTS.md).
2. Players: `@A join`, `@A cmd /ns:x args`, `@A use`, `@A form ...`; others: `node lab.mjs help verbs <word>`. Not for walking, fishing, fights: use `bds-tests-world` with this.
3. Values: `js <expr>` in the addon (its value only is checked by the lines under it).
4. `node lab.mjs sim` between edits (about 1 s); `go` decides.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- tests.txt sections run in order in ONE world: items, cooldowns, saved data and joined players carry over (`@A join` again prints `@A already joined`). Give each section what it needs, or wait out a cooldown. (when missed: a section passes alone and fails after the one before it) `test-one-world`
- `~` is a regex: escape * . ( ) [ ] + ? (inventory lines are slot:id*n, so ~ minecraft:bread\*2); use = for a whole exact line; ^ ties to the line start (a player's line starts with @A ). (when missed: want and got look the same and the check still fails) `test-regex`
- Daily or weekly logic: `clock +1d` moves the addon's Date ahead (kept over restart); never add a test-only back door to the addon. (when missed: no way to test "the next day") `test-clock`
- Wait with `until <regex> [ms]` (a 10 s timer: until ... 15000), not a guessed wait; make long durations an argument or a setting so the test can shorten them. (when missed: flaky timing, or a test that takes minutes) `test-until`
- In a js line: p('A') is the player, inv(p) gives ["slot:id*n"], dim is the overworld itself (dim.getEntities, not dim()), mob(type,x,y,z) spawns. (when missed: dim.getEntities is not a function) `test-js-helpers`
- A line is what the client shows: § colours gone, trailing spaces trimmed, a rawtext {translate:'k', with:[..]} as `@A %k [a, b]`: match that form (texts: node lab.mjs i18n). (when missed: a whole go spent on a text that never comes) `test-client-lines`
- `!` and `!~` check the whole section, later lines too: to prove something did not happen before a later step makes it, give that check its own section. (when missed: an absence check fails on what a later line prints) `test-absent-section`
- A js line gives its last expression: `js const l = inv(p('A')); l.length` (or `return x`); nothing printed means undefined. (when missed: want = 2, got only other lines) `test-js-last`
- `~` regexes are JavaScript and match one line: no (?s) or other inline flags (only a leading (?i)); for an order across lines, compute it in a js/py/lse line and check its value. (when missed: Invalid regular expression after the server started) `test-regex-js`
<!-- rules:end -->

Done when `go` passes and each section fails once the code is broken (`mutate`). Report which request lines a section proves; `sim` is not proof (say so).
