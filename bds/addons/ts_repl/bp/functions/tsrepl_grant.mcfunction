# ほかの人にも使ってもらう。自分に付けるだけなら tsrepl_start のほうが早い。
tag @s add tsrepl.owner
tag @s add tsrepl.admin
tellraw @s {"rawtext": [{"translate": "tsrepl.grant.done"}, {"text": "\n"}, {"translate": "tsrepl.grant.next"}]}
