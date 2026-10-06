## 並行開発（fanout）の規則 — AI が複数で作業するとき

- **このリポジトリの作業は既定で fanout**: セッション（司令塔）は Opus、`/fanout "<目標>"`（.claude/skills/fanout/SKILL.md）で計画し、子を並行で動かす。1 人の方が安い作業（質問・1 ファイル 50 行未満の直し・調べもの）だけは司令塔が自分で。
- 子のモデルは Sonnet 約 6 割・Opus 約 4 割（`node .fanout/fanout.mjs models` の値を Agent の model に必ず渡す。渡さなければ Sonnet）。何体にするかは `node .fanout/fanout.mjs size`（いちばん安く並行できる数）。
- 複数の AI で分担するときは `/fanout "<目標>"`（.claude/skills/fanout/SKILL.md）。人も司令塔もレーンのプロンプトを手で書かない: `node .fanout/fanout.mjs prompt <レーン>` が計画から作る。
- 計画は `.fanout/plan.json` の 1 枚だけ。`node .fanout/fanout.mjs check` が通らない計画では子を立てない。人の承認は計画に 1 回。
- 子（レーン）は自分専用の worktree でだけ作業し、担当（owns）の外を変えない。push・マージ・PR はしない。共有ファイル（AGENTS.md・README・CHANGES・.github・.claude・.fanout・package.json ほか plan.shared）は司令塔だけが触る。
- 統合は司令塔だけ: `node .fanout/fanout.mjs status` が全部 ✔ → `order` の順にマージ → 全体のテスト → push。
- GitHub Actions は自動の契機（push・pull_request・schedule ほか）も使ってよい。子（レーン）は Actions を起動しない・ワークフローを変えない（.github は司令塔だけ）。
