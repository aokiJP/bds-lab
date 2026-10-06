---
name: bds-content
description: Add custom items, blocks, mobs, recipes and loot that load on the real BDS. Use for bp/items, bp/blocks, bp/entities, bp/recipes, bp/loot_tables and textures.
---

# Custom content

Not for a mob's shape or look (`bds-models`) or what an item does when used (script: `bds-script-api`, kit onItem).

1. `node lab.mjs add item|block|entity ...` (options: AGENTS.md step 2, `help add`); run it again on the same id to add components.
2. Fix each E/W schema line where it points; a component's fields: `node lab.mjs doc <minecraft:component>`.
3. Recipes and other vanilla formats: copy from `sample`.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Look up vanilla files before writing JSON: `sample recipe`, `sample recipes/glass_bottle.json`, `doc minecraft:recipe_shapeless`. (when missed: a guessed format the game rejects) `content-sample`
- A shaped/shapeless recipe with format_version 1.20 or later needs "unlock" (e.g. [{"item": "lab:gel"}]), or it does not load. (when missed: the recipe never appears) `content-unlock`
- A custom item/block component needs both `ns:x={}` in the item/block components (add ... 'ns:x={}') and kit onItem/onBlock('ns:x', ...). (when missed: the hook never runs (why says so)) `content-component`
- A mob's drops: add entity ... drops=ns:item*1-2 writes its loot table; test the kill with a weapon (give a diamond_sword; a fist does 1). (when missed: the mob does not die in the test) `content-drops`
<!-- rules:end -->

Done when `go` passes a section that gets each new thing (give / craft_at / kill the mob with a weapon) and checks the inventory or the ground.

Limits: the E/W schema lines are a static check (a file can pass and still not behave); `go` proves only what its section does on the server; a drawn texture is never rendered in a client. Report the ids added and which were checked in the game, then say what was not verified.
