---
name: bds-models
description: Build or fix Bedrock entity and attachable models (rp/models/entity/*.geo.json, animations, textures) so they look right in the game. Use for custom mob shapes, held or worn items, z-fighting, mirrored or wrong textures, a person's Blockbench file.
---

# Models

Not for item or block textures alone (`bds-content`, `png`) or what a mob does (`bds-content`, `bds-script-api`).

1. Look at vanilla first when it has the thing: `render minecraft:<mob>`, `sample rp/models/entity/<name>`.
2. New mob: `node lab.mjs add entity <ns:id> "Name"` writes the client entity, geo, texture; then edit the geo.
3. After each change: `check` (lint: collapsed / duplicate cubes, z-fight, UV off the texture, unequal plate faces), then `render <ns:id|geometry.id> --anim <clip>@0` and `@end`, and read the PNG.
4. A moving part: one bone per thing that moves, pivot at the real joint; model it open, fold it with the bind pose, render every pose.
5. Report: what `check` passed, which renders you read, what still needs a look in the game (a render is not a game capture).

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Never decide a side or a look from the JSON: the game mirrors models in x (a cube's east UV shows on its low-x side). `render <id> --anim <clip>@0/@end` draws it as the game does; read the PNG before saying it looks right. (when missed: text on the wrong side, a look reported but never seen) `model-look`
- A rotation [rx,ry,rz] is applied as right-handed (-rx, ry, -rz), X then Y then Z, about the pivot; animation rotations ADD to the bind pose. (when missed: a part tilted the wrong way) `model-rotation`
- No two faces on one plane: move one part 0.02-0.05, then paint the thin step so it continues its neighbour (`check` names each z-fight pair). (when missed: flicker, then a crack where the step is) `model-zfight`
- texture_width/height must be the PNG's size and every UV inside it; a box UV [u,v] takes 2*(d+w) x (d+h) texels from there. (when missed: a face drawn with garbage) `model-uv`
- A wing, fin, leaf or cloth is ONE zero-thickness plate cut out by transparent texels (material entity_alphatest), both faces the same size and painted by position; not a board or a fan of boxes. (when missed: wings that look like boards; one face paints over the cut-out) `model-plate`
- A person's Blockbench save wins: lint it (`check`: collapsed / duplicate cubes, UV off), fix only the defects named and say which; never redesign a part nobody pointed at. (when missed: a rewrite the person rejects) `model-hand-edit`
- When vanilla has the thing (a wing, a held item, a mount), look first: `render minecraft:<mob>`, `sample rp/models/entity/<name>`. (when missed: a guessed construction rejected 3 times) `model-vanilla-first` [source]
<!-- rules:end -->

Rules marked [source] come from a reference project and are not re-run here; the rest are proven by tests/rp-offline.mjs.
