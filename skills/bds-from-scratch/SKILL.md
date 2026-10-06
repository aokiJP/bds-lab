---
name: bds-from-scratch
description: Build a new addon from nothing when no proven addon is close: request lines become tests, APIs are looked up and probed in the sandbox and the live world, then code. Use for a request bds-recipes has no close line for, or to practise from-scratch lessons.
---

# From scratch

Not for a request with a close proven addon (start from `bds-recipes`), a person's addon (`bds-fix-addon`) or only its look (`bds-json-ui`).

1. Split the request into lines a player can see (a message, an item, a score, a block state): each is one `## section` of tests.txt. Then `node lab.mjs bds new <name> "<Title>" "<request>"`.
2. Find each line's API: `node lab.mjs api world.afterEvents.playerSpawn`, `doc minecraft:cooldown`. Nothing found means this BDS does not have it: change the plan.
3. Probe what you are unsure of before building on it: `node lab.mjs ts try "new mc.ItemStack('minecraft:apple').maxAmount"` (the sandbox, about 1 s), then the same with `ts` in the live world after `up`; `node lab.mjs scratch probe "<code>"` runs both and says AGREE or DIFFER.
4. Write tests.txt from step 1, then src/main.ts with the kit; `node lab.mjs sim` after each edit until it passes.
5. `node lab.mjs go` until DONE.
6. To practise: `node lab.mjs scratch next` gives a graded lesson with hidden tests; `scratch check <id>` runs them in the sandbox, `--real` on the real BDS; `scratch gaps` lists where the sandbox was wrong.

- Never copy another unit's code into a lesson, because finding the API yourself is what it trains; read a recipe only after it passes.
- A sandbox PASS is a hint, not proof: it has not measured everything, and UNSURE or SKIP means it cannot tell; only `go` or `scratch check --real` decides.
- When the two differ the real BDS is the truth: say which one you relied on.
- What surprised you: `node lab.mjs skill note "<what to do>"`; a probe both agree on becomes a candidate rule with `scratch probe "<code>" --rule "<rule>" --skill <name>`.

Done when go prints DONE (or the lesson passes with --real). Report: the request line each section proves, what you probed and its answer, and what is not verified (say so).

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
<!-- rules:end -->
