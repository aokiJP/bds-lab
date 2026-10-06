# 目標プランナーの RTA（本物の BDS、生成ワールド）

`node docs/goals/run.mjs [seed] [item...]` が BDS 1.26.51.1 を LAB_WORLD=normal（普通の地形、シード指定）で起動し、本物のクライアントが持ち物ゼロでワールドのスポーン地点に入って `rta_<item>` を実行した記録（手書きの行は無い）。
プランナー（common/goal.cjs）が BDS 自身のデータ（common/data/kb.json: レシピ、精錬、ブロックごと・道具ごとのドロップ、モブのドロップ）から手順を組み、goal-exec.cjs が歩く・掘る・作業台を置く・かまどで焼く・倒す・搾る…を実行し、世界が計画どおりでなければその場で計画し直す。見つけるのは「見える」ブロックだけ（空気に面していて視線が通るもの。xray は使わない）。

| シード | 目標 | 結果 | タイム | 手順 | 死亡 | 失敗して計画し直した手順 / やめた理由 | 最後の持ち物 |
|---|---|---|---|---|---|---|---|
| 1 | `crafting_table` | ✔ | 0:06 | 3 | 0 |  |  |
| 1 | `crafting_table (race x2)` | ✔ | 0:06 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:08 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:09 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:12 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:22 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:27 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:28 | 3 | 0 |  | 0:crafting_table*1 1:leaf_litter*1 2:dirt*2 |
| 1 | `crafting_table (race x2)` | ✔ | 0:36 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:43 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:53 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `crafting_table (race x2)` | ✔ | 0:53 | 3 | 0 |  | 0:crafting_table*1 |
| 1 | `wooden_pickaxe` | ✔ | 0:57 | 5 | 0 |  |  |
| 1 | `crafting_table (race x2)` | ✔ | 1:16 | 3 | 1 |  |  |
| 1 | `stone_pickaxe (race x2)` | ✔ | 1:19 | 7 | 0 |  | 0:oak_planks*1 1:dirt*4 2:leaf_litter*3 3:oak_sapling*1 4:wooden_pickaxe*1 5:wooden_sword*1 6:stone_pickaxe*1 7:crafting_table*1 |
| 1 | `stone_pickaxe (race x10)` | ✔ | 1:22 | 9 | 0 |  | 0:dirt*13 1:oak_log*1 2:stick*2 3:wooden_pickaxe*1 4:stick*1 5:wooden_sword*1 6:stone_pickaxe*1 7:leaf_litter*1 8:crafting_table*1 9:oak_planks*3 |
| 1 | `stone_pickaxe` | ✔ | 1:26 | 7 | 0 |  |  |
| 1 | `stone_pickaxe (race x2)` | ✔ | 1:38 | 10 | 0 |  | 0:stick*2 1:wooden_pickaxe*1 2:stick*1 3:wooden_sword*1 4:stone_pickaxe*1 5:dirt*6 6:crafting_table*1 7:andesite*2 8:leaf_litter*2 9:dark_oak_planks*3 |
| 1 | `stone_pickaxe (race x2)` | ✔ | 1:49 | 9 | 0 |  | 0:dirt*1 1:stick*2 2:birch_log*2 3:wooden_pickaxe*1 4:stick*1 5:wooden_sword*1 6:stone_pickaxe*1 7:crafting_table*1 8:birch_planks*3 |
| 1 | `torch` | ✔ | 1:51 | 10 | 0 |  |  |
| 1 | `crafting_table (race x2)` | ✔ | 1:55 | 3 | 0 |  | 0:oak_log*1 1:crafting_table*1 |
| 1 | `furnace` | ✔ | 2:01 | 7 | 0 |  |  |
| 1 | `crafting_table (race x2)` | ✔ | 2:01 | 3 | 1 |  |  |
| 1 | `stone_pickaxe (race x2)` | ✔ | 2:08 | 10 | 0 |  | 0:stick*2 1:wooden_pickaxe*1 2:stick*1 3:wooden_sword*1 4:stone_pickaxe*1 5:dirt*13 6:cobblestone*1 7:gravel*2 8:dark_oak_planks*3 9:leaf_litter*2 10:crafting_t |
| 1 | `crafting_table (race x2)` | ✔ | 2:08 | 3 | 0 |  | 0:dirt*4 1:leaf_litter*7 2:oak_log*1 3:crafting_table*1 |
| 1 | `challenge_walk_250 (race x10)` | ✔ | 2:19 | 1 | 0 |  |  |
| 1 | `crafting_table (race x2)` | ✔ | 2:19 | 3 | 0 |  | 0:dirt*13 1:crafting_table*1 |
| 1 | `bucket` | ✔ | 2:27 | 14 | 0 |  |  |
| 1 | `stone_pickaxe (race x2)` | ✔ | 2:40 | 10 | 0 |  | 0:stick*2 1:wooden_pickaxe*1 2:stick*1 3:wooden_sword*1 4:stone_pickaxe*1 5:dirt*13 6:cobblestone*1 7:oak_planks*3 8:crafting_table*1 |
| 1 | `quest_eat_cooked_beef (race x10)` | ✔ | 3:34 | 10 | 0 |  | 0:cooked_beef*1 1:furnace*1 2:wooden_pickaxe*1 3:stick*1 4:wooden_sword*1 5:birch_planks*1 6:dirt*17 7:cobblestone*7 8:crafting_table*1 9:leather*1 10:beef*2 11 |
| 1 | `challenge_depth_y0 (race x10)` | ✔ | 3:43 | 14 | 0 |  | 0:wooden_pickaxe*1 1:dirt*9 2:stone_pickaxe*1 3:stone_pickaxe*1 4:oak_log*2 5:oak_planks*1 6:stick*5 7:wooden_sword*1 8:cobblestone*55 9:crafting_table*2 10:gra |
| 1 | `iron_pickaxe (race x10)` | ✔ | 4:06 | 15 | 0 |  | 0:dirt*2 1:iron_pickaxe*1 2:crafting_table*1 3:wooden_pickaxe*1 5:stone_pickaxe*1 6:cobblestone*26 7:leaf_litter*2 8:stone_pickaxe*1 9:gravel*1 10:furnace*1 11: |
| 1 | `iron_pickaxe (race x20)` | ✔ | 4:25 | 15 | 0 |  | 0:iron_pickaxe*1 1:birch_log*1 2:wooden_pickaxe*1 3:crafting_table*1 4:furnace*1 5:dirt*6 6:leaf_litter*2 7:cobblestone*30 9:stone_sword*1 10:stone_pickaxe*1 11 |
| 1 | `challenge_depth_y0 (race x10)` | ✔ | 4:39 | 12 | 0 |  | 0:wooden_sword*1 1:wooden_pickaxe*1 2:stone_pickaxe*1 3:oak_planks*7 4:stone_pickaxe*1 5:torch*3 6:stick*4 7:dirt*4 8:oak_stairs*1 9:crafting_table*2 10:cobbles |
| 1 | `iron_pickaxe` | ✔ | 6:12 | 18 | 0 |  |  |
| 1 | `shield` | ✔ | 6:40 | 21 | 0 |  |  |
| 1 | `challenge_bingo_1 (race x10)` | ✔ | 7:19 | 25 | 0 |  |  |
| 1 | `bed` | ✔ | 7:44 | 15 | 1 |  |  |
| 1 | `bucket (race x10)` | ✔ | 9:55 | 16 | 1 |  | 0:stone_pickaxe*1 1:stick*4 2:bucket*1 4:wooden_sword*1 5:wooden_pickaxe*1 6:oak_log*2 7:dirt*5 8:stone_pickaxe*1 9:oak_sapling*1 10:feather*2 11:oak_planks*2 1 |
| 1 | `bread` | ✘ | — | 39 | 0 | stopped after 10m11s: farm: till by water, plant 3 wheat_seeds, wait for them -> 3 wheat: nowhere to plant by the water |  |
| 1 | `iron_ingot` | ✘ | — | 41 | 1 | stopped after 3m25s: mine iron_ore (stone+ pickaxe) -> 1 raw_iron: no iron_ore found |  |
| 1 | `cake` | ✘ | — | 13 | 0 | stopped after 2m04s: craft stone_pickaxe x2 (table) from 6 #stone_tool_materials + 4 stick: craft stone_pickaxe did not work (stick*6 oak_log*1 oak_sapling*1 oa |  |
| 1 | `shield (race x10)` | ✘ | — | 17 | 2 | stopped after 40m01s: out of time (40 min) | 0:dirt*2 |
| 1 | `bread (race x3)` | ✘ | — | 3 | 4 | stopped after 25m22s: out of time (25 min) |  |
| 1 | `challenge_iron_tools (race x10)` | ✘ | — | 25 | 0 | stopped after 40m03s: at iron_axe: out of time (40 min) | 0:iron_shovel*1 1:iron_pickaxe*1 2:iron_sword*1 3:clay_ball*64 4:torch*2 5:dirt*8 6:dark_oak_planks*2 7:rotten_flesh*1 8:cobblestone*61 9:diorite*36 10:wooden_s |
| 1 | `quest_breed_cow (race x3)` | ✘ | — | 0 | 1 | stopped after 25m44s: at wheat: out of time (25 min) | 0:dirt*6 1:bone*1 |
| 1 | `stone_pickaxe (race x2)` | ✘ | — | 6 | 0 | stopped after 3m10s: out of time (3 min) | 0:oak_planks*1 1:leaf_litter*9 2:dirt*21 3:wooden_pickaxe*1 4:stick*1 5:wooden_sword*1 6:crafting_table*1 7:cobblestone*5 |
| 1 | `quest_shear (race x10)` | ✘ | — | 31 | 4 | stopped after 40m01s: at shears: out of time (40 min) | 0:dirt*3 1:wheat_seeds*1 |
| 1 | `crafting_table (race x2)` | ✘ | — | 0 | 2 | stopped after 4m16s: out of time (3 min) |  |
| 1 | `crafting_table (race x2)` | ✘ | — | 0 | 0 | stopped after 3m12s: out of time (3 min) |  |
| 1 | `challenge_walk_250 (race x10)` | ✘ | — | 4 | 4 | stopped after 40m24s: got 2 blocks away only | 0:dirt*6 1:rotten_flesh*2 |
| 1 | `challenge_iron_tools (race x10)` | ✘ | — | 41 | 3 | stopped after 40m04s: at iron_hoe: out of time (40 min) | 0:iron_sword*1 1:wooden_sword*1 2:wooden_pickaxe*1 3:crafting_table*1 5:dark_oak_log*1 6:leaf_litter*7 7:cobblestone*22 8:stone_pickaxe*1 9:furnace*1 10:stone_p |
| 1 | `quest_shear (race x10)` | ✘ | — | 11 | 5 | stopped after 30m19s: no sheep found |  |
| 2 | `challenge_bingo_3 (race x2)` | ✘ | — | 8 | 0 | stopped after 6m04s: at bucket: out of time (6 min) | 0:spruce_planks*3 1:dirt*13 2:wooden_pickaxe*1 3:stick*1 4:wooden_sword*1 5:furnace*1 6:stone_pickaxe*1 7:stone_pickaxe*1 8:crafting_table*1 9:cobblestone*64 10 |
| 2 | `challenge_bingo_3 (race x2)` | ✘ | — | 3 | 0 | stopped after 6m19s: at oak_boat: out of time (6 min) | 0:crafting_table*1 |

