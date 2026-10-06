# 日常の動作を本物の BDS で動かした結果

`node docs/verbs/run.mjs [分類|動作]` が BDS 1.26.51.1 と本物のクライアントで、目録（common/data/everyday.json）の動作を 1 つずつ同じ初期状態から実行した記録（手書きの行は無い）。
各動作は目録の `items`（持ち物欄の奥に置く）・`blocks`・`mobs`（のろさで止め、子どもは大人にする）・`real.setup` を用意し、`real.stage`（サーバーが見た向き・位置を毎 tick 記録するなど、試験だけの行）の後で実行し、`real.check` の行（EV = Script API のイベント、ST = 状態、@A = クライアントの表示、js の値＝サーバー側で確かめた結果）が出て、失敗の言い回し（no … in view、could not、rejected など）と想定外の E 行が出なければ ✔。手書きの動作はすべて `real.check` を持つ。

- 手書きの動作: ✔ 957 / 実行 957（実機で確かめられない 0 は理由つきで —）/ 全 957
- 生成した動作（11399 個）の見本: ✔ 17 / 17（`node docs/verbs/run.mjs families`）

## hand

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `eat` | ✔ | `eat [item] [ticks]` | 食べる（持っている食べ物。指定もできる） | EV after.itemCompleteUse itemStack=minecraft:bread*16 source=A useDuration=0 |
| `drink` | ✔ | `drink [item] [ticks]` | 飲む | EV after.itemCompleteUse itemStack=minecraft:milk_bucket*1 source=A useDuration=0 |
| `bow` | ✔ | `bow [ticks]` | 弓を引いて放つ（20 tick で満タン） | EV after.itemReleaseUse itemStack=minecraft:bow*1 source=A useDuration=71979 |
| `crossbow` | ✔ | `crossbow [ticks]` | クロスボウに装填して撃つ | EV after.itemCompleteUse itemStack=minecraft:crossbow*1 source=A useDuration=0 |
| `trident` | ✔ | `trident [ticks]` | トライデントを投げる | EV after.itemReleaseUse itemStack=minecraft:trident*1 source=A useDuration=71988 |
| `throw` | ✔ | `throw <item>` | 投げる（雪玉・卵・エンダーパール・スプラッシュポーション・ウィンドチャージ…） | EV after.itemUse itemStack=minecraft:snowball*16 source=A |
| `pearl` | ✔ | `pearl` | エンダーパールを投げる | EV after.itemUse itemStack=minecraft:ender_pearl*16 source=A |
| `spyglass` | ✔ | `spyglass [ticks]` | 望遠鏡をのぞく | EV after.itemStartUse itemStack=minecraft:spyglass*1 source=A useDuration=72000 |
| `horn` | ✔ | `horn` | ヤギの角笛を吹く | EV after.itemUse itemStack=minecraft:goat_horn*1 source=A |
| `firework` | ✔ | `firework` | ロケット花火を使う（滑空中は加速） | EV after.itemUse itemStack=minecraft:firework_rocket*16 source=A |
| `map` | ✔ | `map` | 空の地図を使って地図を作る | EV after.itemUse itemStack=minecraft:empty_map*16 source=A |
| `shield` | ✔ | `shield [off]` | 盾を構える（オフハンドならしゃがむ）／off で下ろす | EV after.itemUse itemStack=minecraft:shield*1 source=A |
| `potion` | ✔ | `potion [ticks]` | ポーションを飲む | EV after.itemCompleteUse itemStack=minecraft:potion*1 source=A useDuration=0 |
| `splash` | ✔ | `splash` | スプラッシュポーションを投げる | EV after.itemUse itemStack=minecraft:splash_potion*1 source=A |
| `lingering` | ✔ | `lingering` | 残留ポーションを投げる | EV after.itemUse itemStack=minecraft:lingering_potion*1 source=A |
| `snowball` | ✔ | `snowball` | 雪玉を投げる | EV after.itemUse itemStack=minecraft:snowball*16 source=A |
| `egg` | ✔ | `egg` | 卵を投げる | EV after.itemUse itemStack=minecraft:egg*16 source=A |
| `wind_charge` | ✔ | `wind_charge` | ウィンドチャージを投げる | EV after.itemUse itemStack=minecraft:wind_charge*16 source=A |
| `xp_bottle` | ✔ | `xp_bottle` | エンチャントの瓶を投げる | EV after.itemUse itemStack=minecraft:experience_bottle*16 source=A |
| `fishing_rod` | ✔ | `fishing_rod` | 釣り竿を振る | EV after.itemUse itemStack=minecraft:fishing_rod*1 source=A |
| `read` | ✔ | `read` | 記入済みの本を開く | EV after.itemUse itemStack=minecraft:written_book*1 source=A |
| `compass_read` | ✔ | `compass_read` | コンパスを見る（使う） | EV after.itemUse itemStack=minecraft:compass*16 source=A |
| `totem` | ✔ | `totem` | 不死のトーテムを手に持って使う | EV after.itemUse itemStack=minecraft:totem_of_undying*1 source=A |
| `milk_drink` | ✔ | `milk_drink [ticks]` | 牛乳を飲む（以前は milk に隠れて呼べなかった） | EV after.itemCompleteUse itemStack=minecraft:milk_bucket*1 source=A useDuration=0 |
| `honey_drink` | ✔ | `honey_drink [ticks]` | ハチミツ入りの瓶を飲む | EV after.itemCompleteUse itemStack=minecraft:honey_bottle*16 source=A useDuration=0 |
| `steer` | ✔ | `steer` | ニンジン／歪んだキノコ付きの棒を使う（乗ったブタ・ストライダーを加速） | EV after.itemUse itemStack=minecraft:carrot_on_a_stick*1 source=A |
| `elytra_boost` | ✔ | `elytra_boost` | ロケット花火で滑空を加速 | EV after.itemUse itemStack=minecraft:firework_rocket*16 source=A |
| `goat_horn` | ✔ | `goat_horn` | ヤギの角笛を吹く | EV after.itemUse itemStack=minecraft:goat_horn*1 source=A |
| `bundle_open` | ✔ | `bundle_open` | バンドルを使う | EV after.itemUse itemStack=minecraft:bundle*1 source=A |
| `ominous` | ✔ | `ominous [ticks]` | 不吉な瓶を飲む | EV after.itemCompleteUse itemStack=minecraft:ominous_bottle*16 source=A useDuration=0 |
| `throw_blue_egg` | ✔ | `throw_blue_egg [n]` | 青い卵を投げる | EV after.itemUse itemStack=minecraft:blue_egg*16 source=A |
| `throw_brown_egg` | ✔ | `throw_brown_egg [n]` | 茶色い卵を投げる | EV after.itemUse itemStack=minecraft:brown_egg*16 source=A |
| `throw_eye` | ✔ | `throw_eye [n]` | エンダーアイを投げて要塞の方角を見る | EV after.itemUse itemStack=minecraft:ender_eye*16 source=A |
| `snowball_spam` | ✔ | `snowball_spam [n]` | 雪玉を連投する | EV after.itemUse itemStack=minecraft:snowball*16 source=A |
| `xp_bottles` | ✔ | `xp_bottles [n]` | エンチャントの瓶を足元に投げる（修繕） | EV after.itemUse itemStack=minecraft:experience_bottle*16 source=A |
| `splash_self` | ✔ | `splash_self` | スプラッシュポーションを自分の足元に | EV after.itemUse itemStack=minecraft:splash_potion*1 source=A |
| `cast` | ✔ | `cast` | 釣り竿を投げる（浮きを出す） | EV after.itemUse itemStack=minecraft:fishing_rod*1 source=A |
| `reel` | ✔ | `reel` | 釣り竿を巻き上げる | EV after.itemUse itemStack=minecraft:fishing_rod*1 source=A |
| `crossbow_load` | ✔ | `crossbow_load [ticks]` | クロスボウに装填だけする | EV after.itemCompleteUse itemStack=minecraft:crossbow*1 source=A useDuration=0 |
| `crossbow_fire` | ✔ | `crossbow_fire` | 装填したクロスボウを撃つ | EV after.itemUse itemStack=minecraft:crossbow*1 source=A |
| `crossbow_firework` | ✔ | `crossbow_firework` | ロケット花火をオフハンドにしてクロスボウで撃つ | EV after.itemCompleteUse itemStack=minecraft:crossbow*1 source=A useDuration=0 |
| `spawn_mob` | ✔ | `spawn_mob <mob> x y z` | スポーンエッグで地面にその生き物を出す | EV after.entitySpawn cause=Spawned entity=minecraft:cow |

## block

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `till` | ✔ | `till x y z` | クワで耕す |  |
| `flatten` | ✔ | `flatten x y z` | シャベルで土の道にする |  |
| `strip` | ✔ | `strip x y z` | 斧で原木の樹皮を剥ぐ |  |
| `scrape` | ✔ | `scrape x y z` | 斧で銅の錆を落とす |  |
| `wax` | ✔ | `wax x y z` | 銅にハニカムで蝋を塗る |  |
| `bonemeal` | ✔ | `bonemeal x y z` | 骨粉をまく | EV after.itemStartUseOn block=minecraft:oak_sapling@1,-60,1 blockFace=Up itemStack=minecraft:bone_meal*16 source=A |
| `light` | ✔ | `light x y z` | 火打石と打ち金で火を付ける（そのブロックの上） |  |
| `scoop` | ✔ | `scoop x y z` | 空のバケツで水・溶岩を汲む | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:water_bucket*1 player=A slot=1 |
| `charge` | ✔ | `charge x y z` | リスポーンアンカーにグロウストーンを込める |  |
| `plant` | ✔ | `plant <seed> x y z` | 種を植える（x y z は耕地） |  |
| `pour` | ✔ | `pour <bucket> x y z` | 水・溶岩・粉雪をバケツから撒く（そのブロックの上） |  |
| `disc` | ✔ | `disc <disc> x y z` | ジュークボックスにレコードを入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:music_disc_cat*1 block=minecraft:jukebox@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=tru |
| `pot` | ✔ | `pot <item> x y z` | 植木鉢・飾り壺・本棚などに入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:poppy*16 block=minecraft:flower_pot@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true ite |
| `compost` | ✔ | `compost x y z [item]` | コンポスターに入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:wheat_seeds*16 block=minecraft:composter@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=tru |
| `brush` | ✔ | `brush x y z [ticks]` | ブラシで怪しげな砂・砂利を掃く | EV after.itemStartUseOn block=minecraft:suspicious_sand@1,-60,1 blockFace=Up itemStack=minecraft:brush*1 source=A |
| `toggle` | ✔ | `toggle x y z` | ドア・レバー・ボタン・トラップドアなどを操作 | EV after.leverAction block=minecraft:lever@1,-60,1 dimension=overworld isPowered=true player=A |
| `tune` | ✔ | `tune x y z` | 音符ブロックの音程を上げる | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:noteblock@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `bell` | ✔ | `bell x y z` | 鐘を鳴らす | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:bell@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `cake` | ✔ | `cake x y z` | ケーキを一切れ食べる |  |
| `play` | ✔ | `play x y z` | 音符ブロックを叩いて鳴らす | EV after.entityHitBlock blockFace=Up damagingEntity=A hitBlock=minecraft:noteblock@1,-60,1 hitBlockPermutation=minecraft:noteblock |
| `harvest` | ✔ | `harvest x y z` | 作物などを壊して収穫 | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:wheat dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pl |
| `fill_bottle` | ✔ | `fill_bottle x y z` | ガラス瓶に水を汲む | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:potion*1 player=A slot=1 |
| `honey` | ✔ | `honey x y z` | ハチの巣からガラス瓶でハチミツを取る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:honey_bottle*1 player=A slot=1 |
| `honeycomb` | ✔ | `honeycomb x y z` | ハチの巣からハサミでハニカムを取る |  |
| `carve` | ✔ | `carve x y z` | ハサミでカボチャをくり抜く |  |
| `cocoa` | ✔ | `cocoa x y z` | ジャングルの原木にカカオ豆を植える（上の面） | EV after.playerPlaceBlock block=minecraft:cocoa@1,-60,0 dimension=overworld player=A |
| `torch` | ✔ | `torch x y z` | 松明を置く（そのブロックの上） |  |
| `lantern` | ✔ | `lantern x y z` | ランタンを置く（そのブロックの上） |  |
| `end_eye` | ✔ | `end_eye x y z` | エンドポータルフレームにエンダーアイをはめる |  |
| `lodestone` | ✔ | `lodestone x y z` | コンパスをロードストーンに結び付ける | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:lodestone_compass*1 player=A slot=1 |
| `campfire_out` | ✔ | `campfire_out x y z` | シャベルで焚き火を消す |  |
| `tnt` | ✔ | `tnt x y z` | TNT に火を付ける | EV after.entitySpawn cause=Spawned entity=minecraft:tnt |
| `portal_light` | ✔ | `portal_light x y z` | ネザーポータルの枠の中に着火 |  |
| `candle` | ✔ | `candle x y z` | ろうそくに火を付ける |  |
| `glow_sign` | ✔ | `glow_sign x y z` | 看板の文字を輝くイカスミで光らせる | EV after.playerInteractWithBlock beforeItemStack=minecraft:glow_ink_sac*16 block=minecraft:standing_sign@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEven |
| `wax_sign` | ✔ | `wax_sign x y z` | 看板に蝋を塗って編集できなくする | EV after.playerInteractWithBlock beforeItemStack=minecraft:honeycomb*16 block=minecraft:standing_sign@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=t |
| `minecart` | ✔ | `minecart x y z` | レールの上にトロッコを置く | EV after.entitySpawn cause=Spawned entity=minecraft:minecart |
| `boat` | ✔ | `boat x y z` | ボートを置く（そのブロックの上） | EV after.entitySpawn cause=Spawned entity=minecraft:boat |
| `armor_stand` | ✔ | `armor_stand x y z` | 防具立てを置く（そのブロックの上） | EV after.entitySpawn cause=Spawned entity=minecraft:armor_stand |
| `rail` | ✔ | `rail x y z` | レールを敷く（そのブロックの上） |  |
| `ladder` | ✔ | `ladder x y z` | はしごを掛ける（そのブロックの上面／既定） | EV after.playerPlaceBlock block=minecraft:ladder@1,-60,1 dimension=overworld player=A |
| `painting` | ✔ | `painting x y z` | 絵画を掛ける | EV after.entitySpawn cause=Spawned entity=minecraft:painting |
| `item_frame` | ✔ | `item_frame x y z` | 額縁を掛ける | EV after.playerPlaceBlock block=minecraft:frame@1,-59,2 dimension=overworld player=A |
| `lily_pad` | ✔ | `lily_pad x y z` | スイレンの葉を水に浮かべる |  |
| `spawner` | ✔ | `spawner x y z` | スポナーにスポーンエッグを使う | EV after.playerInteractWithBlock beforeItemStack=minecraft:cow_spawn_egg*16 block=minecraft:mob_spawner@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent |
| `water` | ✔ | `water x y z` | 水を撒く（そのブロックの上） |  |
| `lava` | ✔ | `lava x y z` | 溶岩を撒く（そのブロックの上） |  |
| `snow` | ✔ | `snow x y z` | 粉雪を撒く |  |
| `path` | ✔ | `path x y z` | シャベルで土の道を作る |  |
| `farmland` | ✔ | `farmland x y z` | クワで耕地を作る |  |

## build

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `place` | ✔ | `place <item> x y z` | そこに置く（下のブロックの上面をクリック） | EV after.playerPlaceBlock block=minecraft:dirt@4,-60,4 dimension=overworld player=A |
| `mine` | ✔ | `mine x1 y1 z1 x2 y2 z2` | 範囲の中を全部掘る（上の段から） | @A mined 3 |
| `pillar` | ✔ | `pillar [n] [item]` | 真下を見て跳び、足元に積んで登る |  |
| `bridge` | ✔ | `bridge [n] [item]` | しゃがんで縁から前にブロックを継ぎ足して橋を架ける |  |
| `dig_down` | ✔ | `dig_down [n]` | 真下を掘る |  |
| `tunnel` | ✔ | `tunnel [n]` | 高さ 2 のトンネルを前に掘り進む |  |
| `fill` | ✔ | `fill <item> x1 y1 z1 x2 y2 z2` | 範囲の空いた所を埋める（下の段から） |  |
| `hang` | ✔ | `hang <item> x y z <face>` | ブロックの面に掛ける（壁の松明・はしご・額縁…） |  |
| `floor` | ✔ | `floor <item> x1 z1 x2 z2 y` | 床を敷く |  |
| `wall` | ✔ | `wall <item> x1 z1 x2 z2 y [h]` | 壁を建てる |  |
| `line` | ✔ | `line <item> x1 z1 x2 z2 y` | 柵を一列に |  |
| `sneak_place` | ✔ | `sneak_place <item> x y z [face]` | しゃがんでチェストの上に置く |  |
| `light_up` | ✔ | `light_up x1 z1 x2 z2 y [step]` | 松明を等間隔に |  |
| `stair_down` | ✔ | `stair_down [n]` | 階段状に掘り下がる |  |
| `stair_up` | ✔ | `stair_up [n]` | 階段状に掘り上がる |  |
| `strip_mine` | ✔ | `strip_mine [n]` | 松明を置きながら一直線に掘る |  |
| `box` | ✔ | `box <item> x1 y1 z1 x2 y2 z2` | 中が空の箱を建てる |  |
| `room` | ✔ | `room <item> x1 z1 x2 z2 y [h]` | 入口つきの部屋（壁と屋根） |  |
| `hut` | ✔ | `hut <item> [x z]` | 5x5 の小屋（入口と屋根）を建てる |  |
| `bunker` | ✔ | `bunker [item]` | 立っている所を壁と天井で囲う（緊急避難） |  |
| `roof` | ✔ | `roof <item> x1 z1 x2 z2 y` | 平らな屋根を張る |  |
| `tower` | ✔ | `tower <item> x z [h]` | 3x3 の中空の塔 |  |
| `column` | ✔ | `column <item> x y z [h]` | 柱を立てる |  |
| `disk` | ✔ | `disk <item> x z r y` | 円い床 |  |
| `ring` | ✔ | `ring <item> x z r y` | 円い輪（円周だけ） |  |
| `pyramid` | ✔ | `pyramid <item> x z base y` | ピラミッド |  |
| `stairs_line` | ✔ | `stairs_line <stairs> x y z <dir> [n] [support]` | 支えのブロックを入れながら上り階段を並べる |  |
| `fence_pen` | ✔ | `fence_pen <fence> x1 z1 x2 z2 y` | 柵で囲ってゲートを付ける |  |
| `make_path` | ✔ | `make_path x1 z1 x2 z2 y` | シャベルで土の道を作る |  |
| `checker` | ✔ | `checker <item1> <item2> x1 z1 x2 z2 y` | 市松模様の床 |  |
| `replace` | ✔ | `replace <from> <to> x1 y1 z1 x2 y2 z2` | 範囲のそのブロックを別のに置き換える |  |
| `replace_block` | ✔ | `replace_block <item> x y z` | そのブロックを掘って別のに置き換える |  |
| `level` | ✔ | `level x1 z1 x2 z2 y [fill item]` | 高さ y に平らにならす（出っ張りを削り、穴を埋める） |  |
| `dig_pit` | ✔ | `dig_pit x1 z1 x2 z2 depth [top y]` | 穴を掘る |  |
| `pool` | ✔ | `pool x1 z1 x2 z2 depth` | 穴を掘って水を張る |  |
| `nether_portal` | ✔ | `nether_portal x y z [x|z]` | 黒曜石でネザーポータルを組んで点火する |  |
| `end_portal_fill` | ✔ | `end_portal_fill [radius]` | 近くのエンドポータルフレームに全部エンダーアイをはめる | @A end_portal_fill: 2 eyes |
| `beacon_base` | ✔ | `beacon_base <block> x y z` | 3x3 の土台を作ってビーコンを載せる |  |
| `build_snow_golem` | ✔ | `build_snow_golem x y z` | 雪ブロック 2 つとくり抜いたカボチャでスノーゴーレムを作る | EV after.entitySpawn cause=Spawned entity=minecraft:snow_golem |
| `build_iron_golem` | ✔ | `build_iron_golem x y z [x|z]` | 鉄ブロックの T 字とくり抜いたカボチャでアイアンゴーレムを作る | EV after.entitySpawn cause=Event entity=minecraft:iron_golem |
| `build_copper_golem` | ✔ | `build_copper_golem x y z` | 銅ブロックとくり抜いたカボチャで銅のゴーレムを作る | EV after.entitySpawn cause=Event entity=minecraft:copper_golem |
| `build_wither` | ✔ | `build_wither x y z [x|z]` | ソウルサンドの T 字にウィザースケルトンの頭蓋骨を 3 つ（ウィザー召喚） | EV after.entitySpawn cause=Spawned entity=minecraft:wither |
| `farm_plot` | ✔ | `farm_plot x z y [r]` | 真ん中に水を入れて周りを耕す |  |
| `lamp_post` | ✔ | `lamp_post x y z` | 柵の柱にランタンを載せた街灯 |  |
| `scaffold_tower` | ✔ | `scaffold_tower x y z [h]` | 足場を積み上げる |  |
| `ladder_column` | ✔ | `ladder_column x y z <wall side> [h]` | 壁にはしごを縦に掛ける |  |
| `speed_bridge` | ✔ | `speed_bridge [n] [item]` | しゃがまずに歩きながら足元の前に継ぎ足す速い橋（Bedrock の fast bridging・Hypixel のスピードブリッジ） |  |
| `bridge_to` | ✔ | `bridge_to x z [item]` | その点まで橋を架ける |  |
| `rail_line` | ✔ | `rail_line x1 z1 x2 z2 y` | レールを一直線に敷く（8 本ごとにパワードレール） |  |
| `redstone_line` | ✔ | `redstone_line x1 z1 x2 z2 y` | レッドストーンを一直線に（15 ごとにリピーター） |  |

