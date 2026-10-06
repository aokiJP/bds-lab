# bds/ — アドオン用ラボ

使い方は [上位の README](../README.md)、AI 向けの指示は [../AGENTS.md](../AGENTS.md) にあります。このフォルダでも `node lab.mjs ...` がそのまま使えます。

- `addons/<名前>/` … アドオン 1 つ（`src/` TypeScript、`bp/` `rp/`、`tests.txt`、`TASK.md`）。`node lab.mjs use <名前>` で切り替え。
- `dist/` … `go` / `pack` の成果物（.mcaddon）。
- `bench/` … トークン節約ベンチマーク（`node bench/bench.mjs start <AI名> <課題|all>` → `end <id> --claude` → `rank`）。`make` の結果もここの `ranking.json` に載ります。
- `docs/` … 本物のクライアントの記録（EVENTS.md: どの操作でどのイベントが出るか、VERBS.md: 操作ごとの実機結果、GOALS.md: RTA の記録、SPEC.md）と、それを作るスクリプト。
- `vendor/` … BDS の zip（`bundle` で同梱するとき）。
