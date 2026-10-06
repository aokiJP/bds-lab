# Shop

## Request
/lab:shop でフォームを開いてコインでアイテムを買える（パン 5、鉄インゴット 20、ダイヤ 100）。コインは右上に出し、足りなければ買えない。/lab:pay <相手> <額> でコインを送れる。初めて参加したら 50 コイン

## Acceptance (one tests.txt `## ` section each)
- [x] 初めて参加したら 50 コイン。コインは右上（サイドバー）に出る（## a new player starts with 50 coins on the sidebar）
- [x] /lab:shop のフォームでコインを払って買える（パン 5、鉄インゴット 20、ダイヤ 100）（## buying bread takes 5 coins and gives the bread）
- [x] コインが足りなければ買えない（## a diamond is refused when coins are short）
- [x] /lab:pay <相手> <額> でコインを送れる（## paying another player moves the coins）
- [x] 0 以下の額や自分あては断る（## no paying a negative or zero amount, or yourself）

## Guessed
<!-- values decided without asking -->
