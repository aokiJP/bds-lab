---
name: fanout
description: 目標 1 行から、AI のサブエージェント（最大 10）に並行で分担させる司令塔の手順。計画 → 承認 1 回 → 決まったプロンプトで子を起動 → 範囲の検査 → 統合。人はプロンプトを書かない。「並行で」「分担して」「サブエージェントで」「/fanout」で使う。
---

# /fanout — 司令塔の手順（この順番だけ。飛ばさない・足さない）

引数 = 全体の目標。あなた（このセッション）が司令塔です。子への指示は必ず `node .fanout/fanout.mjs prompt <レーン>` の出力を**そのまま**渡す。自分でプロンプトを書かない・書き足さない（足したいことは plan.json の details / rules に書いて出し直す）。

## 0. 始める前の確認（どれかが ✘ なら直してから。直せなければ人に聞いて止まる）
- `git status --porcelain` が空（土台を固めるため。変更があれば人に「commit してよいか」を聞く）
- `node .fanout/fanout.mjs actions-off --check` が ✔（✘ なら `actions-off` して commit）
- `.fanout/plan.json` が無い（前の回が残っていたら人に聞く）

## 1. 計画（ここで頭を使う。子はここに書いたことしかしない）
1. `node .fanout/fanout.mjs new "<目標>"`
2. コードを読み、`.fanout/plan.json` の lanes を埋める。決まり:
   - レーンは 10 本まで。**少ないほど良い**: 1 ファイルに 3 本以上が集まるなら分け方を変える。
   - `owns`: ファイル（グロブ可）か「パス#関数1,関数2」。同じファイル・同じ関数を 2 本に持たせない。テストは各レーン専用の新しいファイル（例 `tests/<レーン>-offline.mjs`）を owns に入れる。
   - `test`: そのレーンが自分で回すコマンド（実機や秘密が要らないもの）。
   - `details`: やることを 3〜6 個、具体的に（関数名・期待する振る舞い・変えてはいけない振る舞い）。
   - `after`: 他のレーンの結果を使うレーンだけ（そのレーンは、前のものを統合した後の第 2 波で起動）。
   - 読むだけのレーン（`readonly: true`、`reviews` に見る観点、`target` に読む書くレーンの名前）は、書くレーンが終わってから起動する（プロンプトには record した枝の差分の見方が入る）。
   - `rules`: この回だけの約束（例: 実機が無いので偽の docker / adb で確かめる）。`finalTests`: 統合後に回す全体のテスト。
3. `node .fanout/fanout.mjs check` が ✔ になるまで直す。

## 2. 人の承認（1 回だけ）
レーンの表（名前・目標・owns・test・after）と、統合の順（`order`）と、確かめられないこと（実機など）を見せて、AskUserQuestion で「この計画で始める / 直す」を聞く。承認の後は、計画の外のことで人を止めない（止まる条件は下）。

## 3. 子を起動（第 1 波: after が空の書くレーン全部を、1 つのメッセージで並行に）
各レーン:
```
node .fanout/fanout.mjs worktree <レーン>   → 土台から作業フォルダ .claude/worktrees/fanout-<レーン>（枝 fanout/<レーン>）
node .fanout/fanout.mjs prompt <レーン>     → その出力の全文を、司令塔がそのまま Agent の prompt に貼る
Agent({ description: "lane <レーン>", prompt: <出力の全文>, run_in_background: true })
```
- 作業フォルダは必ず `worktree` コマンドで作る。Agent の `isolation: "worktree"` は使わない（既定の枝から作られ、土台と違うことがある: 子の手順 1 で止まる）。
- プロンプトは本文を渡す。「このコマンドを実行してその出力に従え」という渡し方はしない（子の側の権限判定で止められる）。
- 待つ間に司令塔はファイルを編集しない（統合でぶつかる）。

## 4. 子が戻るたびに
1. 枝は `worktree` が計画に記録済み（別の枝で報告されたときだけ `record <レーン> <枝>`）
2. `node .fanout/fanout.mjs status` でそのレーンが ✔ か。✘（範囲外・commit なし）なら、SendMessage でその子に status の行をそのまま返して直させる（2 往復まで。それでも ✘ ならそのレーンは捨てて、報告に書く）。
3. 報告の「依頼」は集めておく（統合のときに司令塔が反映するか、次の波のレーンにする）。

## 5. 確認のレーン（読むだけ）
書くレーンが全部 ✔ になったら readonly のレーンを同じやり方で起動。指摘のうち「確実」なものだけを、担当のレーンの子に SendMessage で渡して直させる（1 往復）。直った枝で status をもう一度。

## 6. 統合（司令塔だけ）
1. `node .fanout/fanout.mjs order` の順に `git merge --no-ff <枝>`。衝突は司令塔が直す（両方の意図を残す。どちらかを捨てるなら人に聞く）。
2. 第 2 波（after のあるレーン）があれば、ここまでを commit して新しい土台にし、plan の base を更新 → 3 から。
3. 「依頼」の反映、共有ファイル（README・CHANGES・テストの登録）の更新。
4. plan の finalTests を全部回す。落ちたら直す（テストを緩めない）。
5. `node .fanout/fanout.mjs actions-off --check` が ✔。
6. commit。push は人が頼んだ枝にだけ。plan.json は消す（.gitignore 済み）。

## 7. 人への報告（短く）
レーンごとの結果（完了 / 捨てた / 理由）、統合した commit、finalTests の結果、未確認・要実測のこと。

## 止まって人に聞くのは、これだけ
- 0 の確認が直せない / 計画の承認 / 衝突でどちらかの振る舞いを捨てる必要がある / finalTests が直せない
