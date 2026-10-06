---
name: bds-fix-addon
description: Fix, update or finish an addon a person brings (.mcaddon, .mcpack, .zip, folder): it broke after a Minecraft update, it crashes, it forgets data, it needs a feature. Use when the work starts from someone else's addon.
---

# A person's addon

Not for a new addon from a request (`bds-recipes`) or one only the person's look (`bds-json-ui`, `bds-models`).

1. `node lab.mjs import <file> "<what they asked, their words>"` → the brief: packs and module versions (✗ = not in this BDS), ways in (commands, chat words, items, events with file:line), what breaks on this BDS's stable and beta (the audit), and "bugs found before any server" (each with its rule id: early world access, writes in before-events, getScore for new players, closed forms, state lost on restart, renamed components).
2. `node lab.mjs mode <stable|beta>` as the audit says (beta when it needs a beta-only API such as chatSend; tell them).
3. Fix every audited use and every listed bug in ONE round (they do not depend on each other); `node lab.mjs brief` again until nothing is listed. Plain JS stays plain JS (no kit there: `api <Class>` for what replaced a removed call).
4. tests.txt: the draft runs each way in once; add a section per thing they asked and one per unasked fix (it proves the fix). `go` until DONE (W lines fail it too: old item JSON is named with what to write now).
5. Their items and blocks: `add item <their id>` merges into their own file (their id stays).
6. Done when `brief` lists nothing and `go` is DONE. Report every unasked fix and what no test reaches (say so); hand over with `bds-deliver`.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- A person's addon: import <file> "<their words>" → read the brief (not every file) → the suggested mode → fix every use the audit lists → go with the draft tests → add a section per thing they asked. (when missed: one crash per go round, files read one by one) `fix-flow`
- Change what they asked and what is broken, nothing else: keep their language (plain JS stays JS), names, pack UUIDs and style; say what you changed unasked. (when missed: a rewrite the person cannot review) `fix-scope`
<!-- rules:end -->
