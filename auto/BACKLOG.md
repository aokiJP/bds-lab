# Backlog (the AI writes this; a person may add `- [ ] <request>` lines too)
# `- [ ] <addon request>` → make it (playtested) · `- [ ] lab: <change>` → the AI changes bds-lab itself (gated, reviewed)
# [x] done · [~] given up after 4 failures · [-] dropped by the AI when it replanned
- [ ] 釣り大会：/lab:fish で 3 分間の大会が始まり、釣った魚の数をサイドバーに出して、終わったら 1 位にダイヤを 3 個配る
- [ ] 毎日ログインボーナス：その日初めて参加したらエメラルドを 1 個、7 日連続なら 5 個。連続日数は再起動しても残る
- [x] lab: why が "a hook that never ran" と言ったとき、その hook を登録しているはずの行を src から探して 1 行添える（AI が探し回るトークンを減らす）
- [ ] lab: brief が難読化されたアドオン（文字列を配列に隠したもの）のイベントを読めない：helper.js で subscribe を包み、1 回の run で実際に購読しているイベントとコマンドを brief に出す（brief --live）
- [x] lab: draft tests.txt に、引数を取るカスタムコマンド（kit cmd の型・registerCommand の mandatoryParameters）の見本の引数を入れる（今は引数なしで呼ぶだけ）
- [ ] lab: sim が作業台のクラフト（@A craft_at）を飛ばす：バニラ（sample の recipes.brarchive）とパックの recipes を sandbox に渡して作る
- [ ] lab: Endstone プラグインの持ち込み（.whl・プラグインのフォルダ）：end の import と brief（コマンド・イベント・依存パッケージ）
- [ ] lab: go の QA が 1 度だけ「BDS crashed (native crash) during startup」で落ちた（zz_jitgo、5 回中 1 回、再現せず）：起動時のクラッシュは QA を 1 回やり直してから Q にする
- [ ] skills: [source] の規則（model-vanilla-first、ui-modify、ui-title-route、ui-unverified）にテストか probe を作って再確認できるように（ui-title-route は realplayer がタイトルを生で出すので dev-bds で示せる）
- [ ] skills: `skill learn --from` で参考 3 リポジトリから出た候補（モデリング 60、MCBE-UI 60）を仕分け、証明できるものを promote
- [ ] skills: `skill bench --via claude --runs 3` で今のスキル（rubric v2 で平均 96%）とスキル無しを比べ、L3（採点がベンチの合格を予測するか）の最初の点を取る。採点だけ上がって合格が増えない項目は rubric から外すか書き直す
- [ ] skills: skills/routes.json の held-out は triggers.txt と同じ回に同じ AI が書いた（完全には独立していない）→ 実際に来た依頼文（BACKLOG・import の依頼）から held-out を 10 件足し、`skill route --eval` で汎化を測り直す
- [ ] lab: スキル作りそのもののベンチ課題（「○○のスキルを 1 から書け」→ skill new → refine --done で KEPT、別の AI がそのスキルで課題を解けるか）を bds/bench に足す（skill-forge は今のアドオン課題では測れない）
- [ ] skills: bds-debug と bds-addon-master は refine --via が 2 回続けて戻された（stuck）：ブリーフの「tried … reverted」を読み、honesty の 1 行を、他のスキルの依頼を奪わない言葉で足す（skill refine bds-debug を手で）
- [ ] skills: 僅差の振り分け 2 件（釣り大会 → bds-recipes vs bds-tests-world、フォームを閉じると落ちる → bds-forms vs bds-script-api）に、そのスキルだけが持つ言葉を足して差を広げる
- [ ] skills: `skill bench --via claude --without bds-from-scratch --runs 3` で、新スキル bds-from-scratch（下書き）が作りを悪くしないか測り、正式にするか決める
- [ ] 一から作る：`scratch next` の課題を AI に順に解かせ、初回で実機に通る率（`scratch stats`）を測る。通らなかった課題は、その課題が教えるスキルを `skill refine` する
- [ ] lab: common/nethernet-connect/dist を nethernet-connect から同梱し直す（v1.18.0 の zip から欠けていて `lan` が動かない。`status` が missing と言う）
- [ ] lab: sandbox-be がキルの判定（課題 kills）を UNSURE と言う：実機で測って sandbox に入れ、`scratch selftest` の UNSURE を 0 にする
