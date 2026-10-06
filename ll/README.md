# ll-lab — LeviLamina mod を AI が一人で作り、本物の LeviLamina サーバーで確かめる

AI 向けの説明は [`AGENTS.md`](AGENTS.md)、全体は [上位の README](../README.md)。

- 必要なもの: Node.js 22+。Windows ならそのまま、Linux は Wine（64bit）。初回に lip（LeviLamina のパッケージ管理）で LeviLamina 26.51.x と LegacyScriptEngine（QuickJS）を `.lab/bds` へ入れます。手元の LeviLamina サーバーを使うなら `LAB_LL_SERVER=<フォルダか zip>`
- 雛形: `node lab.mjs new <name> "Title"`（LSE + TypeScript）/ `--js` / `--engine nodejs` / `--native`（C++・xmake。ビルドは Windows。Linux ではビルド済み `bin/<Mod>/` を試験）/ `--bp`
- mod の置き場: `mods/<name>/`（`manifest.json` + `src/`。ビルドで 1 ファイルにまとめてサーバーの `plugins/<name>/` へ）
- 試す: `node lab.mjs run "ll list" "lse mc.getOnlinePlayers().length" "events on" "@A join"` / 常駐は `up` → 編集 → `do ...`（`ll unload`/`ll load` でその場に反映）
- 仕上げ: `node lab.mjs test` → `node lab.mjs pack`（`dist/<name>-<ver>.zip` をサーバーの `plugins/` へ展開）
- 版: `LAB_LL_VERSION`（既定 26.51.5 = BDS 1.26.51.1）・`LAB_LSE_VERSION`、`node lab.mjs server [--update]`
- macOS: Docker Desktop・OrbStack・colima のどれかがあれば、Wine・lip・LeviLamina はラボ用の Linux コンテナの中で動きます（Wine の準備も自動）。手元の Mac 用 Wine で動かす道（`LAB_RUNTIME=native LAB_WINE=wine64`）もありますが未確認です