## 目標ごとの最速（ゲーム内時間）

| 目標 | 最速 | シード | 走り方 | 日付 | 成功 / 試行 |
|---|---|---|---|---|---|
| `crafting_table` | 0:06 | 1 | single | 2026-09-25 | 17 / 19 |
| `wooden_pickaxe` | 0:57 | 1 | single | 2026-09-25 | 1 / 1 |
| `stone_pickaxe` | 1:19 | 1 | race x2 | 2026-09-26 | 7 / 8 |
| `torch` | 1:51 | 1 | single | 2026-09-25 | 1 / 1 |
| `furnace` | 2:01 | 1 | single | 2026-09-25 | 1 / 1 |
| `challenge_walk_250` | 2:19 | 1 | race x10 | 2026-09-28 | 1 / 2 |
| `bucket` | 2:27 | 1 | single | 2026-09-25 | 2 / 2 |
| `quest_eat_cooked_beef` | 3:34 | 1 | race x10 | 2026-09-28 | 1 / 1 |
| `challenge_depth_y0` | 3:43 | 1 | race x10 | 2026-09-27 | 2 / 2 |
| `iron_pickaxe` | 4:06 | 1 | race x10 | 2026-09-28 | 3 / 3 |
| `shield` | 6:40 | 1 | single | 2026-09-25 | 1 / 2 |
| `challenge_bingo_1` | 7:19 | 1 | race x10 | 2026-09-28 | 1 / 1 |
| `bed` | 7:44 | 1 | single | 2026-09-25 | 1 / 1 |
| `bread` | — | — | — | — | 0 / 2 |
| `iron_ingot` | — | — | — | — | 0 / 1 |
| `cake` | — | — | — | — | 0 / 1 |
| `challenge_iron_tools` | — | — | — | — | 0 / 2 |
| `quest_breed_cow` | — | — | — | — | 0 / 1 |
| `quest_shear` | — | — | — | — | 0 / 2 |
| `challenge_bingo_3` | — | — | — | — | 0 / 2 |