## move

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `climb` | ✔ | `climb [ticks]` | はしご・つたを登る（前＋ジャンプ） |  |
| `sprintjump` | ✔ | `sprintjump [n]` | 走りながら跳ぶ（ダッシュジャンプ） |  |
| `portal` | ✔ | `portal x y z` | ポータルに入って次元を移る | @A dimension nether |
| `swim_up` | ✔ | `swim_up [ticks]` | 泳いで上がる（ジャンプ） | EV after.playerButtonInput button=Jump newButtonState=Pressed player=A |
| `dive` | ✔ | `dive [ticks]` | 潜る（しゃがむ） | EV after.entityStartSneaking entity=A |
| `descend` | ✔ | `descend [ticks]` | 降りる（しゃがむ） | EV after.entityStartSneaking entity=A |
| `crouch_walk` | ✔ | `crouch_walk [ticks]` | しゃがんで歩く |  |
| `backpedal` | ✔ | `backpedal [ticks]` | 後ずさりする |  |
| `strafe_left` | ✔ | `strafe_left [ticks]` | 左に横歩き |  |
| `strafe_right` | ✔ | `strafe_right [ticks]` | 右に横歩き |  |
| `jump_over` | ✔ | `jump_over [ticks]` | 前に進みながら跳ぶ |  |
| `run` | ✔ | `run [ticks]` | 走る |  |
| `wander` | ✔ | `wander [n]` | ぶらぶら歩く |  |
| `look_around` | ✔ | `look_around` | ぐるりと見回す |  |
| `turn_around` | ✔ | `turn_around` | 振り返る |  |
| `face` | ✔ | `face north|south|east|west|up|down` | 方角を向く |  |
| `sprint_to` | ✔ | `sprint_to x z` | 走って行く |  |
| `swim_to` | ✔ | `swim_to x z` | 泳いで行く |  |
| `mark` | ✔ | `mark [name]` | 今の場所を覚える | @A mark home 0.5 -60.0 0.5 |
| `goback` | ✔ | `goback [name]` | 覚えた場所へ戻る |  |
| `row` | ✔ | `row [ticks]` | ボートを漕ぐ |  |
| `ride_to` | ✔ | `ride_to <mount> x z` | 乗って移動して降りる | @A riding minecraft:boat |
| `elytra_fly` | ✔ | `elytra_fly [boosts]` | エリトラで飛ぶ |  |
| `riptide` | ✔ | `riptide [ticks]` | 激流で飛ぶ | EV after.itemReleaseUse itemStack=minecraft:trident*1 source=A useDuration=71988 |
| `peek` | ✔ | `peek [ticks]` | 崖の縁から下を覗く | EV after.entityStartSneaking entity=A |
| `afk` | ✔ | `afk [n]` | 放置（少しだけ動く） |  |
| `walk_blocks` | ✔ | `walk_blocks <n> [forward|back|left|right]` | n ブロック歩く |  |
| `jump_n` | ✔ | `jump_n [n]` | その場で n 回跳ぶ | EV after.playerButtonInput button=Jump newButtonState=Pressed player=A |
| `sneak_jump` | ✔ | `sneak_jump` | しゃがんだまま跳ぶ | EV after.entityStartSneaking entity=A |
| `long_jump` | ✔ | `long_jump x z [runup]` | 助走して幅跳び |  |
| `drop_down` | ✔ | `drop_down [ticks]` | 縁から前へ降りる |  |
| `circle` | ✔ | `circle [r] [laps]` | 円を描いて歩く |  |
| `square` | ✔ | `square [side] [laps]` | 四角く歩いて戻る |  |
| `zigzag` | ✔ | `zigzag [n] [w]` | ジグザグに歩く |  |
| `patrol` | ✔ | `patrol x1 z1 x2 z2 [n]` | 2 点の間を行き来する |  |
| `spin` | ✔ | `spin [turns]` | その場で回る |  |
| `look_left` | ✔ | `look_left` | 左を向く |  |
| `look_right` | ✔ | `look_right` | 右を向く |  |
| `look_at` | ✔ | `look_at <mob|player>` | その相手の顔を見る |  |
| `track` | ✔ | `track <mob> [ticks]` | 動く相手を目で追う |  |
| `aim_at` | ✔ | `aim_at x y z [ticks]` | その点に照準を合わせる（なめらかに） |  |
| `climb_down` | ✔ | `climb_down [ticks]` | はしごを滑り降りる |  |
| `surface` | ✔ | `surface [ticks]` | 水面まで泳いで上がる |  |
| `fly_up` | ✔ | `fly_up [ticks]` | （クリエイティブで飛行中）上昇 |  |
| `fly_down` | ✔ | `fly_down [ticks]` | （飛行中）下降 |  |
| `fly_forward` | ✔ | `fly_forward [ticks]` | （飛行中）前へ速く飛ぶ |  |
| `fly_to` | ✔ | `fly_to x y z [ticks]` | （クリエイティブ）その点まで飛んで行く |  |
| `glide_to` | ✔ | `glide_to x z [ticks]` | エリトラで滑空しながらその方へ舵を取る |  |
| `elytra_takeoff` | ✔ | `elytra_takeoff` | 跳んで羽を開き、ロケット花火で飛び立つ |  |
| `row_left` | ✔ | `row_left [ticks]` | ボートを左へ曲げる |  |
| `row_right` | ✔ | `row_right [ticks]` | ボートを右へ曲げる |  |
| `row_back` | ✔ | `row_back [ticks]` | ボートを後ろへ漕ぐ |  |
| `sail_to` | ✔ | `sail_to x z [ticks]` | ボートで舵を取りながらその方へ漕ぐ |  |
| `minecart_go` | ✔ | `minecart_go [ticks]` | トロッコで前へ（押す） |  |
| `horse_gallop` | ✔ | `horse_gallop [ticks]` | 馬を走らせる |  |
| `camel_dash` | ✔ | `camel_dash [ticks]` | ラクダでダッシュ（ジャンプを溜めて離す） |  |
| `ghast_up` | ✔ | `ghast_up [ticks]` | ハッピーガストで上昇 |  |
| `crawl_through` | ✔ | `crawl_through x z` | 這って低い隙間をくぐる |  |
| `scaffold_up` | ✔ | `scaffold_up [ticks]` | 足場の中で上へ登る |  |
| `scaffold_down` | ✔ | `scaffold_down [ticks]` | 足場の中で下へ降りる |  |
| `sneak_to` | ✔ | `sneak_to x z` | しゃがんで忍び足で行く（音を立てない） |  |
| `dig_to_y` | ✔ | `dig_to_y <y>` | 階段状に掘ってその高さまで下りる | @A dig_to_y: at y -61.0 |
| `pillar_to` | ✔ | `pillar_to <y> [item]` | 足元に積んでその高さまで上る | @A pillar_to: at y -58.0 |
| `explore` | ✔ | `explore [blocks]` | 好きな方へ遠くまで歩く（goback explore で戻る） | @A explore: went 4 blocks (goback explore returns) |
| `goto_block` | ✔ | `goto_block <block> [radius]` | 知っている一番近いそのブロックの前まで行く | @A goto_block: crafting_table at 4 -60 4 |
| `return_spawn` | ✔ | `return_spawn` | 初期スポーン地点へ歩いて戻る | @A return_spawn: -2147483648 -2147483648 -2147483648 |
| `goto_death` | ✔ | `goto_death` | 最後に死んだ場所へ戻る | @A goto_death: 1 -60 1 |
| `respawn_return` | ✔ | `respawn_return` | リスポーンして死んだ場所へ戻る | @A goto_death: 1 -60 1 |
| `pearl_to` | ✔ | `pearl_to x y z` | その場所に落ちるようにエンダーパールを投げる | EV after.itemUse itemStack=minecraft:ender_pearl*16 source=A |
| `wind_jump` | ✔ | `wind_jump` | 足元にウィンドチャージを投げて跳ぶ | EV after.itemUse itemStack=minecraft:wind_charge*16 source=A |
| `wait_world` | ✔ | `wait_world [radius] [seconds]` | 周りの地面（半径のブロックの 95%）が読み込まれるまで待つ（テレポートや遠くへ出た直後、生成中の土地を待つ） | @A wait_world: 100% of the ground within 8 known after 0.0 s |

## mob

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `feed` | ✔ | `feed <mob> [item]` | 餌をやる（右クリック） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:cow |
| `breed` | ✔ | `breed <mob> [food]` | 近くの 2 頭に餌をやって繁殖させる | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:cow |
| `tame` | ✔ | `tame <mob> [item] [tries]` | 手なずける（餌を繰り返し与える） | EV after.entityTamed entity=minecraft:wolf tamingEntity=A |
| `shear` | ✔ | `shear <mob>` | ハサミで毛を刈る | EV after.playerInteractWithEntity beforeItemStack=minecraft:shears*1 itemStack=minecraft:shears*1 player=A target=minecraft:sheep |
| `milk` | ✔ | `milk <mob>` | ウシ・ヤギの乳をバケツで搾る | EV after.playerInteractWithEntity beforeItemStack=minecraft:bucket*16 itemStack=minecraft:bucket*15 player=A target=minecraft:cow |
| `saddle` | ✔ | `saddle <mob>` | 鞍を付ける | EV after.playerInteractWithEntity beforeItemStack=minecraft:saddle*1 itemStack=- player=A target=minecraft:pig |
| `leash` | ✔ | `leash <mob>` | リードを付ける | EV after.playerInteractWithEntity beforeItemStack=minecraft:lead*16 itemStack=minecraft:lead*15 player=A target=minecraft:cow |
| `nametag` | ✔ | `nametag <mob>` | 名札を使う（名前を付けた名札） | EV after.playerUseNameTag entityNamed=minecraft:cow newName=Bessie player=A previousName=- |
| `unleash` | ✔ | `unleash <mob>` | リードを外す（素手で右クリック） | EV after.playerInteractWithEntity beforeItemStack=minecraft:lead*16 itemStack=minecraft:lead*15 player=A target=minecraft:cow |
| `dye` | ✔ | `dye <mob> <dye>` | ヒツジ・首輪を染める | EV after.playerInteractWithEntity beforeItemStack=minecraft:red_dye*16 itemStack=minecraft:red_dye*15 player=A target=minecraft:sheep |
| `pose` | ✔ | `pose [armor_stand]` | 防具立てのポーズを変える（しゃがんで右クリック） | EV after.playerInteractWithEntity beforeItemStack=- itemStack=- player=A target=minecraft:armor_stand |
| `hjump` | ✔ | `hjump [ticks]` | 馬に乗ったままジャンプ（長く押すほど高い） | EV after.playerButtonInput button=Jump newButtonState=Pressed player=A |
| `follow` | ✔ | `follow <mob|player> [ticks]` | ついて行く |  |
| `bucket_fish` | ✔ | `bucket_fish <mob>` | 水入りバケツで魚・ウーパールーパー・オタマジャクシをすくう | EV before.playerInteractWithEntity itemStack=minecraft:water_bucket*1 player=A target=minecraft:cod |
| `bowl` | ✔ | `bowl <mob>` | ムーシュルームからボウルでキノコシチューを取る | EV after.playerInteractWithEntity beforeItemStack=minecraft:bowl*16 itemStack=minecraft:bowl*15 player=A target=minecraft:mooshroom |
| `stew` | ✔ | `stew <mob>` | ムーシュルームに花を食べさせる | EV before.playerInteractWithEntity itemStack=minecraft:poppy*16 player=A target=minecraft:mooshroom |
| `armor` | ✔ | `armor <mob>` | 馬鎧・オオカミの鎧・カーペットを着せる | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_horse_armor*1 itemStack=- player=A target=minecraft:horse |
| `chest_on` | ✔ | `chest_on <mob>` | ロバ・ラバ・ラマにチェストを付ける | EV after.playerInteractWithEntity beforeItemStack=minecraft:chest*16 itemStack=minecraft:chest*15 player=A target=minecraft:donkey |
| `brush_mob` | ✔ | `brush_mob <mob>` | アルマジロをブラシで掃いて甲羅を取る | EV after.playerInteractWithEntity beforeItemStack=minecraft:brush*1 itemStack=minecraft:brush*1 player=A target=minecraft:armadillo |
| `allay_give` | ✔ | `allay_give <mob> [item]` | アレイに物を渡す | EV after.playerInteractWithEntity beforeItemStack=minecraft:dirt*64 itemStack=minecraft:dirt*63 player=A target=minecraft:allay |
| `repair` | ✔ | `repair <mob>` | アイアンゴーレムを鉄インゴットで直す | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_ingot*16 itemStack=minecraft:iron_ingot*15 player=A target=minecraft:iron_golem |
| `ignite` | ✔ | `ignite <mob>` | クリーパーに火打石で着火 | EV after.playerInteractWithEntity beforeItemStack=minecraft:flint_and_steel*1 itemStack=minecraft:flint_and_steel*1 player=A target=minecraft:creeper |
| `cure` | ✔ | `cure <mob>` | 弱体化した村人ゾンビに金のリンゴ | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_apple*16 itemStack=minecraft:golden_apple*15 player=A target=minecraft:zombie_villager_v2 |
| `wolf_bone` | ✔ | `wolf_bone <mob>` | オオカミに骨をやる | EV after.playerInteractWithEntity beforeItemStack=minecraft:bone*16 itemStack=minecraft:bone*15 player=A target=minecraft:wolf |
| `cat_fish` | ✔ | `cat_fish <mob>` | ネコ・ヤマネコに生魚をやる | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:cat |
| `parrot_seed` | ✔ | `parrot_seed <mob>` | オウムに種をやる | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat_seeds*16 itemStack=minecraft:wheat_seeds*15 player=A target=minecraft:parrot |
| `horse_food` | ✔ | `horse_food <mob>` | 馬に餌（金のニンジンなど） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:horse |
| `sit` | ✔ | `sit <mob> [item]` | 手なずけた動物を座らせる／立たせる | EV after.playerInteractWithEntity beforeItemStack=- itemStack=- player=A target=minecraft:wolf |
| `pet` | ✔ | `pet <mob> [item]` | 右クリックする（なでる・話しかける） | EV before.playerInteractWithEntity itemStack=minecraft:dirt*64 player=A target=minecraft:cow |
| `mount_chest` | ✔ | `mount_chest <mob> [item]` | 乗り物にチェストを付ける | EV after.playerInteractWithEntity beforeItemStack=minecraft:chest*16 itemStack=minecraft:chest*15 player=A target=minecraft:llama |
| `spawn_baby` | ✔ | `spawn_baby <mob>` | 大人にスポーンエッグを使って子供を出す | EV after.entitySpawn cause=Spawned entity=minecraft:cow |
| `barter` | ✔ | `barter` | ピグリンの近くに金インゴットを投げる | EV after.entityItemDrop entity=A items=[item:minecraft:gold_ingot*1] |
| `cure_villager` | ✔ | `cure_villager [mob]` | 村人ゾンビに弱体化のスプラッシュを投げて金のリンゴ | EV after.itemUse itemStack=minecraft:splash_potion*1 source=A |
| `mountinv` | ✔ | `mountinv` | 乗っている動物の持ち物を開く | @A container horse: the mount's inventory (0 slots) |

## inv

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `select` | ✔ | `select <item>` | 持ち替える（ホットバーの数字キー、無ければ持ち物から引き出す） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bow*1 player=A slot=0 |
| `equip` | ✔ | `equip <slot|item>` | 防具を着る（持ち物から防具欄へ） | @A inv empty (holding slot 0) worn head:minecraft:iron_helmet*1 |
| `unequip` | ✔ | `unequip <head|chest|legs|feet|offhand>` | 防具・オフハンドを外して持ち物へ |  |
| `offhand` | ✔ | `offhand <slot|item>` | オフハンドに持つ | @A inv empty (holding slot 0) worn offhand:minecraft:shield*1 |
| `drop_all` | ✔ | `drop_all [slot]` | スタックごと捨てる | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*64] |
| `unload` | ✔ | `unload x y z` | 道具以外をチェストにしまう | @A unload: 1 stacks |
| `loot` | ✔ | `loot x y z` | チェストの中身を全部取る | @A container container: 3:minecraft:diamond*2 |
| `sort` | ✔ | `sort` | 持ち物を名前順に並べる | @A sort: 1 swaps |
| `discard` | ✔ | `discard <item>` | 要らない物を捨てる | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*64] |
| `drop_item` | ✔ | `drop_item <item> [n]` | その品を n 個捨てる | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*2] |
| `drop_everything` | ✔ | `drop_everything` | 持ち物を全部（防具も）捨てる | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*64] |
| `keep_only` | ✔ | `keep_only <item,item,...>` | それ以外を全部捨てる | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*64] |
| `stack_up` | ✔ | `stack_up` | 同じ品の半端なスタックをまとめる | @A stack_up: 1 merges |
| `hotbar_setup` | ✔ | `hotbar_setup <item,item,...>` | その品をホットバーの 0,1,2… 番に並べる |  |
| `hotbar_tidy` | ✔ | `hotbar_tidy` | いつもの並び（剣・ツルハシ・斧・シャベル・弓・ブロック・水・食料・松明） |  |
| `fill_hotbar` | ✔ | `fill_hotbar <item>` | その品を空いたホットバーに全部出す | @A fill_hotbar: 1 stacks |
| `restock_hand` | ✔ | `restock_hand [min]` | 手の束が減ったら同じ品を持ち物から足す | @A restock_hand: topped up |
| `swap_hands` | ✔ | `swap_hands` | 手の物とオフハンドを入れ替える | @A inv empty (holding slot 0) worn offhand:minecraft:shield*1 |
| `swap_elytra` | ✔ | `swap_elytra` | エリトラとチェストプレートを着替える | @A inv 9:minecraft:iron_chestplate*1 (holding slot 0) worn chest:minecraft:elytra*1 |
| `wear_gold` | ✔ | `wear_gold` | 金の防具を全部着る（ピグリン対策） | @A inv empty (holding slot 0) worn head:minecraft:golden_helmet*1 feet:minecraft:golden_boots*1 |
| `armor_off` | ✔ | `armor_off` | 防具を全部脱ぐ |  |
| `best_weapon` | ✔ | `best_weapon` | 一番強い武器を持つ | @A best_weapon: diamond_sword |
| `tool_for` | ✔ | `tool_for x y z` | そのブロックに合う道具を持つ | @A tool_for: stone: iron_pickaxe |
| `put_all` | ✔ | `put_all x y z` | 持ち物を全部チェストに入れる | @A put_all: 2 stacks |
| `load_furnace` | ✔ | `load_furnace x y z <item> [fuel]` | かまどに入れて燃料を足すだけ（待たない） |  |
| `bundle_fill` | ✔ | `bundle_fill <item> [n]` | バンドルにその品を入れる |  |
| `bundle_empty` | ✔ | `bundle_empty` | バンドルの中身を全部出す |  |
| `wear_quick` | ✔ | `wear_quick [item]` | 手に持った防具を右クリックで着る | @A inv empty (holding slot 0) worn chest:minecraft:iron_chestplate*1 |
| `creative_hotbar` | ✔ | `creative_hotbar <item,item,...> [n]` | （クリエイティブ）その品をクリエイティブ画面から取る | @A creative minecraft:stone*1 |
| `creative_place` | ✔ | `creative_place <item> x y z` | （クリエイティブ）取ってその場に置く |  |

