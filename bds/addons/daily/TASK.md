# Daily Bonus

## Request
毎日ログインボーナス：その日初めて参加したらエメラルドを 1 個、7 日連続なら 5 個。連続日数は再起動しても残る

## Acceptance (one tests.txt `## ` section each)
- [x] その日初めて参加したらエメラルドを 1 個（## the first join of the day gives one emerald）
- [x] 同じ日の 2 回目の参加では何も出ない（## a second join on the same day gives nothing）
- [x] 連続日数は再起動しても残る（## the next day counts the streak, and it survives a restart）
- [x] 7 日連続なら 5 個（## the 7th day in a row gives five）
- [x] 1 日空いたら 1 日目からやり直し（## a missed day starts over）

## Guessed
<!-- values decided without asking -->
