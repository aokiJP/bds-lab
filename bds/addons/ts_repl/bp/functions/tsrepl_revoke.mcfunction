# 権限を外す。自分以外に向けるときは execute as で回すこと。
tag @s remove tsrepl.owner
tag @s remove tsrepl.admin
tellraw @s {"rawtext": [{"translate": "tsrepl.revoke.done"}]}