## errand

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `smelt` | ✔ | `smelt <item> x y z [fuel] [n]` | かまどで製錬して取り出す | @A container furnace: 0:minecraft:raw_iron*1 2:minecraft:iron_ingot*1 |
| `collect` | ✔ | `collect [n]` | 落ちている物の上を歩いて拾う | EV after.entitySpawn cause=Spawned entity=item:minecraft:stick*2 |
| `store` | ✔ | `store <item> x y z` | チェストを開けてその品をしまう |  |
| `retrieve` | ✔ | `retrieve <item> x y z` | チェストを開けてその品を取り出す | @A container container: 0:minecraft:dirt*5 |
| `brew` | ✔ | `brew <ingredient> x y z [ticks]` | 醸造台で 1 回醸造する | EV after.blockContainerOpened block=minecraft:brewing_stand@1,-60,1 dimension=overworld openSource={entity=A} |
| `chop` | ✔ | `chop x y z` | 木の幹を下から切る | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:oak_log dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=-  |
| `farm` | ✔ | `farm <seed> x1 z1 x2 z2 y` | 範囲を耕して種を植える |  |
| `craft_at` | ✔ | `craft_at x y z <item> [n]` | 作業台で作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:oak_planks*4 player=A slot=0 |
| `cook` | ✔ | `cook <item> x y z [fuel] [n]` | 燻製器で焼く | @A container smoker: 0:minecraft:beef*1 2:minecraft:cooked_beef*1 |
| `blast` | ✔ | `blast <item> x y z [fuel] [n]` | 溶鉱炉で精錬 | @A container blast_furnace: 0:minecraft:raw_iron*1 2:minecraft:iron_ingot*1 |
| `refuel` | ✔ | `refuel x y z [fuel]` | かまどに燃料を足す |  |
| `take_output` | ✔ | `take_output x y z` | かまどの出来上がりを取る | @A container furnace: 2:minecraft:iron_ingot*3 |

## social

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `tell` | ✔ | `tell <player> <text>` | ささやく（/tell） | @A cmd: %commands.message.display.outgoing [A, hi] |
| `me` | ✔ | `me <text>` | 動作を書く（/me） | @A chat <> * A waves |
| `wave` | ✔ | `wave [emote id]` | 手を振る（エモート） | EV after.playerEmote personaPieceId=4c8ae710-df2e-47cd-814d-cc7bf21a3d67 player=A |
| `give_to` | ✔ | `give_to <who> <item> [n]` | 相手の前に投げて渡す | EV after.entityItemDrop entity=A items=[item:minecraft:dirt*1] |
| `look_player` | ✔ | `look_player [who]` | 相手の顔を見る |  |
| `greet` | ✔ | `greet [who] [text]` | 顔を見て挨拶して手を振る | EV after.chatSend message=hi sender=A targets=- |
| `nod` | ✔ | `nod [n]` | しゃがんで頷く | EV after.entityStartSneaking entity=A |
| `trade_with` | ✔ | `trade_with [villager] [index]` | 村人と取引する | EV after.playerInteractWithEntity beforeItemStack=- itemStack=- player=A target=minecraft:villager_v2 |
| `report` | ✔ | `report` | 体力・視線の先・周り（AI の状況確認） | @A hp 20 food 20 pos 0.5 -60.0 0.5 yaw 0 pitch 0 |
| `bow_head` | ✔ | `bow_head` | お辞儀する（下を向いて戻す） |  |
| `shake_head` | ✔ | `shake_head [n]` | 首を横に振る（いいえ） |  |
| `crouch_spam` | ✔ | `crouch_spam [n]` | しゃがみ連打（挨拶） | EV after.entityStartSneaking entity=A |
| `celebrate` | ✔ | `celebrate` | 跳んで腕を振って喜ぶ | EV after.playerEmote personaPieceId=4c8ae710-df2e-47cd-814d-cc7bf21a3d67 player=A |
| `dance` | ✔ | `dance [n]` | 踊る（回ってしゃがんで跳ぶ） | EV after.entityStartSneaking entity=A |
| `point_at` | ✔ | `point_at x y z` | その点を向いて腕で指す | EV after.playerSwingStart heldItemStack=- player=A swingSource=Attack |
| `wave_arm` | ✔ | `wave_arm [who]` | 相手を見て腕を振る | EV after.playerSwingStart heldItemStack=- player=A swingSource=Attack |
| `emote_n` | ✔ | `emote_n <1-4>` | 装備したエモートを出す（エモートの輪の番号） | EV after.playerEmote personaPieceId=42fde774-37d4-4422-b374-89ff13a6535a player=A |
| `chat_pos` | ✔ | `chat_pos` | 今の座標をチャットで伝える | EV after.chatSend message=I'm at 0 -60 0 sender=A targets=- |
| `wait_for` | ✔ | `wait_for <player|mob> [seconds]` | 相手が来るまで待つ（来たら顔を見る） | @A wait_for: cow is here |

## click

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `door` | ✔ | `door x y z` | ドアを開け閉めする | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:wooden_door@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player= |
| `trapdoor` | ✔ | `trapdoor x y z` | トラップドアを開け閉めする |  |
| `gate` | ✔ | `gate x y z` | フェンスゲートを開け閉めする |  |
| `lever` | ✔ | `lever x y z` | レバーを倒す | EV after.leverAction block=minecraft:lever@1,-60,1 dimension=overworld isPowered=true player=A |
| `button` | ✔ | `button x y z` | ボタンを押す | EV after.buttonPush block=minecraft:stone_button@1,-60,1 dimension=overworld source=A |
| `repeater` | ✔ | `repeater x y z` | リピーターの遅延を変える（1 クリック） |  |
| `comparator` | ✔ | `comparator x y z` | コンパレーターの比較／減算を切り替える |  |
| `daylight` | ✔ | `daylight x y z` | 日照センサーを反転させる |  |
| `berries` | ✔ | `berries x y z` | スイートベリーを摘む | EV after.entitySpawn cause=Spawned entity=item:minecraft:sweet_berries*1 |
| `glow_berries` | ✔ | `glow_berries x y z` | グロウベリーを摘む（洞窟のツタ） | EV after.entitySpawn cause=Spawned entity=item:minecraft:glow_berries*1 |
| `jukebox_eject` | ✔ | `jukebox_eject x y z` | ジュークボックスからレコードを取り出す | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:jukebox@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `candle_out` | ✔ | `candle_out x y z` | ろうそくの火を消す |  |
| `spawnpoint` | ✔ | `spawnpoint x y z` | ベッド・リスポーンアンカーでリスポーン地点を決める | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:bed@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `crafting_table` | ✔ | `crafting_table x y z` | 作業台を開く | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:crafting_table@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- play |
| `chest` | ✔ | `chest x y z` | チェストを開ける | EV after.blockContainerOpened block=minecraft:chest@1,-60,1 dimension=overworld openSource={entity=A} |
| `barrel` | ✔ | `barrel x y z` | 樽を開ける | EV after.blockContainerOpened block=minecraft:barrel@1,-60,1 dimension=overworld openSource={entity=A} |
| `ender_chest` | ✔ | `ender_chest x y z` | エンダーチェストを開ける | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:ender_chest@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player= |
| `shulker` | ✔ | `shulker x y z` | シュルカーボックスを開ける | EV after.blockContainerOpened block=minecraft:undyed_shulker_box@1,-60,1 dimension=overworld openSource={entity=A} |
| `furnace` | ✔ | `furnace x y z` | かまどを開ける | EV after.blockContainerOpened block=minecraft:furnace@1,-60,1 dimension=overworld openSource={entity=A} |
| `anvil_open` | ✔ | `anvil_open x y z` | 金床を開く | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:anvil@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `loom_open` | ✔ | `loom_open x y z` | 機織り機を開く | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:loom@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `bed` | ✔ | `bed x y z` | ベッドを使う | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:bed@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `dragon_egg` | ✔ | `dragon_egg x y z` | ドラゴンの卵に触る（テレポートする） | EV before.playerInteractWithBlock block=minecraft:dragon_egg@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `sign_read` | ✔ | `sign_read x y z` | 看板を開く（編集画面） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:standing_sign@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- playe |
| `vault` | ✔ | `vault x y z` | 保管庫を右クリックする（鍵を持って） | EV after.itemStartUseOn block=minecraft:vault@1,-60,1 blockFace=Up itemStack=- source=A |

## combat

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `fight` | ✔ | `fight <mob> [hits]` | 近づいて、振りが戻るたびに叩く | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `crit` | ✔ | `crit <mob>` | 跳んで落ちる途中で叩く（会心） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `shoot` | ✔ | `shoot <mob> [ticks]` | 弓で狙って射る | EV after.itemReleaseUse itemStack=minecraft:bow*1 source=A useDuration=71980 |
| `throw_at` | ✔ | `throw_at <item> <mob>` | 狙って投げる | EV after.itemUse itemStack=minecraft:snowball*16 source=A |
| `flee` | ✔ | `flee [mob] [ticks]` | 背を向けて走って逃げる |  |
| `hunt` | ✔ | `hunt <mob> [hits]` | 追いかけて倒す | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `shield_block` | ✔ | `shield_block [ticks]` | 盾を構えて受ける | EV after.itemUse itemStack=minecraft:shield*1 source=A |
| `fight_zombie` | ✔ | `fight_zombie [hits]` | ゾンビと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zombie |
| `fight_husk` | ✔ | `fight_husk [hits]` | ハスクと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:husk |
| `fight_drowned` | ✔ | `fight_drowned [hits]` | ドラウンドと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:drowned |
| `fight_zombie_villager` | ✔ | `fight_zombie_villager [hits]` | 村人ゾンビと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zombie_villager_v2 |
| `fight_zombified_piglin` | ✔ | `fight_zombified_piglin [hits]` | ゾンビピグリンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zombie_pigman |
| `fight_piglin` | ✔ | `fight_piglin [hits]` | ピグリンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:piglin |
| `fight_piglin_brute` | ✔ | `fight_piglin_brute [hits]` | ピグリンブルートと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:piglin_brute |
| `fight_hoglin` | ✔ | `fight_hoglin [hits]` | ホグリンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:hoglin |
| `fight_zoglin` | ✔ | `fight_zoglin [hits]` | ゾグリンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zoglin |
| `fight_wither_skeleton` | ✔ | `fight_wither_skeleton [hits]` | ウィザースケルトンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:wither_skeleton |
| `fight_vex` | ✔ | `fight_vex [hits]` | ヴェックスと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:vex |
| `fight_witch` | ✔ | `fight_witch [hits]` | ウィッチと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:witch |
| `fight_breeze` | ✔ | `fight_breeze [hits]` | ブリーズと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:breeze |
| `fight_guardian` | ✔ | `fight_guardian [hits]` | ガーディアンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:guardian |
| `fight_elder_guardian` | ✔ | `fight_elder_guardian [hits]` | エルダーガーディアンと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:elder_guardian |
| `fight_silverfish` | ✔ | `fight_silverfish [hits]` | シルバーフィッシュと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:silverfish |
| `fight_endermite` | ✔ | `fight_endermite [hits]` | エンダーマイトと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:endermite |
| `fight_evoker` | ✔ | `fight_evoker [hits]` | エヴォーカーと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:evocation_illager |
| `fight_wither` | ✔ | `fight_wither [hits]` | ウィザーと戦う（近づいて叩く） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:wither |
| `fight_ravager` | ✔ | `fight_ravager [hits]` | ラヴェジャーと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:ravager |
| `fight_vindicator` | ✔ | `fight_vindicator [hits]` | ヴィンディケーターと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:vindicator |
| `fight_pillager` | ✔ | `fight_pillager [hits]` | ピリジャーと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:pillager |
| `fight_skeleton` | ✔ | `fight_skeleton [hits]` | スケルトンと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:skeleton |
| `fight_stray` | ✔ | `fight_stray [hits]` | ストレイと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:stray |
| `fight_bogged` | ✔ | `fight_bogged [hits]` | ボグドと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:bogged |
| `fight_parched` | ✔ | `fight_parched [hits]` | パーチドと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:parched |
| `fight_shulker` | ✔ | `fight_shulker [hits]` | シュルカーと戦う（盾を構えて近づく） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:shulker |
| `fight_spider` | ✔ | `fight_spider [hits]` | クモと戦う（跳んで会心） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:spider |
| `fight_cave_spider` | ✔ | `fight_cave_spider [hits]` | 洞窟グモと戦う（跳んで会心） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cave_spider |
| `fight_creeper` | ✔ | `fight_creeper [hits]` | クリーパーと戦う（叩いたら離れる） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:creeper |
| `fight_enderman` | ✔ | `fight_enderman [hits]` | エンダーマンと戦う（目を見ない） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:enderman |
| `fight_phantom` | ✔ | `fight_phantom [hits]` | ファントムと戦う（上を狙う） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:phantom |
| `fight_slime` | ✔ | `fight_slime [hits]` | スライムと戦う（分裂しても全部） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:slime |
| `fight_magma_cube` | ✔ | `fight_magma_cube [hits]` | マグマキューブと戦う（分裂しても全部） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:magma_cube |
| `fight_blaze` | ✔ | `fight_blaze [hits]` | ブレイズと戦う（雪玉があれば投げる） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:blaze |
| `fight_ghast` | ✔ | `fight_ghast [hits]` | ガストと戦う（火の玉を打ち返す・弓で射る） | EV after.itemReleaseUse itemStack=minecraft:bow*1 source=A useDuration=71980 |
| `fight_creaking` | ✔ | `fight_creaking [radius]` | クリーキングの心臓を探して壊す（本体は倒せない） | EV after.playerBreakBlock block=minecraft:air@2,-60,1 brokenBlockPermutation=minecraft:creaking_heart dimension=overworld itemStackAfterBreak=minecraft:iron_axe |
| `avoid_warden` | ✔ | `avoid_warden [ticks]` | ウォーデンからしゃがんで離れる（戦わない） |  |
| `fight_ender_dragon` | ✔ | `fight_ender_dragon [n]` | エンドクリスタルを先に壊してからドラゴンと戦う | @A fight_ender_dragon: 1 hits/shots |
| `fight_any` | ✔ | `fight_any [hits]` | 近くの敵対モブと戦う（種類に合った戦い方で） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zombie |
| `defend` | ✔ | `defend [ticks]` | その場で見張り、近づいた敵を叩く | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:zombie |
| `hunt_food` | ✔ | `hunt_food [hits]` | 近くの食べられる動物を倒して落とした物を拾う | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `sprint_hit` | ✔ | `sprint_hit <mob>` | 走って行って叩く（ノックバック大） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `w_tap` | ✔ | `w_tap <mob> [n]` | 叩くたびに前キーを離して走り直す | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `spam_click` | ✔ | `spam_click <mob> [n]` | 連打する（溜めずに弱い攻撃） | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `strafe_fight` | ✔ | `strafe_fight <mob> [n]` | 左右に回り込みながら叩く | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `kite` | ✔ | `kite <mob> [n]` | 離れながら弓で射る | EV after.itemReleaseUse itemStack=minecraft:bow*1 source=A useDuration=71980 |
| `axe_shield` | ✔ | `axe_shield <mob>` | 斧で盾を崩してから剣で叩く | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `mace_smash` | ✔ | `mace_smash <mob>` | メイスで落下攻撃（ウィンドチャージで跳ぶ） | EV after.itemUse itemStack=minecraft:wind_charge*16 source=A |
| `spear_jab` | ✔ | `spear_jab <mob>` | 槍で突く | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |
| `spear_charge` | ✔ | `spear_charge <mob> [ticks]` | 槍を構えて走り込む（突進） | EV after.itemStartUse itemStack=minecraft:iron_spear*1 source=A useDuration=1440000 |
| `crossbow_shoot` | ✔ | `crossbow_shoot <mob>` | クロスボウに装填して狙って撃つ | EV after.itemCompleteUse itemStack=minecraft:crossbow*1 source=A useDuration=0 |
| `snipe` | ✔ | `snipe <mob> [ticks]` | 遠くを弓で狙う（距離に合わせて上を狙う） | EV after.itemReleaseUse itemStack=minecraft:bow*1 source=A useDuration=71976 |
| `hook_mob` | ✔ | `hook_mob <mob> [ticks]` | 釣り竿で引っかけて引き寄せる | EV after.itemUse itemStack=minecraft:fishing_rod*1 source=A |
| `pearl_escape` | ✔ | `pearl_escape` | 敵と反対へエンダーパールで逃げる | EV after.itemUse itemStack=minecraft:ender_pearl*16 source=A |
| `dodge` | ✔ | `dodge [left|right]` | 横に跳んでよける |  |
| `shield_walk` | ✔ | `shield_walk <mob>` | 盾を構えたまま近づき、叩く時だけ下ろす | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:cow |

## life

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `heal` | ✔ | `heal` | 金のリンゴで回復 | EV after.itemCompleteUse itemStack=minecraft:golden_apple*16 source=A useDuration=0 |
| `eat_best` | ✔ | `eat_best [always]` | 空腹なら一番良い食べ物を食べる | EV after.itemCompleteUse itemStack=minecraft:bread*16 source=A useDuration=0 |
| `armor_up` | ✔ | `armor_up` | 持っている防具を全部着る | @A inv empty (holding slot 0) worn head:minecraft:iron_helmet*1 feet:minecraft:iron_boots*1 |
| `clutch` | ✔ | `clutch` | 落下中に水バケツで着地 |  |
| `extinguish` | ✔ | `extinguish x y z` | 火を叩いて消す |  |
| `sleep_night` | ✔ | `sleep_night x y z [ticks]` | ベッドで寝て起きる | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:bed@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `eat_until_full` | ✔ | `eat_until_full` | 満腹になるまで食べる | EV after.itemCompleteUse itemStack=minecraft:bread*16 source=A useDuration=0 |
| `escape_water` | ✔ | `escape_water` | 水面に出て、知っている一番近い陸へ泳ぐ | @A escape_water: ashore |
| `escape_lava` | ✔ | `escape_lava` | 跳んで一番近い安全な足場へ（水バケツがあれば火を消す） | @A escape_lava: out |
| `put_out_fire` | ✔ | `put_out_fire` | 足元に水を撒いて火を消し、水を汲み戻す | EV after.itemStartUseOn block=minecraft:grass_block@0,-61,0 blockFace=Up itemStack=minecraft:water_bucket*1 source=A |
| `totem_ready` | ✔ | `totem_ready` | 不死のトーテムをオフハンドに持つ | @A inv empty (holding slot 0) worn offhand:minecraft:totem_of_undying*1 |
| `pick_start` | ✔ | `pick_start [r]` | 走り始めるのに良い場所へ移る: 木がある・乾いた陸・動物がいる（海の上や暗い森は避ける）。見える範囲に無ければ r ブロック先を 8 方向まで見に行く（レースの事前生成で使う） | @A pick_start: at 65 0 (best found: 0 trees (0 within 64), 100% dry land, 0 animals, 0% shade; 1 places looked at) |
| `dig_out` | ✔ | `dig_out [y]` | 地下から地上へ出る: 下りてきた自分の階段を戻る（無ければ階段を掘って上がる。足場が無ければブロックを置く）、空が見えるまで | @A dig_out: already under the open sky at y=-60 |
| `dig_in` | ✔ | `dig_in` | その場で夜を越す: 掘り下げてふたをする（浅ければ壁とふたを積む、だめなら 3 段の柱の上）、朝になったら出る（夜でなければ囲ってすぐ出る） | @A dig_in: shut in (dug 3) |

