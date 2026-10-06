# Fishing Cup

## Request
釣り大会：/lab:fish で 3 分間の大会が始まり、釣った魚の数をサイドバーに出して、終わったら 1 位にダイヤを 3 個配る

## Acceptance (one tests.txt `## ` section each)
- [x] /lab:fish で大会が始まり、釣った魚の数がサイドバーに出て、終わったら 1 位にダイヤ 3 個（## the contest counts caught fish on the sidebar and pays the winner）
- [x] 釣り竿で釣った魚だけを数える（もらった・拾った魚は数えない）（## fish that do not come from the rod do not count）
- [x] 大会は同時に 1 つだけ（## only one contest at a time）

## Guessed
<!-- values decided without asking -->
- 大会の長さは /lab:fish <秒>（既定 180 秒、10〜600）: 試験が 3 分待たずに済む
