# bds-lab のホスト（GitHub Actions の時間を貸す）

このリポジトリは、あなたの GitHub Actions の時間を、bds-lab を使う 1 人に貸すためのものです。その人はあなたのリポジトリの
collaborator として、**自分の GitHub のログインで**ラボの試験を走らせます。あなたのパスワードや鍵を渡すことはありません。

## 貸し手がすること（3 つ）

1. このリポジトリを **private** で作る（中身はこの README と `.github/workflows/host.yml` と `.lab-host.json` の 3 つだけ）
2. 借りる人を collaborator に招く（Settings → Collaborators → Add people。権限は Write）
3. `.lab-host.json` を書く（下の表）。あわせて、自分の GitHub の Actions の予算（Settings → Billing → Budgets）も決めておく

| キー | 意味 |
|---|---|
| `minutesPerMonth` | 1 か月に貸す分。ラボはこの **80%** で止まります |
| `jobs` | 許す仕事: `gate`（ラボの試験）・`gate-all`（全部の試験）・`test` `go` `sim`（その人のアドオンの試験）・`upkeep`・`dev-bds` |
| `hours` | 走らせてよい時間帯（`22:00-06:00` のように日をまたいでも可） |
| `timezone` | `hours` と月の区切りのタイムゾーン（例 `Asia/Tokyo`） |
| `until` | 貸す最後の日（`YYYY-MM-DD`）。過ぎたら使われません |
| `contact` | 連絡先 |

## 走るもの・走らないもの

- 走るのは、その人が押し込んだ `lab/run-*` の枝の上の bds-lab の試験だけ（`host.yml` の `workflow_dispatch`）。終われば枝は消えます
- 権限は `contents: read` だけ。秘密（Secrets）もキャッシュも使いません（1 回の run のものは次へ残りません）。Minecraft のサーバーは Mojang の配布元からランナーが自分で取ります
- AI を使う仕事、アカウントの要る仕事、他の人のアドオン（借りたもの）は送られません（ラボが送る前に止めます）
- 分は「走らせた人」ではなく **このリポジトリの持ち主（あなた）** に付きます。public にすると標準のランナーの分は掛かりませんが、押し込まれた試験も公開になります
- やめるときは collaborator から外すか、このリポジトリをアーカイブするか消すだけ。ラボは 403/404（2 回続けて）やアーカイブを見て、それ以上使いません。`.lab-host.json` を消すか壊しても、直すまで止まります
- 毎月の報告は、借りる人が `node lab.mjs host report <owner/repo>` で作り、あなたに渡すか、ここの Issue に書きます

`.github/workflows/host.yml` は bds-lab のひな形と同じでなければなりません（借りる人の `host add` が確かめます）。