## farm

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `harvest_area` | ✔ | `harvest_area x1 z1 x2 z2 y` | 畑の作物をまとめて収穫 | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:wheat dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pl |
| `replant` | ✔ | `replant <seed> x1 z1 x2 z2 y` | 収穫して植え直す | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:wheat dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pl |
| `sapling` | ✔ | `sapling <sapling> x y z` | 苗木を植える |  |
| `grow` | ✔ | `grow x y z [n]` | 骨粉で育てる | EV after.itemStartUseOn block=minecraft:oak_sapling@1,-60,1 blockFace=Up itemStack=minecraft:bone_meal*16 source=A |
| `pick_flower` | ✔ | `pick_flower x y z` | 花を摘む | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:poppy dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pl |
| `fill_cauldron` | ✔ | `fill_cauldron x y z` | 大釜に水を入れる |  |
| `cauldron_bottle` | ✔ | `cauldron_bottle x y z` | 大釜から瓶に汲む | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:potion*1 player=A slot=1 |
| `wash` | ✔ | `wash <item> x y z` | 大釜で色を落とす | EV after.playerInteractWithBlock beforeItemStack=minecraft:leather_chestplate*1 block=minecraft:cauldron@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEven |
| `campfire_cook` | ✔ | `campfire_cook <food> x y z` | 焚き火で焼く | EV after.playerInteractWithBlock beforeItemStack=minecraft:beef*16 block=minecraft:campfire@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemSt |
| `fish_n` | ✔ | `fish_n [n] [seconds]` | 何匹か釣る | EV after.itemUse itemStack=minecraft:fishing_rod*1 source=A |
| `compost_all` | ✔ | `compost_all x y z <item>` | コンポスターに全部入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:wheat_seeds*16 block=minecraft:composter@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=tru |
| `herd` | ✔ | `herd <food> x z` | 餌で動物を連れて行く |  |
| `tie` | ✔ | `tie x y z` | リードを柵につなぐ | EV after.playerInteractWithBlock beforeItemStack=minecraft:lead*15 block=minecraft:oak_fence@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemS |
| `plant_wheat` | ✔ | `plant_wheat x y z` | 小麦の種を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:wheat_seeds*16 source=A |
| `plant_carrot` | ✔ | `plant_carrot x y z` | ニンジンを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:carrot*16 source=A |
| `plant_potato` | ✔ | `plant_potato x y z` | ジャガイモを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:potato*16 source=A |
| `plant_beetroot` | ✔ | `plant_beetroot x y z` | ビートルートの種を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:beetroot_seeds*16 source=A |
| `plant_melon` | ✔ | `plant_melon x y z` | スイカの種を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:melon_seeds*16 source=A |
| `plant_pumpkin` | ✔ | `plant_pumpkin x y z` | カボチャの種を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:pumpkin_seeds*16 source=A |
| `plant_torchflower` | ✔ | `plant_torchflower x y z` | トーチフラワーの種を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:torchflower_seeds*64 source=A |
| `plant_pitcher` | ✔ | `plant_pitcher x y z` | ウツボカズラのさやを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:farmland@1,-61,1 blockFace=Up itemStack=minecraft:pitcher_pod*16 source=A |
| `plant_nether_wart` | ✔ | `plant_nether_wart x y z` | ネザーウォートを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:soul_sand@1,-61,1 blockFace=Up itemStack=minecraft:nether_wart*16 source=A |
| `plant_sugar_cane` | ✔ | `plant_sugar_cane x y z` | サトウキビを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:sand@1,-61,1 blockFace=Up itemStack=minecraft:sugar_cane*16 source=A |
| `plant_cactus` | ✔ | `plant_cactus x y z` | サボテンを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:sand@1,-61,1 blockFace=Up itemStack=minecraft:cactus*16 source=A |
| `plant_bamboo` | ✔ | `plant_bamboo x y z` | 竹を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:grass_block@1,-61,1 blockFace=Up itemStack=minecraft:bamboo*16 source=A |
| `plant_sweet_berries` | ✔ | `plant_sweet_berries x y z` | スイートベリーを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:grass_block@1,-61,1 blockFace=Up itemStack=minecraft:sweet_berries*16 source=A |
| `plant_kelp` | ✔ | `plant_kelp x y z` | 昆布を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:sand@1,-61,1 blockFace=Up itemStack=minecraft:kelp*16 source=A |
| `plant_sea_pickle` | ✔ | `plant_sea_pickle x y z` | シーピクルスを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:sand@1,-61,1 blockFace=Up itemStack=minecraft:sea_pickle*16 source=A |
| `plant_mushroom` | ✔ | `plant_mushroom x y z` | キノコを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:podzol@1,-61,1 blockFace=Up itemStack=minecraft:brown_mushroom*16 source=A |
| `plant_fungus` | ✔ | `plant_fungus x y z` | ネザーのキノコを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:crimson_nylium@1,-61,1 blockFace=Up itemStack=minecraft:crimson_fungus*16 source=A |
| `plant_chorus` | ✔ | `plant_chorus x y z` | コーラスフラワーを植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:end_stone@1,-61,1 blockFace=Up itemStack=minecraft:chorus_flower*16 source=A |
| `plant_flower` | ✔ | `plant_flower x y z` | 花を植える（x y z は植える土台のブロック） | EV after.itemStartUseOn block=minecraft:grass_block@1,-61,1 blockFace=Up itemStack=minecraft:poppy*16 source=A |
| `plant_cocoa` | ✔ | `plant_cocoa x y z [face]` | カカオ豆を植える（x y z は植える丸太） | EV after.itemStartUseOn block=minecraft:jungle_log@1,-60,1 blockFace=North itemStack=minecraft:cocoa_beans*16 source=A |
| `plant_glow_berries` | ✔ | `plant_glow_berries x y z` | グロウベリーを植える（x y z は天井のブロック） | EV after.itemStartUseOn block=minecraft:stone@1,-58,1 blockFace=Down itemStack=minecraft:glow_berries*16 source=A |
| `harvest_ripe` | ✔ | `harvest_ripe x1 z1 x2 z2 y` | 実った作物だけ収穫する（育ち途中は残す） | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:wheat dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pl |
| `farm_cycle` | ✔ | `farm_cycle <seed> x1 z1 x2 z2 y` | 実ったものを収穫して、同じ種を植え直す | @A farm_cycle: 1 replanted |
| `harvest_tall` | ✔ | `harvest_tall x1 z1 x2 z2 y` | サトウキビ・竹・サボテン・昆布を根元を残して刈る | @A harvest_tall: 1 cut above the base |
| `harvest_berries` | ✔ | `harvest_berries x1 z1 x2 z2 y` | 熟したスイートベリー・グロウベリーを摘む | @A harvest_berries: 1 picked |
| `till_area` | ✔ | `till_area x1 z1 x2 z2 y` | 範囲を耕す |  |
| `bonemeal_area` | ✔ | `bonemeal_area x1 z1 x2 z2 y` | 範囲に骨粉をまく | EV after.itemStartUseOn block=minecraft:oak_sapling@1,-60,1 blockFace=Up itemStack=minecraft:bone_meal*16 source=A |
| `fell_tree` | ✔ | `fell_tree x y z` | つながった原木を全部切る（木を丸ごと） | @A fell_tree: 3 logs |
| `grow_tree` | ✔ | `grow_tree <sapling> x y z` | 苗木を植えて骨粉で木にする | @A grow_tree: grown |
| `pick_flowers` | ✔ | `pick_flowers x1 z1 x2 z2 y` | 範囲の花だけ摘む | @A pick_flowers: 2 flowers |
| `mow` | ✔ | `mow x1 z1 x2 z2 y` | 草・シダを刈る | @A mow: 2 cut |

## food

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `eat_apple` | ✔ | `eat_apple [ticks]` | リンゴを食べる | EV after.itemCompleteUse itemStack=minecraft:apple*16 source=A useDuration=0 |
| `eat_baked_potato` | ✔ | `eat_baked_potato [ticks]` | ベイクドポテトを食べる | EV after.itemCompleteUse itemStack=minecraft:baked_potato*16 source=A useDuration=0 |
| `eat_beef` | ✔ | `eat_beef [ticks]` | 生の牛肉を食べる | EV after.itemCompleteUse itemStack=minecraft:beef*16 source=A useDuration=0 |
| `eat_beetroot` | ✔ | `eat_beetroot [ticks]` | ビートルートを食べる | EV after.itemCompleteUse itemStack=minecraft:beetroot*16 source=A useDuration=0 |
| `eat_beetroot_soup` | ✔ | `eat_beetroot_soup [ticks]` | ビートルートスープを食べる | EV after.itemCompleteUse itemStack=minecraft:beetroot_soup*1 source=A useDuration=0 |
| `eat_bread` | ✔ | `eat_bread [ticks]` | パンを食べる | EV after.itemCompleteUse itemStack=minecraft:bread*16 source=A useDuration=0 |
| `eat_carrot` | ✔ | `eat_carrot [ticks]` | ニンジンを食べる | EV after.itemCompleteUse itemStack=minecraft:carrot*16 source=A useDuration=0 |
| `eat_chicken` | ✔ | `eat_chicken [ticks]` | 生の鶏肉を食べる | EV after.itemCompleteUse itemStack=minecraft:chicken*16 source=A useDuration=0 |
| `eat_chorus_fruit` | ✔ | `eat_chorus_fruit [ticks]` | コーラスフルーツを食べる | EV after.itemCompleteUse itemStack=minecraft:chorus_fruit*16 source=A useDuration=0 |
| `eat_cod` | ✔ | `eat_cod [ticks]` | 生鱈を食べる | EV after.itemCompleteUse itemStack=minecraft:cod*16 source=A useDuration=0 |
| `eat_cooked_beef` | ✔ | `eat_cooked_beef [ticks]` | ステーキを食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_beef*16 source=A useDuration=0 |
| `eat_cooked_chicken` | ✔ | `eat_cooked_chicken [ticks]` | 焼き鳥を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_chicken*16 source=A useDuration=0 |
| `eat_cooked_cod` | ✔ | `eat_cooked_cod [ticks]` | 焼き鱈を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_cod*16 source=A useDuration=0 |
| `eat_cooked_mutton` | ✔ | `eat_cooked_mutton [ticks]` | 焼き羊肉を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_mutton*16 source=A useDuration=0 |
| `eat_cooked_porkchop` | ✔ | `eat_cooked_porkchop [ticks]` | 焼き豚を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_porkchop*16 source=A useDuration=0 |
| `eat_cooked_rabbit` | ✔ | `eat_cooked_rabbit [ticks]` | 焼き兎肉を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_rabbit*16 source=A useDuration=0 |
| `eat_cooked_salmon` | ✔ | `eat_cooked_salmon [ticks]` | 焼き鮭を食べる | EV after.itemCompleteUse itemStack=minecraft:cooked_salmon*16 source=A useDuration=0 |
| `eat_cookie` | ✔ | `eat_cookie [ticks]` | クッキーを食べる | EV after.itemCompleteUse itemStack=minecraft:cookie*16 source=A useDuration=0 |
| `eat_dried_kelp` | ✔ | `eat_dried_kelp [ticks]` | 乾燥した昆布を食べる | EV after.itemCompleteUse itemStack=minecraft:dried_kelp*16 source=A useDuration=0 |
| `eat_enchanted_golden_apple` | ✔ | `eat_enchanted_golden_apple [ticks]` | エンチャントされた金のリンゴを食べる | EV after.itemCompleteUse itemStack=minecraft:enchanted_golden_apple*16 source=A useDuration=0 |
| `eat_glow_berries` | ✔ | `eat_glow_berries [ticks]` | グロウベリーを食べる | EV after.itemCompleteUse itemStack=minecraft:glow_berries*16 source=A useDuration=0 |
| `eat_golden_apple` | ✔ | `eat_golden_apple [ticks]` | 金のリンゴを食べる | EV after.itemCompleteUse itemStack=minecraft:golden_apple*16 source=A useDuration=0 |
| `eat_golden_carrot` | ✔ | `eat_golden_carrot [ticks]` | 金のニンジンを食べる | EV after.itemCompleteUse itemStack=minecraft:golden_carrot*16 source=A useDuration=0 |
| `eat_melon_slice` | ✔ | `eat_melon_slice [ticks]` | スイカの薄切りを食べる | EV after.itemCompleteUse itemStack=minecraft:melon_slice*16 source=A useDuration=0 |
| `eat_mushroom_stew` | ✔ | `eat_mushroom_stew [ticks]` | キノコシチューを食べる | EV after.itemCompleteUse itemStack=minecraft:mushroom_stew*1 source=A useDuration=0 |
| `eat_mutton` | ✔ | `eat_mutton [ticks]` | 生の羊肉を食べる | EV after.itemCompleteUse itemStack=minecraft:mutton*16 source=A useDuration=0 |
| `eat_poisonous_potato` | ✔ | `eat_poisonous_potato [ticks]` | 青くなったジャガイモを食べる | EV after.itemCompleteUse itemStack=minecraft:poisonous_potato*16 source=A useDuration=0 |
| `eat_porkchop` | ✔ | `eat_porkchop [ticks]` | 生の豚肉を食べる | EV after.itemCompleteUse itemStack=minecraft:porkchop*16 source=A useDuration=0 |
| `eat_potato` | ✔ | `eat_potato [ticks]` | ジャガイモを食べる | EV after.itemCompleteUse itemStack=minecraft:potato*16 source=A useDuration=0 |
| `eat_pufferfish` | ✔ | `eat_pufferfish [ticks]` | フグを食べる | EV after.itemCompleteUse itemStack=minecraft:pufferfish*16 source=A useDuration=0 |
| `eat_pumpkin_pie` | ✔ | `eat_pumpkin_pie [ticks]` | パンプキンパイを食べる | EV after.itemCompleteUse itemStack=minecraft:pumpkin_pie*16 source=A useDuration=0 |
| `eat_rabbit` | ✔ | `eat_rabbit [ticks]` | 生の兎肉を食べる | EV after.itemCompleteUse itemStack=minecraft:rabbit*16 source=A useDuration=0 |
| `eat_rabbit_stew` | ✔ | `eat_rabbit_stew [ticks]` | ウサギシチューを食べる | EV after.itemCompleteUse itemStack=minecraft:rabbit_stew*1 source=A useDuration=0 |
| `eat_rotten_flesh` | ✔ | `eat_rotten_flesh [ticks]` | 腐った肉を食べる | EV after.itemCompleteUse itemStack=minecraft:rotten_flesh*16 source=A useDuration=0 |
| `eat_salmon` | ✔ | `eat_salmon [ticks]` | 生鮭を食べる | EV after.itemCompleteUse itemStack=minecraft:salmon*16 source=A useDuration=0 |
| `eat_spider_eye` | ✔ | `eat_spider_eye [ticks]` | クモの目を食べる | EV after.itemCompleteUse itemStack=minecraft:spider_eye*16 source=A useDuration=0 |
| `eat_suspicious_stew` | ✔ | `eat_suspicious_stew [ticks]` | 怪しげなシチューを食べる | EV after.itemCompleteUse itemStack=minecraft:suspicious_stew*1 source=A useDuration=0 |
| `eat_sweet_berries` | ✔ | `eat_sweet_berries [ticks]` | スイートベリーを食べる | EV after.itemCompleteUse itemStack=minecraft:sweet_berries*16 source=A useDuration=0 |
| `eat_tropical_fish` | ✔ | `eat_tropical_fish [ticks]` | 熱帯魚を食べる | EV after.itemCompleteUse itemStack=minecraft:tropical_fish*16 source=A useDuration=0 |