## 手順（成功した回）

### crafting_table（シード 1、0:06）

1. mine any tree (hand) -> 1 logs
2. craft birch_planks x4 from 1 birch_log
3. craft crafting_table from 4 #planks

### crafting_table (race x2)（シード 1、0:06）

| スプリット | 手順 |
|---|---|
| 0m04s | mine any tree -> 1 logs (±0s) |
| 0m05s | craft birch_planks x4 |
| 0m06s | craft crafting_table (-2s) |

### crafting_table (race x2)（シード 1、0:08）

| スプリット | 手順 |
|---|---|
| 0m04s | mine any tree -> 1 logs |
| 0m07s | craft dark_oak_planks x4 |
| 0m08s | craft crafting_table |

### crafting_table (race x2)（シード 1、0:09）

| スプリット | 手順 |
|---|---|
| 0m07s | mine any tree -> 1 logs (+3s) |
| 0m08s | craft oak_planks x4 |
| 0m09s | craft crafting_table (+1s) |

### crafting_table (race x2)（シード 1、0:12）

| スプリット | 手順 |
|---|---|
| 0m10s | mine any tree -> 1 logs (+6s) |
| 0m11s | craft birch_planks x4 |
| 0m12s | craft crafting_table (+4s) |

### crafting_table (race x2)（シード 1、0:22）

