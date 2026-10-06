# end-lab — Endstone プラグインを AI が一人で作り、本物の Endstone サーバーで確かめる

AI 向けの説明は [`AGENTS.md`](AGENTS.md)、全体は [上位の README](../README.md)。

- 必要なもの: Node.js 22+、Python 3.10+（3.11 以上推奨。Debian/Ubuntu は `python3-venv` も）。初回に `.lab/py` へ venv を作り、PyPI の `endstone`（この BDS に対応する 0.11 系）を入れ、Endstone が対応 BDS を `.lab/bds` へ取得します
- 雛形: `node lab.mjs new <name> "Title"`（Python）/ `--cpp`（C++。cmake と Linux なら clang + libc++ が必要）/ `--bp`（パックも同梱）
- プラグインの置き場: `plugins/<name>/`（`pyproject.toml` の `[project.entry-points."endstone"]` が入口）
- 試す: `node lab.mjs run "py plugin.is_enabled" "events on" "@A join"` / 常駐は `up` → 編集 → `do ...`（Endstone の `/reload` でその場に反映）
- 仕上げ: `node lab.mjs test --cov` → `node lab.mjs pack`（`dist/*.whl` を Endstone サーバーの `plugins/` へ）
- 版の固定と更新: `node lab.mjs server`（表示）/ `server --update` / 環境変数 `LAB_ENDSTONE`・`LAB_PYTHON`
- macOS: 何も入れずに使えます（Python も不要）。Docker Desktop・OrbStack・colima のどれかがあれば、venv・Endstone・BDS はラボ用の Linux コンテナの中に作られます（詳しくは上位の README）