## animal

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `breed_cow` | ✔ | `breed_cow` | ウシを繁殖させる（近くの 2 匹に wheat など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:cow |
| `breed_mooshroom` | ✔ | `breed_mooshroom` | ムーシュルームを繁殖させる（近くの 2 匹に wheat など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:mooshroom |
| `breed_sheep` | ✔ | `breed_sheep` | ヒツジを繁殖させる（近くの 2 匹に wheat など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:sheep |
| `breed_goat` | ✔ | `breed_goat` | ヤギを繁殖させる（近くの 2 匹に wheat など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:goat |
| `breed_pig` | ✔ | `breed_pig` | ブタを繁殖させる（近くの 2 匹に carrot など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:carrot*16 itemStack=minecraft:carrot*15 player=A target=minecraft:pig |
| `breed_chicken` | ✔ | `breed_chicken` | ニワトリを繁殖させる（近くの 2 匹に wheat_seeds など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat_seeds*16 itemStack=minecraft:wheat_seeds*15 player=A target=minecraft:chicken |
| `breed_horse` | ✔ | `breed_horse` | ウマを繁殖させる（近くの 2 匹に golden_carrot など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:horse |
| `breed_donkey` | ✔ | `breed_donkey` | ロバを繁殖させる（近くの 2 匹に golden_carrot など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:donkey |
| `breed_llama` | ✔ | `breed_llama` | ラマを繁殖させる（近くの 2 匹に hay_block など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:hay_block*16 itemStack=minecraft:hay_block*15 player=A target=minecraft:llama |
| `breed_trader_llama` | ✔ | `breed_trader_llama` | 行商人のラマを繁殖させる（近くの 2 匹に hay_block など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:hay_block*16 itemStack=minecraft:hay_block*15 player=A target=minecraft:trader_llama |
| `breed_camel` | ✔ | `breed_camel` | ラクダを繁殖させる（近くの 2 匹に cactus など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cactus*16 itemStack=minecraft:cactus*15 player=A target=minecraft:camel |
| `breed_wolf` | ✔ | `breed_wolf` | オオカミを繁殖させる（近くの 2 匹に cooked_beef など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cooked_beef*16 itemStack=minecraft:cooked_beef*15 player=A target=minecraft:wolf |
| `breed_cat` | ✔ | `breed_cat` | ネコを繁殖させる（近くの 2 匹に cod など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:cat |
| `breed_ocelot` | ✔ | `breed_ocelot` | ヤマネコを繁殖させる（近くの 2 匹に cod など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:ocelot |
| `breed_rabbit` | ✔ | `breed_rabbit` | ウサギを繁殖させる（近くの 2 匹に dandelion など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:dandelion*16 itemStack=minecraft:dandelion*15 player=A target=minecraft:rabbit |
| `breed_turtle` | ✔ | `breed_turtle` | カメを繁殖させる（近くの 2 匹に seagrass など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:seagrass*16 itemStack=minecraft:seagrass*15 player=A target=minecraft:turtle |
| `breed_panda` | ✔ | `breed_panda` | パンダを繁殖させる（近くの 2 匹に bamboo など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:bamboo*16 itemStack=minecraft:bamboo*15 player=A target=minecraft:panda |
| `breed_fox` | ✔ | `breed_fox` | キツネを繁殖させる（近くの 2 匹に sweet_berries など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:sweet_berries*16 itemStack=minecraft:sweet_berries*15 player=A target=minecraft:fox |
| `breed_bee` | ✔ | `breed_bee` | ハチを繁殖させる（近くの 2 匹に dandelion など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:dandelion*16 itemStack=minecraft:dandelion*15 player=A target=minecraft:bee |
| `breed_axolotl` | ✔ | `breed_axolotl` | ウーパールーパーを繁殖させる（近くの 2 匹に tropical_fish_bucket など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:tropical_fish_bucket*1 itemStack=minecraft:water_bucket*1 player=A target=minecraft:axolotl |
| `breed_frog` | ✔ | `breed_frog` | カエルを繁殖させる（近くの 2 匹に slime_ball など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:slime_ball*16 itemStack=minecraft:slime_ball*15 player=A target=minecraft:frog |
| `breed_hoglin` | ✔ | `breed_hoglin` | ホグリンを繁殖させる（近くの 2 匹に crimson_fungus など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:crimson_fungus*16 itemStack=minecraft:crimson_fungus*15 player=A target=minecraft:hoglin |
| `breed_strider` | ✔ | `breed_strider` | ストライダーを繁殖させる（近くの 2 匹に warped_fungus など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:warped_fungus*16 itemStack=minecraft:warped_fungus*15 player=A target=minecraft:strider |
| `breed_sniffer` | ✔ | `breed_sniffer` | スニッファーを繁殖させる（近くの 2 匹に torchflower_seeds など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:torchflower_seeds*64 itemStack=minecraft:torchflower_seeds*63 player=A target=minecraft:sniffer |
| `breed_armadillo` | ✔ | `breed_armadillo` | アルマジロを繁殖させる（近くの 2 匹に spider_eye など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:spider_eye*16 itemStack=minecraft:spider_eye*15 player=A target=minecraft:armadillo |
| `breed_nautilus` | ✔ | `breed_nautilus` | オウムガイを繁殖させる（近くの 2 匹に pufferfish など） | EV after.playerInteractWithEntity beforeItemStack=minecraft:pufferfish*16 itemStack=minecraft:pufferfish*15 player=A target=minecraft:nautilus |
| `feed_cow` | ✔ | `feed_cow` | ウシに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:cow |
| `feed_mooshroom` | ✔ | `feed_mooshroom` | ムーシュルームに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:mooshroom |
| `feed_sheep` | ✔ | `feed_sheep` | ヒツジに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:sheep |
| `feed_goat` | ✔ | `feed_goat` | ヤギに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:goat |
| `feed_pig` | ✔ | `feed_pig` | ブタに餌をやる（carrot など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:carrot*16 itemStack=minecraft:carrot*15 player=A target=minecraft:pig |
| `feed_chicken` | ✔ | `feed_chicken` | ニワトリに餌をやる（wheat_seeds など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat_seeds*16 itemStack=minecraft:wheat_seeds*15 player=A target=minecraft:chicken |
| `feed_horse` | ✔ | `feed_horse` | ウマに餌をやる（golden_carrot など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:horse |
| `feed_donkey` | ✔ | `feed_donkey` | ロバに餌をやる（golden_carrot など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:donkey |
| `feed_llama` | ✔ | `feed_llama` | ラマに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:llama |
| `feed_trader_llama` | ✔ | `feed_trader_llama` | 行商人のラマに餌をやる（wheat など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:wheat*16 itemStack=minecraft:wheat*15 player=A target=minecraft:trader_llama |
| `feed_camel` | ✔ | `feed_camel` | ラクダに餌をやる（cactus など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cactus*16 itemStack=minecraft:cactus*15 player=A target=minecraft:camel |
| `feed_wolf` | ✔ | `feed_wolf` | オオカミに餌をやる（cooked_beef など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cooked_beef*16 itemStack=minecraft:cooked_beef*15 player=A target=minecraft:wolf |
| `feed_cat` | ✔ | `feed_cat` | ネコに餌をやる（cod など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:cat |
| `feed_ocelot` | ✔ | `feed_ocelot` | ヤマネコに餌をやる（cod など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:ocelot |
| `feed_rabbit` | ✔ | `feed_rabbit` | ウサギに餌をやる（dandelion など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:dandelion*16 itemStack=minecraft:dandelion*15 player=A target=minecraft:rabbit |
| `feed_turtle` | ✔ | `feed_turtle` | カメに餌をやる（seagrass など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:seagrass*16 itemStack=minecraft:seagrass*15 player=A target=minecraft:turtle |
| `feed_panda` | ✔ | `feed_panda` | パンダに餌をやる（bamboo など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:bamboo*16 itemStack=minecraft:bamboo*15 player=A target=minecraft:panda |
| `feed_fox` | ✔ | `feed_fox` | キツネに餌をやる（sweet_berries など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:sweet_berries*16 itemStack=minecraft:sweet_berries*15 player=A target=minecraft:fox |
| `feed_bee` | ✔ | `feed_bee` | ハチに餌をやる（dandelion など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:dandelion*16 itemStack=minecraft:dandelion*15 player=A target=minecraft:bee |
| `feed_axolotl` | ✔ | `feed_axolotl` | ウーパールーパーに餌をやる（tropical_fish_bucket など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:tropical_fish_bucket*1 itemStack=minecraft:water_bucket*1 player=A target=minecraft:axolotl |
| `feed_frog` | ✔ | `feed_frog` | カエルに餌をやる（slime_ball など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:slime_ball*16 itemStack=minecraft:slime_ball*15 player=A target=minecraft:frog |
| `feed_hoglin` | ✔ | `feed_hoglin` | ホグリンに餌をやる（crimson_fungus など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:crimson_fungus*16 itemStack=minecraft:crimson_fungus*15 player=A target=minecraft:hoglin |
| `feed_strider` | ✔ | `feed_strider` | ストライダーに餌をやる（warped_fungus など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:warped_fungus*16 itemStack=minecraft:warped_fungus*15 player=A target=minecraft:strider |
| `feed_sniffer` | ✔ | `feed_sniffer` | スニッファーに餌をやる（torchflower_seeds など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:torchflower_seeds*64 itemStack=minecraft:torchflower_seeds*63 player=A target=minecraft:sniffer |
| `feed_armadillo` | ✔ | `feed_armadillo` | アルマジロに餌をやる（spider_eye など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:spider_eye*16 itemStack=minecraft:spider_eye*15 player=A target=minecraft:armadillo |
| `feed_nautilus` | ✔ | `feed_nautilus` | オウムガイに餌をやる（pufferfish など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:pufferfish*16 itemStack=minecraft:pufferfish*15 player=A target=minecraft:nautilus |
| `feed_mule` | ✔ | `feed_mule` | ラバに餌をやる（golden_carrot など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:golden_carrot*16 itemStack=minecraft:golden_carrot*15 player=A target=minecraft:mule |
| `feed_zombie_horse` | ✔ | `feed_zombie_horse` | ゾンビホースに餌をやる（red_mushroom など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:red_mushroom*16 itemStack=minecraft:red_mushroom*15 player=A target=minecraft:zombie_horse |
| `feed_camel_husk` | ✔ | `feed_camel_husk` | ラクダハスクに餌をやる（rabbit_foot など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:rabbit_foot*16 itemStack=minecraft:rabbit_foot*16 player=A target=minecraft:camel_husk |
| `feed_dolphin` | ✔ | `feed_dolphin` | イルカに餌をやる（cod など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:dolphin |
| `feed_happy_ghast` | ✔ | `feed_happy_ghast` | ハッピーガストの子（ガストリング）に雪玉をやる（食べて育つ。大人は雪玉について来るだけ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:snowball*16 itemStack=minecraft:snowball*15 player=A target=minecraft:happy_ghast |
| `feed_tadpole` | ✔ | `feed_tadpole` | オタマジャクシに餌をやる（slime_ball など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:slime_ball*16 itemStack=minecraft:slime_ball*15 player=A target=minecraft:tadpole |
| `feed_zombie_nautilus` | ✔ | `feed_zombie_nautilus` | ゾンビオウムガイに餌をやる（pufferfish など、食べる物を選ぶ） | EV after.playerInteractWithEntity beforeItemStack=minecraft:pufferfish*16 itemStack=minecraft:pufferfish*15 player=A target=minecraft:zombie_nautilus |
| `tame_wolf` | ✔ | `tame_wolf [tries]` | オオカミを手なずける（bone を与え続ける） | EV after.entityTamed entity=minecraft:wolf tamingEntity=A |
| `tame_cat` | ✔ | `tame_cat [tries]` | ネコを手なずける（cod を与え続ける） | EV after.entityTamed entity=minecraft:cat tamingEntity=A |
| `tame_ocelot` | ✔ | `tame_ocelot [tries]` | ヤマネコを手なずける（cod を与え続ける） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:ocelot |
| `tame_parrot` | ✔ | `tame_parrot [tries]` | オウムを手なずける（wheat_seeds を与え続ける） | EV after.entityTamed entity=minecraft:parrot tamingEntity=A |
| `tame_nautilus` | ✔ | `tame_nautilus [tries]` | オウムガイを手なずける（pufferfish を与え続ける） | EV after.entityTamed entity=minecraft:nautilus tamingEntity=A |
| `tame_zombie_nautilus` | ✔ | `tame_zombie_nautilus [tries]` | ゾンビオウムガイを手なずける（pufferfish を与え続ける） | EV after.entityTamed entity=minecraft:zombie_nautilus tamingEntity=A |
| `tame_horse` | ✔ | `tame_horse [tries] [ticks]` | ウマを乗って手なずける（振り落とされなくなるまで） | @A tame_horse: tamed |
| `tame_donkey` | ✔ | `tame_donkey [tries] [ticks]` | ロバを乗って手なずける（振り落とされなくなるまで） | @A tame_donkey: tamed |
| `tame_mule` | ✔ | `tame_mule [tries] [ticks]` | ラバを乗って手なずける（振り落とされなくなるまで） | @A tame_mule: tamed |
| `tame_llama` | ✔ | `tame_llama [tries] [ticks]` | ラマを乗って手なずける（振り落とされなくなるまで） | @A tame_llama: tamed |
| `tame_trader_llama` | ✔ | `tame_trader_llama [tries] [ticks]` | 行商人のラマを乗って手なずける（振り落とされなくなるまで） | @A tame_trader_llama: tamed |
| `tame_zombie_horse` | ✔ | `tame_zombie_horse [tries] [ticks]` | ゾンビホースを乗って手なずける（振り落とされなくなるまで） | @A tame_zombie_horse: tamed |
| `ride_horse` | ✔ | `ride_horse` | ウマに乗る | ST A riding=horse |
| `ride_donkey` | ✔ | `ride_donkey` | ロバに乗る | ST A riding=donkey |
| `ride_mule` | ✔ | `ride_mule` | ラバに乗る | ST A riding=mule |
| `ride_llama` | ✔ | `ride_llama` | ラマに乗る | ST A riding=llama |
| `ride_trader_llama` | ✔ | `ride_trader_llama` | 行商人のラマに乗る | ST A riding=trader_llama |
| `ride_pig` | ✔ | `ride_pig` | ブタに乗る | ST A riding=pig |
| `ride_strider` | ✔ | `ride_strider` | ストライダーに乗る | ST A riding=strider |
| `ride_camel` | ✔ | `ride_camel` | ラクダに乗る | ST A riding=camel |
| `ride_camel_husk` | ✔ | `ride_camel_husk` | ラクダハスクに乗る | ST A riding=camel_husk |
| `ride_skeleton_horse` | ✔ | `ride_skeleton_horse` | スケルトンホースに乗る | ST A riding=skeleton_horse |
| `ride_zombie_horse` | ✔ | `ride_zombie_horse` | ゾンビホースに乗る | ST A riding=zombie_horse |
| `ride_happy_ghast` | ✔ | `ride_happy_ghast` | ハッピーガストに乗る | ST A riding=happy_ghast |
| `ride_nautilus` | ✔ | `ride_nautilus` | オウムガイに乗る | ST A riding=nautilus |
| `ride_zombie_nautilus` | ✔ | `ride_zombie_nautilus` | ゾンビオウムガイに乗る | ST A riding=zombie_nautilus |
| `ride_boat` | ✔ | `ride_boat` | ボートに乗る | ST A riding=boat |
| `ride_chest_boat` | ✔ | `ride_chest_boat` | チェスト付きボートに乗る | ST A riding=chest_boat |
| `ride_minecart` | ✔ | `ride_minecart` | トロッコに乗る | ST A riding=minecart |
| `ride_cushion` | ✔ | `ride_cushion` | クッションに乗る | ST A riding=cushion |
| `unsaddle` | ✔ | `unsaddle [mob]` | ハサミで鞍を外す | EV after.playerInteractWithEntity beforeItemStack=minecraft:saddle*1 itemStack=- player=A target=minecraft:pig |
| `unharness` | ✔ | `unharness [mob]` | ハサミでハーネスを外す | EV after.playerInteractWithEntity beforeItemStack=minecraft:white_harness*1 itemStack=- player=A target=minecraft:happy_ghast |
| `unarmor` | ✔ | `unarmor [mob]` | ハサミで馬鎧・オオカミの鎧・カーペットを外す | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_horse_armor*1 itemStack=- player=A target=minecraft:horse |
| `harness` | ✔ | `harness [mob] [color]` | ハッピーガストにハーネスを付ける | EV after.playerInteractWithEntity beforeItemStack=minecraft:white_harness*1 itemStack=- player=A target=minecraft:happy_ghast |
| `nautilus_armor` | ✔ | `nautilus_armor [mob]` | オウムガイに鎧を着せる | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_nautilus_armor*1 itemStack=- player=A target=minecraft:nautilus |
| `shulker_dye` | ✔ | `shulker_dye [dye]` | シュルカーを染料で染める（ゲームではクリエイティブのプレイヤーだけ染められる） | EV after.playerInteractWithEntity beforeItemStack=minecraft:blue_dye*16 itemStack=minecraft:blue_dye*16 player=A target=minecraft:shulker |
| `bribe_dolphin` | ✔ | `bribe_dolphin` | イルカに生魚をやる（宝へ案内） | EV after.playerInteractWithEntity beforeItemStack=minecraft:cod*16 itemStack=minecraft:cod*15 player=A target=minecraft:dolphin |
| `copper_golem_wax` | ✔ | `copper_golem_wax` | 銅のゴーレムにハニカムで蝋を塗る | EV after.playerInteractWithEntity beforeItemStack=minecraft:honeycomb*16 itemStack=minecraft:honeycomb*15 player=A target=minecraft:copper_golem |
| `copper_golem_scrape` | ✔ | `copper_golem_scrape` | 銅のゴーレムの錆を斧で落とす | EV before.playerInteractWithEntity itemStack=minecraft:iron_axe*1 player=A target=minecraft:copper_golem |
| `wolf_armor_repair` | ✔ | `wolf_armor_repair` | オオカミの鎧をアルマジロの甲羅で直す | EV before.playerInteractWithEntity itemStack=minecraft:armadillo_scute*16 player=A target=minecraft:wolf |
| `barter_hand` | ✔ | `barter_hand` | ピグリンに金インゴットを手渡す | EV after.playerInteractWithEntity beforeItemStack=minecraft:gold_ingot*16 itemStack=minecraft:gold_ingot*15 player=A target=minecraft:piglin |
| `allay_take` | ✔ | `allay_take [mob]` | アレイから渡した物を返してもらう（素手） | EV before.playerInteractWithEntity itemStack=- player=A target=minecraft:allay |
| `lead_mob` | ✔ | `lead_mob <mob> x z` | リードでつないで連れて行く | EV after.playerInteractWithEntity beforeItemStack=minecraft:lead*16 itemStack=minecraft:lead*15 player=A target=minecraft:cow |
| `milk_suspicious` | ✔ | `milk_suspicious [flower]` | ムーシュルームに花を食べさせてからボウルで怪しげなシチュー | EV after.playerInteractWithEntity beforeItemStack=minecraft:poppy*16 itemStack=minecraft:poppy*15 player=A target=minecraft:mooshroom |
| `shoulder_parrot` | ✔ | `shoulder_parrot` | オウムに近づいて肩に乗せる |  |
| `shear_all` | ✔ | `shear_all [mob] [radius]` | 近くのヒツジを全部刈る | EV after.playerInteractWithEntity beforeItemStack=minecraft:shears*1 itemStack=minecraft:shears*1 player=A target=minecraft:sheep |
| `feed_all` | ✔ | `feed_all <mob> [radius] [food]` | 近くのその動物に全部餌をやる | @A feed_all: 2 cow |
| `breed_all` | ✔ | `breed_all <mob> [radius]` | 近くのその動物を全部つがいにして繁殖 | @A breed_all: fed 2 cow (1 pairs) |
| `trade_buy` | ✔ | `trade_buy <item> [villager]` | 村人からその品を買う | @A trade offers: 0: 20 wheat -> 1 emerald / 1: 1 emerald -> 6 bread / 2: 6 pumpkin -> 1 emerald / 3: 1 emerald -> 4 pumpkin_pie / 4: 4 melon_block -> 1 emerald  |
| `trade_sell` | ✔ | `trade_sell <item> [villager]` | 村人にその品を売る（それで払う取引） | @A trade offers: 0: 26 potato -> 1 emerald / 1: 1 emerald -> 6 bread / 2: 6 pumpkin -> 1 emerald / 3: 1 emerald -> 4 pumpkin_pie / 4: 4 melon_block -> 1 emerald |
| `trade_all` | ✔ | `trade_all [index] [villager] [max]` | 同じ取引を品切れか払えなくなるまで繰り返す | @A trade_all: 0 trades |
| `name_mob` | ✔ | `name_mob <mob> x y z <name...>` | 金床で名札に名前を書いて、その名前を付ける | EV after.playerUseNameTag entityNamed=minecraft:cow newName=Bessie player=A previousName=- |