| スプリット | 手順 |
|---|---|
| 0m11s | mine any tree -> 1 logs (+7s) |
| 0m15s | craft oak_planks x4 |
| 0m22s | craft crafting_table (+14s) |

### crafting_table (race x2)（シード 1、0:27）

| スプリット | 手順 |
|---|---|
| 0m26s | mine any tree -> 1 logs (+22s) |
| 0m26s | craft birch_planks x4 (+21s) |
| 0m27s | craft crafting_table (+21s) |

### crafting_table (race x2)（シード 1、0:28）

| スプリット | 手順 |
|---|---|
| 0m27s | mine any tree -> 1 logs (+23s) |
| 0m28s | craft dark_oak_planks x4 |
| 0m28s | craft crafting_table (+22s) |

### crafting_table (race x2)（シード 1、0:36）

| スプリット | 手順 |
|---|---|
| 0m35s | mine any tree -> 1 logs (+31s) |
| 0m35s | craft oak_planks x4 |
| 0m36s | craft crafting_table (+30s) |

### crafting_table (race x2)（シード 1、0:43）

| スプリット | 手順 |
|---|---|
| 0m42s | mine any tree -> 1 logs (+38s) |
| 0m42s | craft oak_planks x4 |
| 0m43s | craft crafting_table (+35s) |

### crafting_table (race x2)（シード 1、0:53）

| スプリット | 手順 |
|---|---|
| 0m51s | mine any tree -> 1 logs (+47s) |
| 0m52s | craft dark_oak_planks x4 |
| 0m53s | craft crafting_table (+47s) |

### crafting_table (race x2)（シード 1、0:53）

| スプリット | 手順 |
|---|---|
| 0m52s | mine any tree -> 1 logs (+48s) |
| 0m53s | craft oak_planks x4 |
| 0m53s | craft crafting_table (+47s) |

### wooden_pickaxe（シード 1、0:57）

1. mine any tree x3 (hand) -> 3 logs
2. craft birch_planks x12 from 3 birch_log
3. craft crafting_table from 4 #planks
4. craft stick x4 from 2 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick

### crafting_table (race x2)（シード 1、1:16）

| スプリット | 手順 |
|---|---|
| 1m15s | mine any tree -> 1 logs (+71s) |
| 1m16s | craft dark_oak_planks x4 (+69s) |
| 1m16s | craft crafting_table (+68s) |

### stone_pickaxe (race x2)（シード 1、1:19）

