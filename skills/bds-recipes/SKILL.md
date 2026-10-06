---
name: bds-recipes
description: Proven addons in bds/addons to copy from for common requests (daily login, homes, shop and money, cooldown items, zones, timed contests, interactive blocks, custom mobs and recipes, form looks). Use first for a new addon from a request: the closest one is a working start.
---

# Recipes: start from a proven addon
<!-- catalog -->

Not for a person's addon (`bds-fix-addon`). Each unit below passes `go` on the real BDS (`node lab.mjs skill verify unit`).

1. Pick the closest line. 2. Read its src/main.ts and tests.txt (10-45 lines); copy the shape, not the names. 3. Change what the request asks; keep the tests that still apply.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Daily login / streak: day number from the local date, last day + streak saved per player on initialSpawn; test days with `clock +1d` → bds/addons/daily (when missed: a test that cannot reach tomorrow) `recipe-daily`
- A command once a day per player (cooldown over restarts) → bds/addons/coins (when missed: a cooldown lost on restart) `recipe-once-a-day`
- Homes / warps: save<{dim,x,y,z}> per player, teleport with { dimension }, cooldown() → bds/addons/home (when missed: homes lost on restart or in the wrong dimension) `recipe-home`
- Money and a shop: score() on the sidebar, balance via hasParticipant, menu() of goods, /pay refusing self, ≤0 and too much → bds/addons/shop (when missed: getScore crash for a new player; negative pay) `recipe-shop`
- A custom item with an effect, a cooldown and a use count on the sidebar; given once on first join → bds/addons/wand (when missed: spam use; the gift given at every join) `recipe-item`
- Entering / leaving an area: every(5) checks positions, a Set remembers who is inside → bds/addons/zone (when missed: a message every tick while inside) `recipe-zone`
- A timed contest: end tick + runTimeout(finish), sidebar scores, prize to the top player still online, seconds as an argument for tests → bds/addons/fishcup (when missed: a 3-minute test; the prize to someone who left) `recipe-contest`
- A block players toggle (block state) and a name typed in a form, kept over restart → bds/addons/lamp (when missed: state lost on restart) `recipe-block`
- A custom mob with drops, a crafting recipe and a potion effect → bds/addons/jelly (when missed: the recipe never appears; drops not tested with a weapon) `recipe-mob`
- A form with its own look (JSON UI server_form by title marker) → bds/addons/jsonui_demo (when missed: every form changes look) `recipe-ui`
- A person's addon that broke after an update, fixed in place (their UUIDs, plain JS kept) → bds/addons/teleport_menu (TASK.md lists every change) (when missed: a rewrite instead of a fix) `recipe-fixed`
<!-- rules:end -->

None close: `bds-script-api` + `bds-tests`; once it passes, `node lab.mjs skill note "recipe: <unit> does <what>"`.

Done when `go` is DONE. Report the recipe you began from and what stays untested (say so).