## command

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `gm_survival` | ✔ | `gm_survival` | サバイバルにする（/gamemode survival） | @A cmd: %commands.gamemode.success.self [%createWorldScreen.gameMode.survival] |
| `gm_creative` | ✔ | `gm_creative` | クリエイティブにする（/gamemode creative） | EV after.playerGameModeChange fromGameMode=Survival player=A toGameMode=Creative |
| `gm_adventure` | ✔ | `gm_adventure` | アドベンチャーにする（/gamemode adventure） | EV after.playerGameModeChange fromGameMode=Survival player=A toGameMode=Adventure |
| `gm_spectator` | ✔ | `gm_spectator` | スペクテイターにする（/gamemode spectator） | EV after.playerGameModeChange fromGameMode=Survival player=A toGameMode=Spectator |
| `time_day` | ✔ | `time_day` | 朝にする（/time set day） | @A cmd: %commands.time.set [25000] |
| `time_noon` | ✔ | `time_noon` | 正午にする（/time set noon） | @A cmd: %commands.time.set [30000] |
| `time_night` | ✔ | `time_night` | 夜にする（/time set night） | @A cmd: %commands.time.set [37000] |
| `time_midnight` | ✔ | `time_midnight` | 真夜中にする（/time set midnight） | @A cmd: %commands.time.set [66000] |
| `time_sunrise` | ✔ | `time_sunrise` | 日の出にする（/time set sunrise） | @A cmd: %commands.time.set [95000] |
| `time_sunset` | ✔ | `time_sunset` | 日没にする（/time set sunset） | @A cmd: %commands.time.set [108000] |
| `weather_clear` | ✔ | `weather_clear` | 晴れにする（/weather clear） | @A cmd: %commands.weather.clear |
| `weather_rain` | ✔ | `weather_rain` | 雨にする（/weather rain） | EV after.weatherChange dimension=overworld newWeather=Rain previousWeather=Clear |
| `weather_thunder` | ✔ | `weather_thunder` | 雷雨にする（/weather thunder） | EV after.weatherChange dimension=overworld newWeather=Thunder previousWeather=Rain |
| `difficulty_peaceful` | ✔ | `difficulty_peaceful` | 難易度ピースフル（/difficulty peaceful） | @A cmd: %commands.difficulty.success [PEACEFUL] |
| `difficulty_easy` | ✔ | `difficulty_easy` | 難易度イージー（/difficulty easy） | @A cmd: %commands.difficulty.success [EASY] |
| `difficulty_normal` | ✔ | `difficulty_normal` | 難易度ノーマル（/difficulty normal） | @A cmd: %commands.difficulty.success [NORMAL] |
| `difficulty_hard` | ✔ | `difficulty_hard` | 難易度ハード（/difficulty hard） | @A cmd: %commands.difficulty.success [HARD] |
| `kill_self` | ✔ | `kill_self` | 自分を倒す（/kill @s）（/kill @s） | @A died (death.attack.generic) |
| `clear_inventory` | ✔ | `clear_inventory` | 持ち物を消す（/clear）（/clear @s） | @A cmd failed: %commands.clear.failure.no.items [A] |
| `clear_effects` | ✔ | `clear_effects` | 効果を全部消す（/effect @s clear） | @A cmd: %commands.effect.success.removed.all [A] |
| `heal_cmd` | ✔ | `heal_cmd` | コマンドで全回復（/effect @s instant_health 1 255 true） | @A cmd: %commands.effect.success [%potion.heal, 255, A, 0] |
| `feed_cmd` | ✔ | `feed_cmd` | コマンドで満腹にする（/effect @s saturation 1 255 true） | @A cmd: %commands.effect.success [%potion.saturation, 255, A, 0] |
| `spawnpoint_here` | ✔ | `spawnpoint_here` | ここをリスポーン地点にする（/spawnpoint @s ~ ~ ~） | @A cmd: %commands.spawnpoint.success.single [A, 0, -60, 0] |
| `worldspawn_here` | ✔ | `worldspawn_here` | ここを世界のスポーン地点にする（/setworldspawn ~ ~ ~） | @A cmd: %commands.setworldspawn.success [0, -60, 0] |
| `daylock_on` | ✔ | `daylock_on` | 昼で時間を止める（/daylock true） | @A %commands.always.day.locked [] |
| `daylock_off` | ✔ | `daylock_off` | 時間を動かす（/daylock false） | @A %commands.always.day.unlocked [] |
| `list_players` | ✔ | `list_players` | 参加者一覧（/list）（/list） | @A cmd: %commands.players.list [1, 100] |
| `camera_reset` | ✔ | `camera_reset` | カメラを元に戻す（/camera @s clear） | @A cmd: %commands.camera.success [A] |
| `hud_hide` | ✔ | `hud_hide` | HUD を全部隠す（/hud @s hide all） | @A cmd: %commands.hud.success |
| `hud_show` | ✔ | `hud_show` | HUD を元に戻す（/hud @s reset all） | @A cmd: %commands.hud.success |
| `give_self` | ✔ | `give_self <item> [b]` | 自分にアイテムを出す（/give）（/give） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:diamond*2 player=A slot=0 |
| `xp_add` | ✔ | `xp_add [a]` | 経験値を足す（/xp） | @A cmd: %commands.xp.success [10, A] |
| `xp_levels` | ✔ | `xp_levels [a]` | レベルを足す（/xp） |  |
| `effect_self` | ✔ | `effect_self <effect> [b] [c]` | 自分に効果を付ける（/effect） | EV after.effectAdd effect=minecraft:speed/1/199 entity=A |
| `enchant_held` | ✔ | `enchant_held <arg> [b]` | 手の物にエンチャント（/enchant）（/enchant） | @A cmd: %commands.give.success [Iron Sword, 1, A] |
| `tp_xyz` | ✔ | `tp_xyz <x> <y> <z>` | 座標へテレポート（/tp） |  |
| `tp_to` | ✔ | `tp_to <arg>` | その人のところへテレポート（/tp） |  |
| `tp_here` | ✔ | `tp_here <arg>` | その人を自分のところへ呼ぶ（/tp） |  |
| `summon_mob` | ✔ | `summon_mob <arg>` | 目の前にモブを出す（/summon）（/summon） | EV after.entitySpawn cause=Spawned entity=minecraft:cow |
| `setblock_at` | ✔ | `setblock_at <x> <y> <z> <block>` | ブロックを置く（/setblock）（/setblock） |  |
| `fill_blocks` | ✔ | `fill_blocks <x1> <y1> <z1> <x2> <y2> <z2> <block>` | 範囲を埋める（/fill）（/fill） |  |
| `locate_structure` | ✔ | `locate_structure <arg>` | 一番近い構造物を探す（/locate） | @A cmd failed: %commands.locate.structure.fail.nostructurefound |
| `locate_biome` | ✔ | `locate_biome <arg>` | 一番近いバイオームを探す（/locate） | @A cmd: %commands.locate.biome.success [minecraft:plains, -32, -60, -32, 45] |
| `say_all` | ✔ | `say_all <arg>` | 全員に言う（/say）（/say） | @A announce: [A] hello |
| `title_self` | ✔ | `title_self <arg>` | 自分にタイトル表示（/title） | @A title: Hi |
| `playsound_self` | ✔ | `playsound_self <arg>` | 自分に音を鳴らす（/playsound） | @A cmd: %commands.playsound.success.single [random.orb, A] |
| `particle_here` | ✔ | `particle_here <arg>` | パーティクルを出す（/particle） | @A cmd: %commands.spawnParticleEmitter.success [minecraft:heart_particle] |
| `tag_self` | ✔ | `tag_self <arg>` | 自分にタグを付ける（/tag） |  |
| `untag_self` | ✔ | `untag_self <arg>` | 自分のタグを外す（/tag） |  |
| `score_set` | ✔ | `score_set <arg> [b]` | スコアを設定（/scoreboard） |  |
| `score_add` | ✔ | `score_add <arg> [b]` | スコアを足す（/scoreboard） |  |
| `run_function` | ✔ | `run_function <arg>` | ファンクションを実行（/function） | @A cmd: %commands.function.success [1] |
| `scriptevent_send` | ✔ | `scriptevent_send <arg> <arg2>` | スクリプトイベントを送る（/scriptevent） |  |
| `time_add` | ✔ | `time_add [a]` | 時間を進める（/time） |  |
| `kick_player` | ✔ | `kick_player <arg> <arg2>` | プレイヤーをキック（/kick） | EV after.playerLeave playerId=-8589934587 playerName=B |
| `op_player` | ✔ | `op_player <arg>` | OP にする（/op） | @A cmd failed: %commands.generic.error.permissions [op] |
| `deop_player` | ✔ | `deop_player <arg>` | OP を外す（/deop） | @A cmd failed: %commands.generic.error.permissions [deop] |
| `rule_keep_inventory` | ✔ | `rule_keep_inventory [on|off]` | ワールド設定の「持ち物を保持」を切り替える（keepinventory） | EV after.gameRuleChange rule=keepInventory value=true |
| `rule_daylight_cycle` | ✔ | `rule_daylight_cycle [on|off]` | ワールド設定の「昼夜の循環」を切り替える（dodaylightcycle） | EV after.gameRuleChange rule=doDayLightCycle value=true |
| `rule_weather_cycle` | ✔ | `rule_weather_cycle [on|off]` | ワールド設定の「天候の変化」を切り替える（doweathercycle） | EV after.gameRuleChange rule=doWeatherCycle value=true |
| `rule_mob_spawning` | ✔ | `rule_mob_spawning [on|off]` | ワールド設定の「モブのスポーン」を切り替える（domobspawning） | EV after.gameRuleChange rule=doMobSpawning value=true |
| `rule_fire_tick` | ✔ | `rule_fire_tick [on|off]` | ワールド設定の「火の延焼」を切り替える（dofiretick） | EV after.gameRuleChange rule=doFireTick value=true |
| `rule_mob_griefing` | ✔ | `rule_mob_griefing [on|off]` | ワールド設定の「モブによる破壊」を切り替える（mobgriefing） | EV after.gameRuleChange rule=mobGriefing value=false |
| `rule_show_coordinates` | ✔ | `rule_show_coordinates [on|off]` | ワールド設定の「座標を表示」を切り替える（showcoordinates） | EV after.gameRuleChange rule=showCoordinates value=true |
| `rule_natural_regen` | ✔ | `rule_natural_regen [on|off]` | ワールド設定の「自然再生」を切り替える（naturalregeneration） | EV after.gameRuleChange rule=naturalRegeneration value=false |
| `rule_pvp` | ✔ | `rule_pvp [on|off]` | ワールド設定の「PvP」を切り替える（pvp） | EV after.gameRuleChange rule=pvp value=false |
| `rule_tnt_explodes` | ✔ | `rule_tnt_explodes [on|off]` | ワールド設定の「TNT の爆発」を切り替える（tntexplodes） | EV after.gameRuleChange rule=tntExplodes value=false |
| `rule_fall_damage` | ✔ | `rule_fall_damage [on|off]` | ワールド設定の「落下ダメージ」を切り替える（falldamage） | EV after.gameRuleChange rule=fallDamage value=false |
| `rule_fire_damage` | ✔ | `rule_fire_damage [on|off]` | ワールド設定の「火のダメージ」を切り替える（firedamage） | EV after.gameRuleChange rule=fireDamage value=false |
| `rule_drowning_damage` | ✔ | `rule_drowning_damage [on|off]` | ワールド設定の「溺れるダメージ」を切り替える（drowningdamage） | EV after.gameRuleChange rule=drowningDamage value=false |
| `rule_freeze_damage` | ✔ | `rule_freeze_damage [on|off]` | ワールド設定の「凍えるダメージ」を切り替える（freezedamage） | EV after.gameRuleChange rule=freezeDamage value=false |
| `rule_immediate_respawn` | ✔ | `rule_immediate_respawn [on|off]` | ワールド設定の「即時リスポーン」を切り替える（doimmediaterespawn） | EV after.gameRuleChange rule=doImmediateRespawn value=true |
| `rule_insomnia` | ✔ | `rule_insomnia [on|off]` | ワールド設定の「不眠（ファントム）」を切り替える（doinsomnia） | EV after.gameRuleChange rule=doInsomnia value=true |
| `rule_mob_loot` | ✔ | `rule_mob_loot [on|off]` | ワールド設定の「モブのドロップ」を切り替える（domobloot） | EV after.gameRuleChange rule=doMobLoot value=false |
| `rule_tile_drops` | ✔ | `rule_tile_drops [on|off]` | ワールド設定の「ブロックのドロップ」を切り替える（dotiledrops） | EV after.gameRuleChange rule=doTileDrops value=false |
| `rule_entity_drops` | ✔ | `rule_entity_drops [on|off]` | ワールド設定の「エンティティのドロップ」を切り替える（doentitydrops） | EV after.gameRuleChange rule=doEntityDrops value=false |
| `rule_death_messages` | ✔ | `rule_death_messages [on|off]` | ワールド設定の「死亡メッセージ」を切り替える（showdeathmessages） | EV after.gameRuleChange rule=showDeathMessages value=false |
| `rule_random_tick_speed` | ✔ | `rule_random_tick_speed <n>` | ワールド設定のランダムティック速度（randomtickspeed） | EV after.gameRuleChange rule=randomTickSpeed value=3 |

## query

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `held` | ✔ | `held` | 手に持っている物（1 行で答える） | @A held: nothing (slot 0) |
| `count` | ✔ | `count <item>` | その品を何個持っているか（1 行で答える） | @A count: dirt 64 |
| `free_slots` | ✔ | `free_slots` | 持ち物の空き欄の数（1 行で答える） | @A free_slots: 36 |
| `worn` | ✔ | `worn` | 着ている防具とオフハンド（1 行で答える） | @A worn: head:- chest:- legs:- feet:- offhand:- |
| `xp` | ✔ | `xp` | レベルと次までの進み具合（1 行で答える） | @A xp: level 0 progress 0% |
| `effects` | ✔ | `effects` | 今かかっている効果（残り秒）（1 行で答える） | @A effects: regeneration 256 1s |
| `clock` | ✔ | `clock` | ゲーム内の時刻（昼・夜）（1 行で答える） | @A clock: 6000 day (day 0) |
| `sky` | ✔ | `sky` | 天気（晴れ・雨・雷雨）（1 行で答える） | @A sky: clear |
| `where` | ✔ | `where` | 座標・次元・向いている方角（1 行で答える） | @A where: 0.5 -60.0 0.5 overworld facing south |
| `facing` | ✔ | `facing` | 向いている方角と角度（1 行で答える） | @A facing: south (yaw 0 pitch 0) |
| `ground` | ✔ | `ground` | 足元のブロック（1 行で答える） | @A ground: grass_block at 0 -61 0 |
| `scan_blocks` | ✔ | `scan_blocks [radius]` | 周りに知っているブロックの種類と数（1 行で答える） | @A scan_blocks: dirt*162 grass_block*81 bedrock*81 |
| `find` | ✔ | `find <block> [radius]` | 知っている一番近いそのブロックの場所（1 行で答える） | @A find: crafting_table@3,-60,3 (4) |
| `find_mob` | ✔ | `find_mob <mob>` | 一番近いその生き物の場所と距離（1 行で答える） | @A find_mob: cow@0.5,-60.0,2.5 (2.0) |
| `who` | ✔ | `who` | 参加しているプレイヤー（1 行で答える） | @A who: A |
| `screen` | ✔ | `screen` | 今開いている画面（1 行で答える） | @A screen: none |
| `hotbar_list` | ✔ | `hotbar_list` | ホットバーの中身（* が選択中）（1 行で答える） | @A hotbar_list: 0*:- 1:- 2:- 3:- 4:- 5:- 6:- 7:- 8:- |
| `dimension` | ✔ | `dimension` | 今いる次元（1 行で答える） | @A dimension: overworld |
| `recipe` | ✔ | `recipe <item>` | そのアイテムのクラフトの材料（レシピ本の中身）（1 行で答える） | @A recipe: 4 torch <- 1 charcoal + 1 stick / 4 torch <- 1 coal + 1 stick / 4 torch <- 1 #coals + 1 stick |
| `can_craft` | ✔ | `can_craft <item> [n]` | 今の持ち物で作れるか、足りない物（1 行で答える） | @A can_craft: no: missing 1 charcoal |
| `recipes_all` | ✔ | `recipes_all [word]` | サーバーが送ってきた全レシピを 1 行ずつ（作業台・石切台・鍛冶台） | @A R bread*1 crafting_table 3x1 wheat*3 |