| スプリット | 手順 |
|---|---|
| 0m53s | mine any tree x3 -> 3 logs (+35s) |
| 0m54s | craft oak_planks x12 |
| 0m55s | craft crafting_table (+35s) |
| 0m56s | craft stick x4 (+35s) |
| 0m58s | craft wooden_pickaxe (+33s) |
| 1m13s | mine stone x3 -> 3 cobblestone (+21s) |
| 1m15s | craft stone_pickaxe (+6s) |

### stone_pickaxe (race x10)（シード 1、1:22）

| スプリット | 手順 |
|---|---|
| 0m43s | mine any tree x3 -> 3 logs (+25s) |
| 0m45s | craft oak_planks x12 |
| 0m46s | craft crafting_table (+26s) |
| 0m48s | craft stick x4 (+27s) |
| 0m52s | craft wooden_pickaxe (+27s) |
| 1m12s | mine stone x3 -> 3 cobblestone (+20s) |
| 1m13s | craft oak_planks x4 |
| 1m14s | craft stick x4 (+53s) |
| 1m17s | craft stone_pickaxe (+8s) |

### stone_pickaxe（シード 1、1:26）

1. mine any tree x3 (hand) -> 3 logs
2. craft oak_planks x12 from 3 oak_log
3. craft crafting_table from 4 #planks
4. craft stick x4 from 2 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick
6. mine stone x3 (wooden+ pickaxe) -> 3 cobblestone
7. craft stone_pickaxe (table) from 3 #stone_tool_materials + 2 stick

### stone_pickaxe (race x2)（シード 1、1:38）

| スプリット | 手順 |
|---|---|
| 0m34s | mine any tree x3 -> 3 logs (+16s) |
| 0m34s | craft dark_oak_planks x12 |
| 0m35s | craft crafting_table (+15s) |
| 0m36s | craft stick x4 (+15s) |
| 0m38s | craft wooden_pickaxe (+13s) |
| 1m07s | mine stone x3 -> 3 cobblestone (+15s) |
| 1m24s | mine any tree -> 1 logs (+19s) |
| 1m25s | craft dark_oak_planks x4 |
| 1m25s | craft stick x4 (+19s) |
| 1m27s | craft stone_pickaxe (+18s) |

### stone_pickaxe (race x2)（シード 1、1:49）

| スプリット | 手順 |
|---|---|
| 1m18s | mine any tree x3 -> 3 logs (+34s) |
| 1m19s | craft oak_planks x12 (+34s) |
| 1m19s | craft crafting_table (+34s) |
| 1m20s | craft stick x4 (+34s) |
| 1m22s | craft wooden_pickaxe (+34s) |
| 1m41s | mine stone x3 -> 3 cobblestone (+29s) |
| 1m41s | craft oak_planks x4 (+7s) |
| 1m41s | craft stick x4 (+55s) |
| 1m43s | craft stone_pickaxe (+7s) |

### torch（シード 1、1:51）

1. mine any tree x3 (hand) -> 3 logs
2. craft oak_planks x12 from 3 oak_log
3. craft crafting_table from 4 #planks
4. craft stick x4 from 2 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick
6. mine stone x8 (wooden+ pickaxe) -> 8 cobblestone
7. craft furnace (table) from 8 #stone_crafting_materials
8. mine any tree (hand) -> 1 logs
9. smelt 1 #logs_that_burn -> charcoal (fuel 1 oak_planks)
10. craft torch x4 from 1 charcoal + 1 stick

### crafting_table (race x2)（シード 1、1:55）

| スプリット | 手順 |
|---|---|
| 1m54s | mine any tree -> 1 logs (+110s) |
| 1m54s | craft oak_planks x4 |
| 1m55s | craft crafting_table (+107s) |

### furnace（シード 1、2:01）

1. mine any tree x3 (hand) -> 3 logs
2. craft oak_planks x12 from 3 oak_log
3. craft crafting_table from 4 #planks
4. craft stick x4 from 2 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick
6. mine stone x8 (wooden+ pickaxe) -> 8 cobblestone
7. craft furnace (table) from 8 #stone_crafting_materials

### crafting_table (race x2)（シード 1、2:01）

| スプリット | 手順 |
|---|---|
| 2m00s | mine any tree -> 1 logs (+116s) |
| 2m01s | craft spruce_planks x4 |
| 2m01s | craft crafting_table (+115s) |

