## 並行開発（fanout）の規則 — AI が複数で作業するとき

- 複数の AI で分担するときは `/fanout "<目標>"`（.claude/skills/fanout/SKILL.md）。人も司令塔もレーンのプロンプトを手で書かない: `node .fanout/fanout.mjs prompt <レーン>` が計画から作る。
- 計画は `.fanout/plan.json` の 1 枚だけ。`node .fanout/fanout.mjs check` が通らない計画では子を立てない。人の承認は計画に 1 回。
- 子（レーン）は自分専用の worktree でだけ作業し、担当（owns）の外を変えない。push・マージ・PR はしない。共有ファイル（AGENTS.md・README・CHANGES・.github・.claude・.fanout・package.json ほか plan.shared）は司令塔だけが触る。
- 統合は司令塔だけ: `node .fanout/fanout.mjs status` が全部 ✔ → `order` の順にマージ → 全体のテスト → push。
- GitHub Actions は手動（workflow_dispatch）だけ。自動の契機を足さない（`node .fanout/fanout.mjs actions-off --check`）。