## craft

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `make_sticks` | ✔ | `make_sticks [times]` | 棒を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:stick*4 player=A slot=1 |
| `make_crafting_table` | ✔ | `make_crafting_table [times]` | 作業台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Inventory itemStack=minecraft:crafting_table*16 player=A slot=10 |
| `make_torches` | ✔ | `make_torches [times]` | 松明を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:torch*4 -> slot 2 |
| `make_chest` | ✔ | `make_chest [times]` | チェストを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:chest*1 player=A slot=2 |
| `make_furnace` | ✔ | `make_furnace [times]` | かまどを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:furnace*1 player=A slot=2 |
| `make_bed` | ✔ | `make_bed [times]` | ベッドを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bed*1 player=A slot=3 |
| `make_boat` | ✔ | `make_boat [times]` | ボートを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:oak_boat*1 player=A slot=2 |
| `make_bread` | ✔ | `make_bread [times]` | パンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:bread*1 -> slot 2 |
| `make_bucket` | ✔ | `make_bucket [times]` | バケツを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bucket*1 player=A slot=2 |
| `make_shield` | ✔ | `make_shield [times]` | 盾を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:shield*1 player=A slot=3 |
| `make_bow` | ✔ | `make_bow [times]` | 弓を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bow*1 player=A slot=3 |
| `make_arrows` | ✔ | `make_arrows [times]` | 矢を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:arrow*4 -> slot 4 |
| `make_ladder` | ✔ | `make_ladder [times]` | はしごを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:ladder*3 player=A slot=2 |
| `make_fence` | ✔ | `make_fence [times]` | フェンスを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:oak_fence*3 -> slot 3 |
| `make_fence_gate` | ✔ | `make_fence_gate [times]` | フェンスゲートを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:fence_gate*1 player=A slot=3 |
| `make_door` | ✔ | `make_door [times]` | ドアを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:wooden_door*3 player=A slot=2 |
| `make_trapdoor` | ✔ | `make_trapdoor [times]` | トラップドアを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:trapdoor*2 player=A slot=2 |
| `make_sign` | ✔ | `make_sign [times]` | 看板を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:oak_sign*3 player=A slot=3 |
| `make_bowl` | ✔ | `make_bowl [times]` | ボウルを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bowl*4 player=A slot=2 |
| `make_paper` | ✔ | `make_paper [times]` | 紙を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:paper*3 player=A slot=2 |
| `make_book` | ✔ | `make_book [times]` | 本を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:book*1 -> slot 2 |
| `make_bookshelf` | ✔ | `make_bookshelf [times]` | 本棚を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:bookshelf*1 player=A slot=3 |
| `make_enchanting_table` | ✔ | `make_enchanting_table [times]` | エンチャントテーブルを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:enchanting_table*1 player=A slot=4 |
| `make_anvil` | ✔ | `make_anvil [times]` | 金床を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:anvil*1 -> slot 3 |
| `make_brewing_stand` | ✔ | `make_brewing_stand [times]` | 醸造台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:brewing_stand*1 player=A slot=3 |
| `make_cauldron` | ✔ | `make_cauldron [times]` | 大釜を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:cauldron*1 -> slot 2 |
| `make_hopper` | ✔ | `make_hopper [times]` | ホッパーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:hopper*1 -> slot 3 |
| `make_piston` | ✔ | `make_piston [times]` | ピストンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:piston*1 player=A slot=5 |
| `make_sticky_piston` | ✔ | `make_sticky_piston [times]` | 粘着ピストンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:sticky_piston*1 -> slot 2 |
| `make_rails` | ✔ | `make_rails [times]` | レールを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:rail*16 player=A slot=3 |
| `make_powered_rail` | ✔ | `make_powered_rail [times]` | パワードレールを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:golden_rail*6 -> slot 4 |
| `make_minecart` | ✔ | `make_minecart [times]` | トロッコを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:minecart*1 -> slot 2 |
| `make_tnt` | ✔ | `make_tnt [times]` | TNTを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:tnt*1 -> slot 3 |
| `make_lantern` | ✔ | `make_lantern [times]` | ランタンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:lantern*1 player=A slot=3 |
| `make_campfire` | ✔ | `make_campfire [times]` | 焚き火を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:campfire*1 player=A slot=4 |
| `make_compass` | ✔ | `make_compass [times]` | コンパスを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:compass*1 -> slot 3 |
| `make_clock` | ✔ | `make_clock [times]` | 時計を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:clock*1 -> slot 3 |
| `make_map` | ✔ | `make_map [times]` | 空の地図を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:empty_map*1 -> slot 3 |
| `make_golden_apple` | ✔ | `make_golden_apple [times]` | 金のリンゴを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:golden_apple*1 -> slot 3 |
| `make_golden_carrot` | ✔ | `make_golden_carrot [times]` | 金のニンジンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:golden_carrot*1 player=A slot=3 |
| `make_cake` | ✔ | `make_cake [times]` | ケーキを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:cake*1 player=A slot=1 |
| `make_bone_meal` | ✔ | `make_bone_meal [times]` | 骨粉を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:bone_meal*3 -> slot 1 |
| `make_firework` | ✔ | `make_firework [times]` | ロケット花火を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:firework_rocket*3 -> slot 2 |
| `make_shears` | ✔ | `make_shears [times]` | ハサミを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:shears*1 -> slot 1 |
| `make_flint_and_steel` | ✔ | `make_flint_and_steel [times]` | 火打石と打ち金を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:flint_and_steel*1 -> slot 2 |
| `make_fishing_rod` | ✔ | `make_fishing_rod [times]` | 釣り竿を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:fishing_rod*1 -> slot 3 |
| `make_lead` | ✔ | `make_lead [times]` | リードを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:lead*2 -> slot 3 |
| `make_item_frame` | ✔ | `make_item_frame [times]` | 額縁を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:frame*1 -> slot 3 |
| `make_painting` | ✔ | `make_painting [times]` | 絵画を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:painting*1 -> slot 3 |
| `make_armor_stand` | ✔ | `make_armor_stand [times]` | 防具立てを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:armor_stand*1 player=A slot=3 |
| `make_glass_pane` | ✔ | `make_glass_pane [times]` | 板ガラスを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:glass_pane*16 -> slot 2 |
| `make_iron_bars` | ✔ | `make_iron_bars [times]` | 鉄格子を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:iron_bars*16 -> slot 2 |
| `make_barrel` | ✔ | `make_barrel [times]` | 樽を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:barrel*1 player=A slot=3 |
| `make_smoker` | ✔ | `make_smoker [times]` | 燻製器を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:smoker*1 player=A slot=3 |
| `make_blast_furnace` | ✔ | `make_blast_furnace [times]` | 溶鉱炉を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:blast_furnace*1 player=A slot=4 |
| `make_composter` | ✔ | `make_composter [times]` | コンポスターを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:composter*1 -> slot 2 |
| `make_lectern` | ✔ | `make_lectern [times]` | 書見台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:lectern*1 player=A slot=3 |
| `make_loom` | ✔ | `make_loom [times]` | 機織り機を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:loom*1 player=A slot=2 |
| `make_grindstone` | ✔ | `make_grindstone [times]` | 砥石を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:grindstone*1 player=A slot=4 |
| `make_stonecutter` | ✔ | `make_stonecutter [times]` | 石切台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:stonecutter_block*1 -> slot 3 |
| `make_smithing_table` | ✔ | `make_smithing_table [times]` | 鍛冶台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:smithing_table*1 player=A slot=3 |
| `make_cartography_table` | ✔ | `make_cartography_table [times]` | 製図台を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:cartography_table*1 -> slot 3 |
| `make_jukebox` | ✔ | `make_jukebox [times]` | ジュークボックスを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:jukebox*1 player=A slot=3 |
| `make_noteblock` | ✔ | `make_noteblock [times]` | 音符ブロックを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:noteblock*1 player=A slot=3 |
| `make_beacon` | ✔ | `make_beacon [times]` | ビーコンを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:beacon*1 -> slot 4 |
| `make_ender_chest` | ✔ | `make_ender_chest [times]` | エンダーチェストを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:ender_chest*1 -> slot 3 |
| `make_crossbow` | ✔ | `make_crossbow [times]` | クロスボウを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:crossbow*1 player=A slot=5 |
| `make_spyglass` | ✔ | `make_spyglass [times]` | 望遠鏡を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:spyglass*1 player=A slot=3 |
| `make_brush` | ✔ | `make_brush [times]` | ブラシを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:brush*1 -> slot 4 |
| `make_scaffolding` | ✔ | `make_scaffolding [times]` | 足場を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:scaffolding*6 -> slot 3 |
| `make_redstone_torch` | ✔ | `make_redstone_torch [times]` | レッドストーントーチを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:redstone_torch*1 player=A slot=2 |
| `make_repeater` | ✔ | `make_repeater [times]` | リピーターを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:repeater*1 -> slot 4 |
| `make_comparator` | ✔ | `make_comparator [times]` | コンパレーターを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:comparator*1 -> slot 4 |
| `make_lever` | ✔ | `make_lever [times]` | レバーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:lever*1 -> slot 2 |
| `make_observer` | ✔ | `make_observer [times]` | オブザーバーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:observer*1 -> slot 4 |
| `make_dispenser` | ✔ | `make_dispenser [times]` | ディスペンサーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:dispenser*1 -> slot 1 |
| `make_dropper` | ✔ | `make_dropper [times]` | ドロッパーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:dropper*1 player=A slot=3 |
| `make_target` | ✔ | `make_target [times]` | 的を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:target*1 -> slot 3 |
| `make_daylight_detector` | ✔ | `make_daylight_detector [times]` | 日照センサーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:daylight_detector*1 player=A slot=4 |
| `make_trapped_chest` | ✔ | `make_trapped_chest [times]` | トラップチェストを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | @A crafted minecraft:trapped_chest*1 -> slot 2 |
| `make_pumpkin_pie` | ✔ | `make_pumpkin_pie [times]` | パンプキンパイを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:pumpkin_pie*1 player=A slot=3 |
| `make_cookie` | ✔ | `make_cookie [times]` | クッキーを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:cookie*8 player=A slot=3 |
| `make_sugar` | ✔ | `make_sugar [times]` | 砂糖を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:sugar_cane*16 player=A slot=0 |
| `make_mushroom_stew` | ✔ | `make_mushroom_stew [times]` | キノコシチューを作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:mushroom_stew*1 player=A slot=3 |
| `make_carrot_on_a_stick` | ✔ | `make_carrot_on_a_stick [times]` | ニンジン付きの棒を作る（材料が足りなければ途中の物も作り、3x3 なら作業台を使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:carrot_on_a_stick*1 player=A slot=0 |
| `make` | ✔ | `make <item> [times]` | そのアイテムを作る（途中の材料も作る。3x3 は近くの作業台か持っている作業台を置いて使う） | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:stick*4 player=A slot=0 |
| `make_planks` | ✔ | `make_planks [times]` | 持っている原木から板材を作る | @A crafted minecraft:oak_planks*4 -> slot 0 |
| `make_pickaxe` | ✔ | `make_pickaxe` | 持っている一番良い素材でツルハシを作る | @A crafted minecraft:iron_pickaxe*1 -> slot 0 |
| `make_axe` | ✔ | `make_axe` | 持っている一番良い素材で斧を作る | @A crafted minecraft:iron_axe*1 -> slot 0 |
| `make_shovel` | ✔ | `make_shovel` | 持っている一番良い素材でシャベルを作る | @A crafted minecraft:iron_shovel*1 -> slot 1 |
| `make_sword` | ✔ | `make_sword` | 持っている一番良い素材で剣を作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:iron_sword*1 player=A slot=3 |
| `make_hoe` | ✔ | `make_hoe` | 持っている一番良い素材でクワを作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:iron_hoe*1 player=A slot=1 |
| `make_helmet` | ✔ | `make_helmet` | 持っている一番良い素材でヘルメットを作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:iron_helmet*1 player=A slot=2 |
| `make_chestplate` | ✔ | `make_chestplate` | 持っている一番良い素材でチェストプレートを作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:iron_chestplate*1 player=A slot=0 |
| `make_leggings` | ✔ | `make_leggings` | 持っている一番良い素材でレギンスを作る | @A crafted minecraft:iron_leggings*1 -> slot 2 |
| `make_boots` | ✔ | `make_boots` | 持っている一番良い素材でブーツを作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:iron_boots*1 player=A slot=2 |
| `make_tools` | ✔ | `make_tools [wooden|stone|copper|iron|golden|diamond]` | その素材の道具一式（ツルハシ・斧・シャベル・剣・クワ）を作る | EV after.playerInventoryItemChange beforeItemStack=- inventoryType=Hotbar itemStack=minecraft:stone_pickaxe*1 player=A slot=3 |
| `make_armor` | ✔ | `make_armor [leather|copper|iron|golden|diamond]` | その素材の防具一式を作る | @A crafted minecraft:iron_boots*1 -> slot 0 |

## furnace

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `smelt_iron` | ✔ | `smelt_iron [x y z] [n]` | 鉄の原石を製錬して鉄インゴット（近くのかまどか、持っているかまどを置いて） | @A smelt_iron: 1 out |
| `smelt_gold` | ✔ | `smelt_gold [x y z] [n]` | 金の原石を製錬して金インゴット（近くのかまどか、持っているかまどを置いて） | @A smelt_gold: 1 out |
| `smelt_copper` | ✔ | `smelt_copper [x y z] [n]` | 銅の原石を製錬して銅インゴット（近くのかまどか、持っているかまどを置いて） | @A smelt_copper: 1 out |
| `make_glass` | ✔ | `make_glass [x y z] [n]` | 砂を焼いてガラス（近くのかまどか、持っているかまどを置いて） | @A make_glass: 1 out |
| `make_charcoal` | ✔ | `make_charcoal [x y z] [n]` | 原木を焼いて木炭（近くのかまどか、持っているかまどを置いて） | @A make_charcoal: 1 out |
| `make_stone` | ✔ | `make_stone [x y z] [n]` | 丸石を焼いて石（近くのかまどか、持っているかまどを置いて） | @A make_stone: 1 out |
| `make_smooth_stone` | ✔ | `make_smooth_stone [x y z] [n]` | 石を焼いて滑らかな石（近くのかまどか、持っているかまどを置いて） | @A make_smooth_stone: 1 out |
| `make_brick` | ✔ | `make_brick [x y z] [n]` | 粘土玉を焼いてレンガ（近くのかまどか、持っているかまどを置いて） | @A make_brick: 1 out |
| `make_dried_kelp` | ✔ | `make_dried_kelp [x y z] [n]` | 昆布を焼いて乾燥した昆布（近くのかまどか、持っているかまどを置いて） | @A make_dried_kelp: 1 out |
| `make_green_dye` | ✔ | `make_green_dye [x y z] [n]` | サボテンを焼いて緑色の染料（近くのかまどか、持っているかまどを置いて） | @A make_green_dye: 1 out |
| `make_lime_dye` | ✔ | `make_lime_dye [x y z] [n]` | シーピクルスを焼いて黄緑色の染料（近くのかまどか、持っているかまどを置いて） | @A make_lime_dye: 1 out |
| `make_popped_chorus` | ✔ | `make_popped_chorus [x y z] [n]` | コーラスフルーツを焼いて焼いたコーラスフルーツ（近くのかまどか、持っているかまどを置いて） | @A make_popped_chorus: 1 out |
| `make_netherite_scrap` | ✔ | `make_netherite_scrap [x y z] [n]` | 古代の残骸を焼いてネザライトの欠片（近くのかまどか、持っているかまどを置いて） | @A make_netherite_scrap: 1 out |
| `dry_sponge` | ✔ | `dry_sponge [x y z] [n]` | 濡れたスポンジを乾かす（近くのかまどか、持っているかまどを置いて） | @A dry_sponge: 1 out |
| `make_nether_brick` | ✔ | `make_nether_brick [x y z] [n]` | ネザーラックを焼いてネザーレンガ（近くのかまどか、持っているかまどを置いて） | @A make_nether_brick: 1 out |
| `make_terracotta` | ✔ | `make_terracotta [x y z] [n]` | 粘土ブロックを焼いてテラコッタ（近くのかまどか、持っているかまどを置いて） | @A make_terracotta: 1 out |
| `make_deepslate` | ✔ | `make_deepslate [x y z] [n]` | 深層岩の丸石を焼いて深層岩（近くのかまどか、持っているかまどを置いて） | @A make_deepslate: 1 out |
| `smelt_ores` | ✔ | `smelt_ores [x y z]` | 持っている原石を全部製錬する | @A container blast_furnace: 0:minecraft:raw_iron*16 1:minecraft:coal*1 2:minecraft:iron_ingot*1 |
| `cook_meat` | ✔ | `cook_meat [x y z]` | 持っている生の肉・魚を全部焼く | @A container smoker: 0:minecraft:beef*16 1:minecraft:coal*1 2:minecraft:cooked_beef*1 |

## brew

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `brew_awkward` | ✔ | `brew_awkward [x y z]` | 奇妙なポーションを醸造する（nether_wart） | @A brew_awkward: 1/1 steps |
| `brew_swiftness` | ✔ | `brew_swiftness [x y z]` | 移動速度上昇のポーションを醸造する（nether_wart → sugar） | @A brew_swiftness: 2/2 steps |
| `brew_slowness` | ✔ | `brew_slowness [x y z]` | 移動速度低下のポーションを醸造する（nether_wart → sugar → fermented_spider_eye） | @A brew_slowness: 3/3 steps |
| `brew_leaping` | ✔ | `brew_leaping [x y z]` | 跳躍力上昇のポーションを醸造する（nether_wart → rabbit_foot） | @A brew_leaping: 2/2 steps |
| `brew_strength` | ✔ | `brew_strength [x y z]` | 攻撃力上昇のポーションを醸造する（nether_wart → blaze_powder） | @A brew_strength: 2/2 steps |
| `brew_healing` | ✔ | `brew_healing [x y z]` | 治癒のポーションを醸造する（nether_wart → glistering_melon_slice） | @A brew_healing: 2/2 steps |
| `brew_harming` | ✔ | `brew_harming [x y z]` | 負傷のポーションを醸造する（nether_wart → glistering_melon_slice → fermented_spider_eye） | @A brew_harming: 3/3 steps |
| `brew_poison` | ✔ | `brew_poison [x y z]` | 毒のポーションを醸造する（nether_wart → spider_eye） | @A brew_poison: 2/2 steps |
| `brew_regeneration` | ✔ | `brew_regeneration [x y z]` | 再生能力のポーションを醸造する（nether_wart → ghast_tear） | @A brew_regeneration: 2/2 steps |
| `brew_fire_resistance` | ✔ | `brew_fire_resistance [x y z]` | 耐火のポーションを醸造する（nether_wart → magma_cream） | @A brew_fire_resistance: 2/2 steps |
| `brew_water_breathing` | ✔ | `brew_water_breathing [x y z]` | 水中呼吸のポーションを醸造する（nether_wart → pufferfish） | @A brew_water_breathing: 2/2 steps |
| `brew_night_vision` | ✔ | `brew_night_vision [x y z]` | 暗視のポーションを醸造する（nether_wart → golden_carrot） | @A brew_night_vision: 2/2 steps |
| `brew_invisibility` | ✔ | `brew_invisibility [x y z]` | 透明化のポーションを醸造する（nether_wart → golden_carrot → fermented_spider_eye） | @A brew_invisibility: 3/3 steps |
| `brew_slow_falling` | ✔ | `brew_slow_falling [x y z]` | 低速落下のポーションを醸造する（nether_wart → phantom_membrane） | @A brew_slow_falling: 2/2 steps |
| `brew_turtle_master` | ✔ | `brew_turtle_master [x y z]` | タートルマスターのポーションを醸造する（nether_wart → turtle_helmet） | @A brew_turtle_master: 2/2 steps |
| `brew_weakness` | ✔ | `brew_weakness [x y z]` | 弱体化のポーションを醸造する（fermented_spider_eye） | @A brew_weakness: 1/1 steps |
| `brew_wind_charged` | ✔ | `brew_wind_charged [x y z]` | 風纏いのポーションを醸造する（nether_wart → breeze_rod） | @A brew_wind_charged: 2/2 steps |
| `brew_weaving` | ✔ | `brew_weaving [x y z]` | 機織りのポーションを醸造する（nether_wart → web） | @A brew_weaving: 2/2 steps |
| `brew_oozing` | ✔ | `brew_oozing [x y z]` | 滲出のポーションを醸造する（nether_wart → slime） | @A brew_oozing: 2/2 steps |
| `brew_infested` | ✔ | `brew_infested [x y z]` | 虫食いのポーションを醸造する（nether_wart → stone） | @A brew_infested: 2/2 steps |
| `brew_longer` | ✔ | `brew_longer [x y z]` | レッドストーンで効果時間を延ばす | @A brew_longer: 1/1 steps |
| `brew_stronger` | ✔ | `brew_stronger [x y z]` | グロウストーンダストで効果を強める | @A brew_stronger: 1/1 steps |
| `brew_splash` | ✔ | `brew_splash [x y z]` | 火薬でスプラッシュにする | @A brew_splash: 1/1 steps |
| `brew_lingering` | ✔ | `brew_lingering [x y z]` | ドラゴンブレスで残留にする | @A brew_lingering: 1/1 steps |

## screen

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `enchant_item` | ✔ | `enchant_item <item> x y z [0-2]` | エンチャントテーブルで付ける（既定は一番強い選択肢） | @A enchanted: shorten hot fiddle creature |
| `rename_item` | ✔ | `rename_item <item> x y z <name...>` | 金床で名前を付ける | @A anvil done: "Blade" |
| `repair_item` | ✔ | `repair_item <item> x y z [material]` | 金床でその素材で修理する | @A anvil done |
| `combine_items` | ✔ | `combine_items <item> x y z` | 金床で同じ道具 2 つを合わせる | @A anvil done |
| `apply_book` | ✔ | `apply_book <item> x y z` | 金床でエンチャントの本を付ける | @A anvil done |
| `disenchant` | ✔ | `disenchant <item> x y z` | 砥石でエンチャントを外す | @A ground |
| `grind_repair` | ✔ | `grind_repair <item> x y z` | 砥石で同じ道具 2 つを合わせて直す | @A ground |
| `stonecut` | ✔ | `stonecut <input> <output> x y z` | 石切台で切り出す | @A cut minecraft:stone_bricks*1 |
| `netherite_upgrade` | ✔ | `netherite_upgrade <item> x y z` | 鍛冶台でネザライトに強化する | @A smithed minecraft:netherite_sword |
| `trim_armor` | ✔ | `trim_armor <armor> <template> <material> x y z` | 鍛冶台で防具に装飾を付ける | @A smithed trim |
| `banner_pattern` | ✔ | `banner_pattern <pattern> x y z [dye]` | 機織り機で旗に模様を付ける | @A loom pattern bo |
| `beacon_power` | ✔ | `beacon_power <effect> x y z [second]` | ビーコンの効果を決める（インゴット等で払う） | @A beacon set speed |
| `write_book` | ✔ | `write_book <title> <text...>` | 本と羽根ペンに書いて署名する | EV after.playerInventoryItemChange beforeItemStack=minecraft:writable_book*1 inventoryType=Hotbar itemStack=minecraft:written_book*1 player=A slot=0 |
| `read_lectern` | ✔ | `read_lectern x y z [pages]` | 書見台の本を開いてページをめくる |  |
| `write_sign` | ✔ | `write_sign <sign> x y z <text...>` | 看板を置いて書く（| で改行） |  |
| `write_hanging_sign` | ✔ | `write_hanging_sign <sign> x y z <text...>` | 吊り看板を天井に掛けて書く |  |
| `map_new` | ✔ | `map_new x y z` | 製図台で紙から空の地図 | @A carto -> map |
| `map_locator` | ✔ | `map_locator x y z` | 製図台で紙とコンパスから位置付きの地図 | @A carto -> locator_map |
| `map_copy` | ✔ | `map_copy x y z` | 製図台で地図を複製 | @A carto -> copy |
| `map_zoom` | ✔ | `map_zoom x y z` | 製図台で地図を拡大 | @A carto -> zoom |
| `map_lock` | ✔ | `map_lock x y z` | 製図台で地図をガラス板で固定 | @A carto -> lock |

