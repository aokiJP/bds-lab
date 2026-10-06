# はじめる。これ 1 本で「使える状態」まで揃う。
# 権限を付ける → コンソールを渡す（持っていないときだけ）→ 献立を開く。
tag @s add tsrepl.owner
tag @s add tsrepl.admin
execute unless entity @s[hasitem={item=tsrepl:console}] run give @s tsrepl:console 1
tellraw @s {"rawtext": [{"translate": "tsrepl.start.done"}, {"text": "\n"}, {"translate": "tsrepl.start.hint"}]}
scriptevent tsrepl:open