### stone_pickaxe (race x2)（シード 1、2:08）

| スプリット | 手順 |
|---|---|
| 0m56s | mine any tree x3 -> 3 logs (+38s) |
| 0m56s | craft dark_oak_planks x12 |
| 0m57s | craft crafting_table (+37s) |
| 0m57s | craft stick x4 (+36s) |
| 1m00s | craft wooden_pickaxe (+35s) |
| 1m26s | mine stone x3 -> 3 cobblestone (+34s) |
| 2m01s | mine any tree -> 1 logs (+56s) |
| 2m01s | craft dark_oak_planks x4 |
| 2m02s | craft stick x4 (+56s) |
| 2m04s | craft stone_pickaxe (+55s) |

### crafting_table (race x2)（シード 1、2:08）

| スプリット | 手順 |
|---|---|
| 2m07s | mine any tree -> 1 logs (+123s) |
| 2m07s | craft oak_planks x4 |
| 2m08s | craft crafting_table (+122s) |

### challenge_walk_250 (race x10)（シード 1、2:19）

| スプリット | 手順 |
|---|---|
| 2m19s | 251 blocks away (+20s) |

### crafting_table (race x2)（シード 1、2:19）

| スプリット | 手順 |
|---|---|
| 2m18s | mine any tree -> 1 logs (+134s) |
| 2m19s | craft cherry_planks x4 |
| 2m19s | craft crafting_table (+131s) |

### bucket（シード 1、2:27）

1. mine any tree x4 (hand) -> 4 logs
2. craft birch_planks x16 from 4 birch_log
3. craft crafting_table from 4 #planks
4. craft stick x8 from 4 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick
6. mine stone x11 (wooden+ pickaxe) -> 11 cobblestone
7. craft furnace (table) from 8 #stone_crafting_materials
8. craft stone_pickaxe (table) from 3 #stone_tool_materials + 2 stick
9. mine stone (wooden+ pickaxe) -> 1 cobblestone
10. craft stone_sword (table) from 2 #stone_tool_materials + 1 stick
11. mine iron_ore x3 (stone+ pickaxe) -> 3 raw_iron
12. iron_ore|deepslate_iron_ore not in sight: digging down to y=16
13. smelt 3 raw_iron -> iron_ingot (fuel 2 birch_planks)
14. craft bucket (table) from 3 iron_ingot

### stone_pickaxe (race x2)（シード 1、2:40）

| スプリット | 手順 |
|---|---|
| 0m52s | mine any tree x3 -> 3 logs (+34s) |
| 0m53s | craft oak_planks x12 |
| 0m53s | craft crafting_table (+33s) |
| 0m54s | craft stick x4 (+33s) |
| 0m57s | craft wooden_pickaxe (+32s) |
| 1m16s | mine stone x3 -> 3 cobblestone (+24s) |
| 2m32s | mine any tree -> 1 logs (+87s) |
| 2m32s | craft oak_planks x4 |
| 2m33s | craft stick x4 (+87s) |
| 2m35s | craft stone_pickaxe (+86s) |

### quest_eat_cooked_beef (race x10)（シード 1、3:34）

| スプリット | 手順 |
|---|---|
| 0m29s | mine any tree x3 -> 3 logs (+11s) |
| 0m30s | craft birch_planks x12 (+11s) |
| 0m31s | craft crafting_table (+11s) |
| 0m32s | craft stick x4 (+12s) |
| 0m35s | craft wooden_pickaxe (+11s) |
| 1m01s | mine stone x8 -> 8 cobblestone (+14s) |
| 1m03s | craft furnace (+13s) |
| 2m48s | kill cow -> 1 beef (+76s) |
| 3m01s | smelt 1 beef -> cooked_beef (+74s) |
| 3m34s | eat_cooked_beef (+101s) |

### challenge_depth_y0 (race x10)（シード 1、3:43）

