# Warps

## Request
ワープ地点のmodを作って。OPが /setwarp <名前> で今いる場所をワープ地点にして、誰でも /warp <名前> でそこへ移動、/warps で一覧。/delwarp <名前> はOPだけ。ワープは再起動しても残るように。移動は10秒に1回まで。

## Acceptance (one tests.txt `## ` section each)
- [x] OPが /setwarp <名前> で今いる場所をワープ地点にして、誰でも /warp <名前> でそこへ移動、/warps で一覧
- [x] /delwarp <名前> はOPだけ
- [x] ワープは再起動しても残るように
- [x] 移動は10秒に1回まで

## Guessed
<!-- values decided without asking -->
- Messages in Japanese; warp names 1-32 chars, no spaces, case-insensitive (setting an existing name overwrites/moves it).
- Cooldown 10 s per player for everyone incl. OP, counted from the last successful /warp; kept in memory (reset by a server restart).
- Warp keeps position, dimension and facing; stored in plugins/warps/warps.json.
- /warps is open to everyone and shows coordinates. /warp and /setwarp need a player (console refused); /warps and /delwarp work from the console.
