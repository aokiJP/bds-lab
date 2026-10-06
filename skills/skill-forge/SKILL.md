---
name: skill-forge
description: Write a new skill from nothing or improve one, and prove it got better: grade it against the rubric and reference skill collections, route requests to it, refine it in a gated loop, bench it. Use when a skill is missing, weak, misrouted or too long, or when notes pile up for one area.
---

# Skill forge

Not for building an addon (use `bds-addon-master`) or for one new fact (that is a rule: `node lab.mjs skill note`, then `skill promote` with evidence).

1. `node lab.mjs skill route "<the request>"`: if a skill already owns it, refine that one; a second skill for the same job splits the router and the reader.
2. New: `node lab.mjs skill new <name> "<what it does>. Use when <2-4 triggers>."`, then fill its lines: Not for (name the other skill), 3-6 numbered steps that each start with a real command, `Done when` and `Report:`. `--like <skill|repo/skill>` borrows the parts of one that works.
3. `node lab.mjs skill refine <name>` (or `weakest`): the brief lists each weak criterion with the line the best reference skill uses for it, rules still missed, candidates, and requests routed wrong. Change SKILL.md and triggers.txt for exactly those.
4. `node lab.mjs skill refine <name> --done`: kept only if no criterion, no other skill and no routing case got worse; otherwise the old file comes back with the reason. Repeat 3-4 until nothing in the brief is worth a line; `--via <ai>` lets another AI do the edits, and only edits that raise something stay; `--goal shorter` cuts bytes while every code span, number and rule id survives.
5. `node lab.mjs skill build --check`; name it in bds-addon-master; `node lab.mjs skill bench --without <name>` (AI tokens): a draft becomes kept only when builds are no worse with it.
6. `node lab.mjs skill growth`: L1 rules, L2 skills, L3 the rubric. At its ceiling: `skill compare`, then `skill rubric mine` and `calibrate`; adopt only what calibrate calls adoptable.

- A skill an AI writes for itself is a draft until a bench keeps it (self-written skills averaged -1.3pp in SkillsBench, curated +16.2pp): trust the gates, not the feeling that it reads well.
- Keep it under 3200 bytes, procedural, with one working example (comprehensive documents measured -2.9pp).
- Never copy a held-out case of skills/routes.json into a skill or triggers.txt (the router then learns the test, not the words people use).
- Never write a consequence, command or fact you have not seen to raise a criterion: an AI that did (invented "when missed" clauses, +35% bytes) is why the gate wants a measured gain.
- Only portable text in SKILL.md; one AI's part goes in an `only:<ai>` comment block or skills/<name>/ai/<ai>.md. An AI without skill folders: `skill prompt --for <ai>`.

Done when refine says KEPT and `skill build --check` passes. Report: grade before → after, routing dev / held-out, and that a skill not yet benched is unverified (say so).

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
<!-- rules:end -->
