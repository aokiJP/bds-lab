# teleport_menu

## Request
アップデートしたら動かなくなった。直して。ついでにホームが再起動で消えるのも直して

(a person's addon, imported from TeleportMenu.mcaddon: keep its pack names and UUIDs, so their worlds update in place)

## Acceptance (one tests.txt `## ` section each)
- [x] 今の BDS で読み込めて、コンパスのメニュー（スポーン・ホーム・他のプレイヤー）と !sethome / !home が動く（## loads・## !sethome then !home brings the player back・## the compass menu: …）
- [x] ホームが再起動で消えない（## the home survives a restart）

## Changes (what the fix changed; the original is the person's TeleportMenu.mcaddon, not kept here)
- パックの名前・UUID は元のまま（遊んでいる人のワールドがそのまま更新される）。版は bp 1.2.0 → 1.2.1、rp 1.0.0 → 1.0.1（imported.json が元の版）
- 依存: @minecraft/server 2.11.0-beta・@minecraft/server-ui 2.3.0-beta（チャットの !sethome / !home は beforeEvents.chatSend: ベータ）
- !sethome / !home: before イベントは読み取り専用なので、保存とテレポートは system.run の中で
- ホームはプレイヤーの動的プロパティに保存（再起動で消えない）
- コンパスは持っていないときだけ渡す（入り直すたびに増えない）
- プレイヤーへのテレポート: 選んだ相手が抜けていたらそう言う（isValid）

## Guessed
<!-- values decided without asking -->
