# sandbox-be (runtime only)

Script API と プレイヤーの動きを、実機で測った仮想世界で動かすサンドボックス（v1.15.0-colony.1）。
bds-lab は `sim`・`c2s --check`・`ts try` からこの実行部分を、`colony` から `src/colony/`（クラフターズコロニーの配布物: サイト・zip・level.dat・LevelDB・サブチャンク）を使う。

| 残しているもの | 中身 |
|---|---|
| `src/` | 本体（依存ゼロ）。入口は `src/index.js`（`runSandbox`・`compareCommands`）、配布物は `src/colony/` |
| `data/` | 実機で測った表（Script API・バニラ・物理・挙動） |
| `types/` | `index.d.ts` |

bds-lab で直したもの（上流へ返す候補）: `src/colony/` が本物のワールドを読めるように（LevelDB の圧縮 4 と内部キー・Bedrock の level.dat）、zip は Shift_JIS の名前を読み、展開先の外へ出る名前を拒み、CRC を確かめる。1 回の実行を約 2 倍速く（スクリプトを呼ばない tick の段は 1 回の時間切れつき呼び出しにまとめる: `src/vm/runtime/engine/tick.js`、実測データは読み直さずに文脈へ: `src/host/child.js`）。出る結果は同じ（見本 12 個で確かめた）。

外したもの: 学ぶ頭（`src/play/agent/`）・PvP（`src/play/pvp/`）・目標探し（`discover.js`）・物理の突き合わせ（`physics-compare.js`）は bds-lab から使わないので、別配布の `bds-lab-extras-<版>.zip` に入れてある（展開すれば元の場所に戻る）。
CLI・テスト・較正ツール・文書・例は上流にある: https://github.com/Au12jp/sandbox-be （MIT, `LICENSE`）。
