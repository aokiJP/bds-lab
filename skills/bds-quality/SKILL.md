---
name: bds-quality
description: Make an addon's tests worth trusting after go says DONE, and report honestly. Use after DONE, before handing an addon over.
---

# Quality after DONE

Not for getting `go` to pass the first time (`bds-tests`, `bds-debug`); after this, hand over with `bds-deliver`.

1. `node lab.mjs gaps`: code no test runs, with the test lines that would reach it.
2. `node lab.mjs mutate`: small bugs planted one at a time; each one that survives needs a check.
3. `node lab.mjs chaos --append`; again after each fix, since one error can hide the next.
4. Each finding becomes a `##` section; `go` again.

The same for Endstone plugins (Python lines) and LeviLamina mods; each mutant is one server run (under Wine about 2 min: run `mutate` in the background). A unit left changed by a stopped mutate is put back by the next lab command.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- After DONE: gaps (code no test runs) → mutate (bugs no test notices: write the check each one needs) → chaos; a new test must fail on the broken code. (when missed: tests that pass whatever the code does) `quality-mutate`
- Report what ran on the real server (go DONE, the numbers) apart from what only sim or reading showed; name what you decided without asking. (when missed: claims nobody ran) `quality-honest`
<!-- rules:end -->

Done when every mutant that survives has a section or a reason and `go` is DONE again. Report gaps / mutate / chaos before → after and the survivors kept on purpose; untested code stays untested (say so).
