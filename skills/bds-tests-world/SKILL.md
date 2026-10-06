---
name: bds-tests-world
description: Tests where players move, fish, shoot, fight mobs or see broadcasts in the world (walk, goto, fishing pools, projectiles, two players apart, Endstone broadcasts). Use with bds-tests when a section does more than commands and forms.
---

# Tests in the world

Not for sections of commands and forms only (`bds-tests` is enough there).

1. Place first: `tp B 4 -60 0` (players share the spawn block, so a throw or a shot hits the other one); build what they need (`fill ... water` for a pool, `mob(type,x,y,z)` in a js line).
2. Act: `@A walk forward 20` (ticks), `@A goto x z`, `@A attack <mob>`, `@A fish_n n 30`.
3. Wait for the line that proves it with `until <regex> [ms]` (a guessed `wait` is flaky); check random outcomes as ranges.

Done when `go` passes these sections twice in a row (random and timing).

Limit: a passing `go` proves only the lines, ranges and events the test checks, on that server. A range is not an exact count, and a run with players placed apart does not show how they behave at the shared spawn. In the report, say what was not verified (for example: other counts, other positions, the other server type) with the sentence `say what was not verified`.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Count a catch by playerInventoryItemChange (a fish arrives) right after the player used the rod (itemUse); there is no fishing event. (when missed: api ?fish finds nothing) `api-rod-events`
- All real players spawn on the same block (0 -60 0): move one (tp B 4 -60 0) before they throw, fish or shoot, or they hit each other. (when missed: "the bobber caught on B", projectiles hit the other player) `test-same-spawn`
- Loot and fishing are random: never expect an exact count; check a range (~ ^[12]$) or a relation (the score equals the fish in the inventory). (when missed: a test that passes sometimes) `test-random`
- `@A walk forward N`: N is ticks, not blocks (20 ticks = 4.3 blocks; forward = +z, left = +x as spawned); `@A goto x z` for a place. (when missed: the player stops short of the zone) `test-walk-ticks`
- Fishing in a test: a pool ahead of the player (fill -8 -64 2 8 -61 24 water), enchant A lure 3 (about 8 s a catch), @A fish_n n 30. (when missed: "the bobber landed on grass") `test-fish-setup`
- world.sendMessage / say prints as one plain line on BDS; a player's chat shows on every player, the sender too, as `@B chat <A> text`; in Endstone a broadcast shows as each player's line (@A ...). (when missed: ~ ^text misses because the line is "@A text") `test-broadcast`
<!-- rules:end -->
