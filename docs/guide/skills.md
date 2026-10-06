# スキルと、一から作る練習

[README](../../README.md) から分けた詳細です。成長の仕組みの全体は [skills/GROWTH.md](../../skills/GROWTH.md)。

## スキル（どの AI でも読め、自分で育つ）

`skills/<名前>/SKILL.md` は、Claude・Codex・Gemini・Copilot・Cursor などどの AI でも読める形のスキル（名前と「いつ使うか」の説明が先頭、中身は手順と規則）です。参考にした 3 つのスキル集（[mcbemodelingmasterAI](https://github.com/iMasterProX/mcbemodelingmasterAI)、[MCBE-UI](https://github.com/shawtymarco/MCBE-UI)、[mcbejsonuimasterAI](https://github.com/boredape874/mcbejsonuimasterAI)）の形に、実機で確かめ直せる証拠と、測って選ぶ仕組みを足しています。

- **どれを読むか**：`node lab.mjs skill route "<頼まれた文（日本語でも）>"` が読むべきスキルと一致した言葉を出します。
- **規則が育つ（L1）**：失敗と直し方を毎回記録 → `skill learn` で候補 → 証拠（実機の probe・テスト）があるものだけ規則に → Minecraft の更新ごとに `skill verify` で確かめ直し。参考リポジトリからも `skill learn --from <URL>` で候補を取り込みます。
- **スキルそのものが育つ（L2）**：`skill grade` が各スキルをシステムプロンプトとしての出来で採点します（skills/rubric.json の 15 項目：説明文の「何をする・いつ使う」、担当外の明記、番号付きの手順、動く例、規則の理由、完了条件と報告、確かめていないことを正直に言うか、3.2 KB 以内、AI 製品の固有名詞を書かないこと、他のスキルや AGENTS.md と重ならないこと、コマンドとパスが実在するか、規則の証拠、振り分けで見つかるか）。各項目に根拠（SkillsBench の測定、Codex のスキル文書、参考 3 リポジトリ）があり、`--ref <リポジトリ>` で参考のスキル集も同じ物差しで採点して、こちらが低い項目には向こうの実際の 1 行を見本として出します。
- **1 から作る・磨く**：`skill new <名前> "<何をする。Use when …>" [--like <手本のスキル>]` が共通の形（または手本の章立て）で下書きを作り、`skill refine <名前>` が「弱い項目・参考の見本・見逃された規則・振り分けの誤り」を出し、AI が直したら `skill refine <名前> --done`。**どの項目も・他のどのスキルも・どの振り分けも悪くならないときだけ残し、悪くなれば元に戻します**。AI が自分で書いたスキルは平均で効かない（SkillsBench：-1.3pt、人が選んだものは +16.2pt）と測られているので、新しいスキルは下書き扱いで、`skill bench --without <名前>`（そのスキル抜きと比べる）で悪くならないと分かったときだけ正式になります。
- **別の AI に磨かせる**：`skill refine weakest --via claude`（codex・gemini・API も可）で、別の AI が直し、ラボが採点して、**何かが上がったときだけ**残します。戻された理由は次の試行に渡します。2 回続けて戻されたスキルは飛ばします。
- **物差しも育つ（L3）**：ベンチのたびにその時の採点を記録し、採点とベンチの合格率が同じ向きに動くかを `skill growth` が出します。頭打ちになったら `skill compare` で参考スキル集と項目ごとに並べ、`skill rubric mine` で「参考の多くが持ちこちらに無い部分」を候補にします。`calibrate` は、同じリポジトリの中でそれを持つスキルほど他の項目も高いか（+5pt 以上）、既存の項目と同じではないかで判定し、通ったものだけ `adopt` します。採点は正規表現なので AI がごまかすことがあり、その対策の経緯は skills/GROWTH.md（日本語、成長の仕組み全体）にあります。
- **いまの成績**（v1.17.0、この流れを実際に回した結果）：採点の平均 81% → 98%（rubric v3）、振り分けの 1 位正解 dev 76% → 100%・held-out 36% → 97%（どのスキルにも属さない依頼を、どれにも振らないかも測っています）、改善の試行のうち採用 32・差し戻し 16（うち 2 つは、ゲートが通したあとで物差しのごまかしと分かり手で戻したもの）。参考（使い回せる項目）は mcbejsonuimasterAI 77%・MCBE-UI 67%・anthropics/skills 66%・mcbemodelingmasterAI 65%。採点は同じ物差しでの比較で、AI のアドオン作りが良くなったかはまだベンチ（AI のトークンが要る）で測っていません。
- **他の AI・他のプロジェクトへ**：`skill install <AI 名|all>` が、それぞれの AI がスキルを探す場所に書き込みます（Claude Code・Codex・Gemini・Copilot・Cursor・Windsurf・Cline・Roo・Kiro・OpenCode。Aider は CONVENTIONS.md）。ある AI だけに要ることは、本文中の `<!-- only:claude -->…<!-- /only -->` か `skills/<名前>/ai/<AI>.md` に書くと、その AI の写しにだけ入ります。スキルのフォルダを読めない AI（チャットや API）には、`skill prompt --for <AI>` が振り分けとスキル本文を 1 本のシステムプロンプトにまとめます。

## 一から作る練習（`scratch`）と、そこから学ぶ仕組み

見本（`bds-recipes`）に近いものが無い依頼は、スキル `bds-from-scratch` の手順で一から作ります。その力を練習で伸ばすのが `scratch` です。

```sh
node lab.mjs scratch                 # 課題の一覧（等級 1〜6）と、このラボが通したもの
node lab.mjs scratch next            # 次の課題（依頼文だけ。隠しテストは見せない）と手順
node lab.mjs scratch check calc      # 隠しテストをサンドボックスで（数秒、目安）
node lab.mjs scratch check calc --real   # 本物の BDS で（判定）
node lab.mjs scratch gaps            # サンドボックスと実機の食い違い（sandbox-be の宿題。--backlog で backlog へ）
node lab.mjs scratch probe "new mc.ItemStack('minecraft:apple').maxAmount"   # 同じコードを sandbox と TS REPL の両方で：一致 / 不一致
```

- **教材**は `bds/bench/tasks.json` の課題（ベンチと同じもの）。各課題に等級・分野・教えるスキルが付いています。参照解（`bds/bench/solution.mjs`）が全課題をサンドボックスと実機の両方で通し、空の雛形は全課題で落ちることを `scratch selftest [--real]` が確かめます（v1.19.0 で 16 課題すべて実機で確認済み）。
- **学ぶ場所**はサンドボックス（sandbox-be：`sim`・`ts try`）と生きた世界（TS REPL：`ts`）。判定はいつも本物の BDS です。
- **学んだことの戻り先**：チェックのたびの失敗と直しはエピソードになり `skill learn` の材料に。同じコードでサンドボックスと実機が食い違えば `scratch gaps` に記録（サンドボックス自身が育つ）。両方が同じ答えを出した probe は `--rule "<規則>" --skill <名前>` で、測った証拠付きの候補規則になります。
- **実際に起きたこと（v1.19.0）**：課題を作る過程で、サンドボックスがプレイヤーのチャットを「全員宛ての 1 行」として出していた食い違いが見つかりました（実機では各プレイヤーに `@B chat <A> 本文`）。sandbox-be と sim を直し、規則 `test-broadcast` に足して、probe を実機で再確認しました。もう 1 つ、課題のテスト自体の誤り（`world.sendMessage` の行に `@A` を付けていた）も、参照解を実機で走らせた時点で見つかって直っています。