| スプリット | 手順 |
|---|---|
| 0m28s | mine any tree -> 1 logs (+3s) |
| 0m31s | craft oak_planks x4 (+3s) |
| 0m33s | craft stick x4 (+2s) |
| 0m47s | mine any tree -> 1 logs (+22s) |
| 0m50s | craft oak_planks x4 (+22s) |
| 0m52s | craft crafting_table (+10s) |
| 1m19s | mine any tree x3 -> 3 logs (+12s) |
| 1m22s | craft oak_planks x12 (+11s) |
| 1m25s | craft crafting_table (+43s) |
| 1m27s | craft stick x8 (+9s) |
| 1m33s | craft wooden_pickaxe (+1s) |
| 1m51s | mine stone x6 -> 6 cobblestone (+1s) |
| 1m56s | craft stone_pickaxe x2 (±0s) |
| 3m43s | down to y=1 (+23s) |

### iron_pickaxe (race x10)（シード 1、4:06）

| スプリット | 手順 |
|---|---|
| 0m48s | mine any tree x5 -> 5 logs (+19s) |
| 0m50s | craft oak_planks x12 |
| 0m51s | craft crafting_table (+20s) |
| 0m53s | craft stick x8 |
| 0m55s | craft wooden_pickaxe (+14s) |
| 1m37s | mine stone x14 -> 14 cobblestone (+6s) |
| 1m38s | craft birch_planks x4 |
| 1m41s | craft wooden_sword |
| 1m44s | craft furnace (+6s) |
| 1m49s | craft stone_pickaxe x2 (+8s) |
| 3m19s | mine iron_ore x3 -> 3 raw_iron (+19s) |
| 3m53s | smelt 3 raw_iron -> iron_ingot |
| 3m56s | craft oak_planks x4 |
| 3m57s | craft stick x4 |
| 4m01s | craft iron_pickaxe (+22s) |

### iron_pickaxe (race x20)（シード 1、4:25）

| スプリット | 手順 |
|---|---|
| 0m39s | mine any tree x5 -> 5 logs (+9s) |
| 0m47s | craft oak_planks x12 |
| 0m53s | craft crafting_table (+20s) |
| 0m59s | craft stick x8 |
| 1m09s | craft wooden_pickaxe (+29s) |
| 1m52s | mine stone x14 -> 14 cobblestone (+15s) |
| 2m01s | craft furnace (+21s) |
| 2m10s | craft stone_pickaxe x2 (+27s) |
| 2m21s | mine stone -> 1 cobblestone |
| 2m30s | craft stone_sword |
| 3m17s | mine iron_ore x3 -> 3 raw_iron (+7s) |
| 4m00s | smelt 3 raw_iron -> iron_ingot |
| 4m07s | craft birch_planks x4 |
| 4m11s | craft stick x4 |
| 4m20s | craft iron_pickaxe (+31s) |

### challenge_depth_y0 (race x10)（シード 1、4:39）

| スプリット | 手順 |
|---|---|
| 1m20s | mine any tree -> 1 logs (+29s) |
| 1m21s | craft oak_planks x4 (+29s) |
| 1m23s | craft stick x4 (+29s) |
| 1m26s | craft oak_planks x4 (+31s) |
| 1m28s | craft crafting_table (+31s) |
| 1m29s | craft oak_planks x12 (+30s) |
| 1m30s | craft crafting_table (+29s) |
| 1m32s | craft stick x8 (+28s) |
| 1m36s | craft wooden_pickaxe (+28s) |
| 2m34s | mine stone x6 -> 6 cobblestone (+66s) |
| 2m38s | craft stone_pickaxe x2 (+66s) |
| 4m39s | down to y=1 (+92s) |

### iron_pickaxe（シード 1、6:12）

1. mine any tree x4 (hand) -> 4 logs
2. craft oak_planks x16 from 4 oak_log
3. craft crafting_table from 4 #planks
4. craft stick x8 from 4 #planks
5. craft wooden_pickaxe (table) from 3 #planks + 2 stick
6. mine stone x11 (wooden+ pickaxe) -> 11 cobblestone
7. craft furnace (table) from 8 #stone_crafting_materials
8. craft stone_pickaxe (table) from 3 #stone_tool_materials + 2 stick
9. mine stone (wooden+ pickaxe) -> 1 cobblestone
10. craft stone_sword (table) from 2 #stone_tool_materials + 1 stick
11. mine iron_ore x3 (stone+ pickaxe) -> 3 raw_iron
12. iron_ore|deepslate_iron_ore not in sight: digging down to y=16
13. stair down: y=59 (to 16)
14. stair down: y=49 (to 16)
15. stair down: y=42 (to 16)
16. stair down: y=38 (to 16)
17. smelt 3 raw_iron -> iron_ingot (fuel 2 oak_planks)
18. craft iron_pickaxe (table) from 3 iron_ingot + 2 stick