## mine

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `vein_mine` | ✔ | `vein_mine x y z` | つながった同じ鉱石（ブロック）を全部掘る | @A vein_mine: 3 blocks |
| `mine_ore` | ✔ | `mine_ore <coal|iron|copper|gold|redstone|lapis|diamond|emerald|quartz|ancient_debris> [radius]` | 知っている一番近いその鉱石を鉱脈ごと掘る | EV after.playerBreakBlock block=minecraft:air@2,-60,2 brokenBlockPermutation=minecraft:diamond_ore dimension=overworld itemStackAfterBreak=minecraft:iron_pickax |
| `mine_ores` | ✔ | `mine_ores [radius] [veins]` | 近くの鉱石を全部掘る | EV after.playerBreakBlock block=minecraft:air@2,-60,2 brokenBlockPermutation=minecraft:coal_ore dimension=overworld itemStackAfterBreak=minecraft:iron_pickaxe*1 |
| `mine_nearest` | ✔ | `mine_nearest <block> [radius]` | 知っている一番近いそのブロックを掘る | EV after.playerBreakBlock block=minecraft:air@2,-60,2 brokenBlockPermutation=minecraft:stone dimension=overworld itemStackAfterBreak=minecraft:iron_pickaxe*1 it |
| `mine_only` | ✔ | `mine_only <block> x1 y1 z1 x2 y2 z2` | 範囲の中のそのブロックだけ掘る | @A mine_only: 1 dirt |
| `dig_smart` | ✔ | `dig_smart x y z` | ブロックに合う道具に持ち替えて掘る | @A dig_smart: with iron_pickaxe |
| `dig_with` | ✔ | `dig_with <tool> x y z` | その道具で掘る | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:dirt dimension=overworld itemStackAfterBreak=minecraft:iron_shovel*1 item |
| `dig_by_hand` | ✔ | `dig_by_hand x y z` | 素手で掘る | EV after.playerBreakBlock block=minecraft:air@1,-60,1 brokenBlockPermutation=minecraft:dirt dimension=overworld itemStackAfterBreak=- itemStackBeforeBreak=- pla |
| `mine_3x3` | ✔ | `mine_3x3 [n]` | 3x3 のトンネルを掘り進む |  |
| `branch_mine` | ✔ | `branch_mine [branches] [length]` | 本坑から左右に枝坑を掘る | @A branch_mine: 2 branches |
| `quarry` | ✔ | `quarry x1 z1 x2 z2 depth` | 足元から下へ一層ずつ掘る | @A quarry: 4 blocks |
| `shaft_ladder` | ✔ | `shaft_ladder [depth]` | 真下に掘って壁にはしごを掛けながら下りる | @A shaft_ladder: 2 down |
| `gather` | ✔ | `gather <block> [n] [radius]` | 一番近いそのブロックを n 個掘って拾う | EV after.playerBreakBlock block=minecraft:air@0,-62,0 brokenBlockPermutation=minecraft:dirt dimension=overworld itemStackAfterBreak=minecraft:iron_shovel*1 item |
| `gather_wood` | ✔ | `gather_wood [trees] [radius]` | 近くの木を切り倒して原木を拾う | EV after.playerBreakBlock block=minecraft:air@3,-60,3 brokenBlockPermutation=minecraft:oak_log dimension=overworld itemStackAfterBreak=minecraft:iron_axe*1 item |

## fight

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `duel` | ✔ | `duel <player> [seconds]` | プレイヤーと PvP（相手の無敵 10 tick の終わりに当たるよう往復分早く振る・W タップ・跳んでクリティカル・背後の崖をふさぐ・落とされたらブロッククラッチ） |  |

## place

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `place_wall` | ✔ | `place_wall <item> x y z <side>` | 壁に付けて置く（side = 壁がある方角） |  |
| `place_ceiling` | ✔ | `place_ceiling <item> x y z` | 天井から吊るして置く |  |
| `place_top_slab` | ✔ | `place_top_slab <slab> x y z` | ハーフブロックを上付きに置く |  |
| `place_upside_stairs` | ✔ | `place_upside_stairs <stairs> x y z [dir]` | 階段を逆さに置く |  |
| `place_double_slab` | ✔ | `place_double_slab <slab> x y z` | ハーフブロックを 2 枚重ねる |  |
| `place_stairs` | ✔ | `place_stairs <stairs> x y z <dir>` | その方角へ上る向きで階段を置く |  |
| `place_facing` | ✔ | `place_facing <item> x y z <dir|up|down>` | その方を見ながら置く（チェスト・かまどは自分の方を向く） |  |
| `place_double_chest` | ✔ | `place_double_chest x y z [dir]` | チェストを 2 つ並べてラージチェストにする |  |
| `place_bed` | ✔ | `place_bed x y z [dir]` | その方角へ頭を向けてベッドを置く |  |
| `place_door` | ✔ | `place_door <door> x y z <dir> [left|right]` | ドアを置く（向きと蝶番の側） |  |
| `place_log` | ✔ | `place_log <log> x y z <x|y|z>` | 原木を横倒し・縦に置く |  |
| `place_candles` | ✔ | `place_candles <candle> x y z [n]` | ろうそくを 1 マスに n 本立てる |  |
| `place_pickles` | ✔ | `place_pickles x y z [n]` | シーピクルスを 1 マスに n 個 |  |
| `place_snow_layers` | ✔ | `place_snow_layers x y z [n]` | 雪を n 層積む |  |
| `place_turtle_eggs` | ✔ | `place_turtle_eggs x y z [n]` | カメの卵を n 個 |  |
| `place_end_crystal` | ✔ | `place_end_crystal x y z` | 黒曜石・岩盤の上にエンドクリスタルを置く | EV after.entitySpawn cause=Spawned entity=minecraft:ender_crystal |
| `place_repeater` | ✔ | `place_repeater x y z <dir> [delay 1-4]` | リピーターを置いて遅延を合わせる |  |
| `place_comparator` | ✔ | `place_comparator x y z <dir> [subtract]` | コンパレーターを置く（減算モードも） |  |
| `place_note` | ✔ | `place_note x y z [clicks 0-24]` | 音符ブロックを置いて音程を合わせる |  |
| `place_frame_item` | ✔ | `place_frame_item <item> x y z <side>` | 壁に額縁を掛けて品を入れる |  |
| `place_armor_stand_dressed` | ✔ | `place_armor_stand_dressed x y z <item...>` | 防具立てを置いて防具を着せる | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_helmet*1 itemStack=- player=A target=minecraft:armor_stand |
| `waterlog` | ✔ | `waterlog x y z` | ハーフブロック・階段・柵に水を入れる（水浸し） |  |

## redstone

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `repeater_delay` | ✔ | `repeater_delay x y z <1-4>` | リピーターの遅延をその値まで回す |  |
| `note_tune` | ✔ | `note_tune x y z [clicks]` | 音符ブロックを n 回クリックして音程を上げる | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:noteblock@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `step_plate` | ✔ | `step_plate x y z [ticks]` | 感圧板に乗って降りる | EV after.pressurePlatePush block=minecraft:stone_pressure_plate@0,-60,2 dimension=overworld previousRedstonePower=0 redstonePower=15 source=A |
| `trip_wire` | ✔ | `trip_wire x y z` | トリップワイヤーを踏んで通り抜ける | EV after.tripWireTrip block=minecraft:trip_wire@0,-60,2 dimension=overworld isPowered=true sources=[A] |
| `shoot_target` | ✔ | `shoot_target x y z [ticks]` | 的ブロックを弓で射る | EV after.targetBlockHit block=minecraft:target@0,-59,6 dimension=overworld hitVector=0.419,-58.536,6 previousRedstonePower=0 redstonePower=13 source=minecraft:a |
| `lever_pulse` | ✔ | `lever_pulse x y z [ticks]` | レバーを入れて少し後に戻す（パルス） | EV after.leverAction block=minecraft:lever@1,-60,1 dimension=overworld isPowered=false player=A |
| `disarm_tripwire` | ✔ | `disarm_tripwire x y z` | ハサミで糸を切って作動させずに外す | EV after.playerBreakBlock block=minecraft:air@0,-60,2 brokenBlockPermutation=minecraft:trip_wire dimension=overworld itemStackAfterBreak=minecraft:shears*1 item |

## vehicle

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `break_entity` | ✔ | `break_entity <boat|minecart|armor_stand|painting|end_crystal...> [hits]` | 乗り物・防具立てなどを叩いて壊す | EV after.entityHitEntity damagingEntity=A hitEntity=minecraft:armor_stand |
| `minecart_trip` | ✔ | `minecart_trip [ticks]` | トロッコに乗って進んで降りる | ST A riding=minecart |

## fluid

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `make_obsidian` | ✔ | `make_obsidian x y z` | 溶岩源に水をかけて黒曜石にし、水を汲み戻す |  |
| `infinite_water` | ✔ | `infinite_water x y z [dir]` | 水源を 1 マス空けて 2 つ置く（無限水源） |  |
| `drain_fill` | ✔ | `drain_fill <item> x1 y1 z1 x2 y2 z2` | 範囲の水・溶岩をブロックで埋める |  |
| `make_mud` | ✔ | `make_mud x y z` | 水のポーションを土に使って泥にする |  |

## deco

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `frame_put` | ✔ | `frame_put <item> x y z` | 額縁に品を入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:diamond*16 block=minecraft:frame@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemSt |
| `frame_rotate` | ✔ | `frame_rotate x y z [n]` | 額縁の中身を回す | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:frame@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `chiseled_put` | ✔ | `chiseled_put <book> x y z <slot 0-5>` | 模様入りの本棚のその段に本を入れる | EV after.playerInteractWithBlock beforeItemStack=minecraft:book*16 block=minecraft:chiseled_bookshelf@1,-60,1 blockFace=North faceLocation=0.833,0.25,0 isFirstE |
| `chiseled_take` | ✔ | `chiseled_take x y z <slot 0-5>` | 模様入りの本棚のその段から本を取る | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:chiseled_bookshelf@1,-60,1 blockFace=North faceLocation=0.833,0.25,0 isFirstEvent=true itemSt |
| `pot_take` | ✔ | `pot_take x y z` | 植木鉢の花を取り出す（素手） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:flower_pot@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `banner_mark` | ✔ | `banner_mark x y z` | 地図を持って旗をクリックする（Java 版では地図に旗の目印が付く。統合版 1.26 のサーバーは何もしない: クリックが届くまで） | EV after.itemStartUseOn block=minecraft:standing_banner@1,-60,1 blockFace=Up itemStack=minecraft:filled_map*1 source=A |
| `sign_ink` | ✔ | `sign_ink x y z` | イカスミで看板の光を消す | EV after.playerInteractWithBlock beforeItemStack=minecraft:ink_sac*16 block=minecraft:standing_sign@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=tru |
| `candle_cake` | ✔ | `candle_cake x y z` | ケーキにろうそくを立てる |  |
| `sign_dye` | ✔ | `sign_dye <dye> x y z` | 看板の文字を染める | EV after.playerInteractWithBlock beforeItemStack=minecraft:red_dye*16 block=minecraft:standing_sign@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=tru |
| `lectern_book` | ✔ | `lectern_book x y z` | 書見台に本を置く | EV after.playerInteractWithBlock beforeItemStack=minecraft:writable_book*1 block=minecraft:lectern@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true |
| `cauldron_dye` | ✔ | `cauldron_dye <dye> x y z` | 大釜の水を染める | EV after.playerInteractWithBlock beforeItemStack=minecraft:red_dye*16 block=minecraft:cauldron@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true ite |
| `cauldron_potion` | ✔ | `cauldron_potion x y z` | 大釜にポーションを注ぐ | EV after.playerInteractWithBlock beforeItemStack=minecraft:potion*1 block=minecraft:cauldron@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemS |
| `cauldron_arrows` | ✔ | `cauldron_arrows x y z` | ポーションの入った大釜で矢を浸す（効能付きの矢） | EV after.playerInteractWithBlock beforeItemStack=minecraft:arrow*16 block=minecraft:cauldron@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemS |
| `vault_key` | ✔ | `vault_key x y z` | 試練の鍵で保管庫を開ける | EV after.playerInteractWithBlock beforeItemStack=minecraft:trial_key*16 block=minecraft:vault@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true item |
| `vault_ominous` | ✔ | `vault_ominous x y z` | 不吉な試練の鍵で不吉な保管庫を開ける | EV after.playerInteractWithBlock beforeItemStack=minecraft:ominous_trial_key*16 block=minecraft:vault@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=t |
| `composter_take` | ✔ | `composter_take x y z` | 満杯のコンポスターから骨粉を取り出す | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:composter@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `firework_launch` | ✔ | `firework_launch x y z` | 地面からロケット花火を打ち上げる | EV after.entitySpawn cause=Spawned entity=minecraft:fireworks_rocket |
| `armor_stand_dress` | ✔ | `armor_stand_dress <item...>` | 防具立てに防具・品を着せる | EV after.playerInteractWithEntity beforeItemStack=minecraft:iron_helmet*1 itemStack=- player=A target=minecraft:armor_stand |

## open

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `open_trapped_chest` | ✔ | `open_trapped_chest [x y z]` | トラップチェストを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:trapped_chest@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_hopper` | ✔ | `open_hopper [x y z]` | ホッパーを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:hopper@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_dispenser` | ✔ | `open_dispenser [x y z]` | ディスペンサーを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:dispenser@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_dropper` | ✔ | `open_dropper [x y z]` | ドロッパーを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:dropper@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_blast_furnace` | ✔ | `open_blast_furnace [x y z]` | 溶鉱炉を開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:blast_furnace@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_smoker` | ✔ | `open_smoker [x y z]` | 燻製器を開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:smoker@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_brewing_stand` | ✔ | `open_brewing_stand [x y z]` | 醸造台を開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:brewing_stand@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_enchanting_table` | ✔ | `open_enchanting_table [x y z]` | エンチャントテーブルを開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:enchanting_table@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- pl |
| `open_grindstone` | ✔ | `open_grindstone [x y z]` | 砥石を開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:grindstone@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `open_stonecutter` | ✔ | `open_stonecutter [x y z]` | 石切台を開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:stonecutter_block@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- p |
| `open_cartography_table` | ✔ | `open_cartography_table [x y z]` | 製図台を開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:cartography_table@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- p |
| `open_smithing_table` | ✔ | `open_smithing_table [x y z]` | 鍛冶台を開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:smithing_table@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- play |
| `open_crafter` | ✔ | `open_crafter [x y z]` | クラフターを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:crafter@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_beacon` | ✔ | `open_beacon [x y z]` | ビーコンを開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:beacon@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- player=A |
| `open_lectern` | ✔ | `open_lectern [x y z]` | 書見台を開く（開いたまま。move / take などで使う） | EV after.playerInteractWithBlock beforeItemStack=minecraft:writable_book*1 block=minecraft:lectern@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true |
| `open_copper_chest` | ✔ | `open_copper_chest [x y z]` | 銅のチェストを開く（開いたまま。move / take などで使う） | EV after.blockContainerOpened block=minecraft:copper_chest@1,-60,1 dimension=overworld openSource={entity=A} |
| `open_command_block` | ✔ | `open_command_block [x y z]` | コマンドブロックを開く（開いたまま。move / take などで使う）（ゲームではクリエイティブのオペレーターだけ開ける） | EV after.playerInteractWithBlock beforeItemStack=- block=minecraft:command_block@1,-60,1 blockFace=Up faceLocation=0.5,0,0.5 isFirstEvent=true itemStack=- playe |
| `open_chest_boat` | ✔ | `open_chest_boat` | チェスト付きボートを開く | EV after.entityContainerOpened entity=minecraft:chest_boat openSource={entity=A} |
| `open_chest_minecart` | ✔ | `open_chest_minecart` | チェスト付きトロッコを開く | EV after.entityContainerOpened entity=minecraft:chest_minecart openSource={entity=A} |
| `open_hopper_minecart` | ✔ | `open_hopper_minecart` | ホッパー付きトロッコを開く | EV after.entityContainerOpened entity=minecraft:hopper_minecart openSource={entity=A} |

## goal

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `get` | ✔ | `get <item> [n] [xray] [avoid=block|mob,...]` | そのアイテムを手に入れる（無ければ木を切る・掘る・作る・焼く・倒す…を自分で計画して実行。見える物だけで探す。xray = サーバーが送った全ブロックを使う。avoid= その手段は使わない） | @A get: plan for 4 oak_planks: 1 steps, about 0m02s |
| `plan` | ✔ | `plan <item> [n]` | 手に入れる手順を今の持ち物と周りから計画して 1 手ずつ表示（実行はしない） | @A plan: 1 cake (ケーキ): 18 steps, about 56m49s |
| `rta` | ✔ | `rta <item>[+<item>*n...]|<challenge>|<verb>|list [word] [keep] [avoid=a,b] [xray] [hud]` | RTA: 持ち物を空にして、そのアイテム（+ で複数、*n で数）・企画（rta list: 道具一式・防具を着る・全色集め・1 スタック・ビンゴ・深さ・高さ・距離・ネザー…）・手書きの動作（要る物を集めてから実行）を達成するまでの時間を計る。スプリットは前の最速と比べ（±秒）、生成ワールドでは最速を .lab/rta-pb.json に残す。hud = 画面にタイマー | @A rta stick+crafting_table: done in 0m01s (4 steps) |

## generated

| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |
|---|---|---|---|---|
| `get_oak_planks` | ✔ | `get_oak_planks 4` | <item>を手に入れる（無ければ材料集めから自動で） | @A get: got 4 oak_planks in 0m00s (1 steps) |
| `get_stick` | ✔ | `get_stick 4` | <item>を手に入れる（無ければ材料集めから自動で） | @A get: got 4 stick in 0m00s (1 steps) |
| `rta_stick` | ✔ | `rta_stick keep` | <item>の RTA（持ち物を空にしてから入手までの時間を計り、手順ごとのスプリットも出す。keep = 今の持ち物から、avoid= 使わない手段） | @A rta_stick: done in 0m00s (1 steps) |
| `craft_torch` | ✔ | `craft_torch 4` | 持ち物から<item>を作る（部品から順に、要れば作業台を置いて） | @A craft_torch: made 4 torch (1 steps) |
| `craft_wooden_pickaxe` | ✔ | `craft_wooden_pickaxe` | 持ち物から<item>を作る（部品から順に、要れば作業台を置いて） | @A craft_wooden_pickaxe: made 1 wooden_pickaxe (3 steps) |
| `smelt_iron_ingot` | ✔ | `smelt_iron_ingot 1` | かまどで焼いて<item>にする（近くのかまど、無ければ持っているのを置く） | @A container furnace: 0:minecraft:raw_iron*1 1:minecraft:coal*1 2:minecraft:iron_ingot*1 |
| `mine_dirt` | ✔ | `mine_dirt 1` | 近くの<block>を合う道具で掘ってドロップを拾う | EV after.entitySpawn cause=Spawned entity=item:minecraft:dirt*1 |
| `find_crafting_table` | ✔ | `find_crafting_table` | 一番近い<block>のところへ歩いて行く（見当たらなければ探しに出る） | @A find_crafting_table: at 3 -60 3 |
| `place_dirt` | ✔ | `place_dirt` | <block>を目の前に置く（置くアイテムを持ち物から） | EV after.playerPlaceBlock block=minecraft:dirt@0,-60,1 dimension=overworld player=A |
| `hold_bread` | ✔ | `hold_bread` | <item>を手に持つ（ホットバーのキー、無ければ持ち物から移す） | @A hold_bread: holding bread |
| `drop_bread` | ✔ | `drop_bread 2` | <item>を捨てる（数の指定が無ければ全部） | @A drop_bread: dropped; 14 left |
| `kill_cow` | ✔ | `kill_cow 1` | 近くの<mob>を倒してドロップを拾う（見当たらなければ探す） | EV after.entityDie damageSource={cause=entityAttack damagingEntity=A} deadEntity=minecraft:cow |
| `goto_cow` | ✔ | `goto_cow` | 一番近い<mob>のところへ行く | @A goto_cow: next to the cow |
| `challenge_iron_tools` | ✔ | `challenge_iron_tools dry` | RTA 企画（common/challenges.cjs）: 道具・防具一式、全種類集め、1 スタック、ビンゴ 30 枚、深さ・高さ・距離、ネザー、ケーキを食べる、オオカミを手なずける…を持ち物ゼロから計る | @A challenge_iron_tools: 鉄の道具 5 種: 5 things; from nothing about 55 steps, 81m20s |
| `challenge_bingo_1` | ✔ | `challenge_bingo_1 dry` | RTA 企画（common/challenges.cjs）: 道具・防具一式、全種類集め、1 スタック、ビンゴ 30 枚、深さ・高さ・距離、ネザー、ケーキを食べる、オオカミを手なずける…を持ち物ゼロから計る | @A challenge_bingo_1: ビンゴ 1: 白色の羊毛・作業台・チェスト・ボウル・ランタン: 5 things; from nothing about 26 steps, 43m59s |
| `quest_breed_cow` | ✔ | `quest_breed_cow dry` | 手書きの動作を RTA に: 持ち物ゼロから、その動作に要る物を集め、相手の動物を探し、要るブロックを置いてから実行するまでを計る | @A quest_breed_cow: would get 2 wheat, find cow + cow, then breed_cow |
| `quest_hut` | ✔ | `quest_hut dry` | 手書きの動作を RTA に: 持ち物ゼロから、その動作に要る物を集め、相手の動物を探し、要るブロックを置いてから実行するまでを計る | @A quest_hut: would get 80 dirt, then hut dirt 4 4 |
