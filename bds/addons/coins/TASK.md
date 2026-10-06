# Coins

## Request
/lab:coins でコインを1枚もらえる。1日1回まで

## Acceptance (one tests.txt `## ` section each)
- [x] /lab:coins でコイン（金塊）が 1 枚もらえる（## coin once a day）
- [x] 1 日 1 回まで。再起動しても今日の分は済んだまま、次の日はまたもらえる（## still claimed after a restart, a coin again the next day）

## Guessed
<!-- values decided without asking -->
- 1 日の区切りはサーバーの地方時の 0 時（UTC の 0 時ではない）