### shield（シード 1、6:40）

| スプリット | 手順 |
|---|---|
| 1m09s | mine any tree x5 -> 5 logs |
| 1m09s | craft oak_planks x16 |
| 1m10s | craft crafting_table |
| 1m11s | craft stick x8 |
| 1m12s | craft oak_planks x4 |
| 1m14s | craft wooden_pickaxe |
| 1m58s | mine stone x14 -> 14 cobblestone |
| 2m00s | craft furnace |
| 2m02s | craft stone_pickaxe x2 |
| 2m32s | mine stone -> 1 cobblestone |
| 2m34s | craft stone_sword |
| 6m11s | mine iron_ore -> 1 raw_iron |
| 6m23s | smelt 1 raw_iron -> iron_ingot |
| 6m27s | craft shield |

### challenge_bingo_1 (race x10)（シード 1、7:19）

| スプリット | 手順 |
|---|---|
| 1m22s | mine any tree -> 1 logs (-2s) |
| 1m23s | craft oak_planks x4 (-4s) |
| 1m24s | craft crafting_table (-5s) |
| 1m55s | kill sheep -> 1 white_wool (-16s) |
| 1m59s | craft oak_planks x12 (+26s) |
| 2m00s | craft crafting_table (+31s) |
| 2m02s | craft chest (+25s) |
| 2m09s | craft oak_planks x4 (+42s) |
| 2m11s | craft bowl x4 (+24s) |
| 2m17s | craft oak_planks x4 (+50s) |
| 2m18s | craft stick x4 (+5s) |
| 2m22s | craft wooden_pickaxe (+6s) |
| 2m54s | mine stone x14 -> 14 cobblestone (+3s) |
| 2m58s | craft furnace (+3s) |
| 3m06s | craft birch_planks x4 (+6s) |
| 3m08s | craft stick x4 (+7s) |
| 3m15s | craft stone_pickaxe x2 (+6s) |
| 4m08s | mine iron_ore -> 1 raw_iron (+35s) |
| 5m33s | mine any tree x2 -> 2 logs |
| 5m47s | smelt 1 raw_iron -> iron_ingot (+47s) |
| 5m51s | craft iron_nugget x9 (+47s) |
| 6m53s | mine any tree -> 1 logs (+329s) |
| 7m07s | smelt 1 #logs_that_burn -> charcoal |
| 7m11s | craft torch x4 |
| 7m15s | craft lantern (+111s) |

### bed（シード 1、7:44）

1. mine any tree x2 (hand) -> 2 logs
2. craft birch_planks x8 from 2 birch_log
3. craft crafting_table from 4 #planks
4. kill sheep x3 -> 3 white_wool
5. died at 211 58 166: respawning and going back for the things
6. too far or too deep to go back: starting over from here
7. looking for sheep: walking to 215 143
8. looking for sheep: walking to 249 132
9. looking for sheep: walking to 268 104
10. looking for sheep: walking to 305 108
11. looking for sheep: walking to 371 77
12. mine any tree x2 (hand) -> 2 logs
13. craft birch_planks x8 from 2 birch_log
14. craft crafting_table from 4 #planks
15. craft bed (table) from 3 white_wool + 3 #planks

### bucket (race x10)（シード 1、9:55）

| スプリット | 手順 |
|---|---|
| 1m07s | mine any tree x4 -> 4 logs (+2s) |
| 1m07s | craft oak_planks x16 (±0s) |
| 1m09s | craft crafting_table (+1s) |
| 1m10s | craft stick x8 (+1s) |
| 1m13s | craft wooden_pickaxe (+1s) |
| 4m18s | mine any tree x3 -> 3 logs |
| 4m20s | craft oak_planks x12 |
| 4m21s | craft crafting_table (+193s) |
| 5m31s | pick up 8 cobblestone lying nearby |
| 6m05s | craft furnace (+252s) |
| 6m47s | mine stone x6 -> 6 cobblestone |
| 6m51s | craft stone_pickaxe x2 (+293s) |
| 7m45s | craft stick x4 |
| 9m10s | mine iron_ore x3 -> 3 raw_iron (+395s) |
| 9m44s | smelt 3 raw_iron -> iron_ingot |
| 9m51s | craft bucket (+393s) |

