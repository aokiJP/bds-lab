// the controller's pages: the same buttons in the Discord DM (app/lib/live.mjs builds its components from these) and in the
// web panel's live tab. Each button: [label, live command (" && " between several), style]; "#chat" / "#cmd" open a form,
// "#page:<name>" shows another page. Style (Discord's): 1 blue, 2 grey, 3 green, 4 red. 5 rows of 5 a page (Discord's most)
export const PAGES = {
  play: [
    [['⬆️ 前へ', 'walk forward 1', 1], ['⬅️ 左へ', 'walk left 1', 1], ['⬇️ 後ろへ', 'walk back 1', 1], ['➡️ 右へ', 'walk right 1', 1], ['🦘 ジャンプ', 'jump', 1]],
    [['↩️ 左を見る', 'look left 300'], ['↪️ 右を見る', 'look right 300'], ['🔼 上を見る', 'look up 250'], ['🔽 下を見る', 'look down 250'], ['🏃 走る', 'sprint 2', 1]],
    [['⛏️ 壊す', 'mine 1.5', 3], ['⚔️ 殴る', 'attack', 3], ['✋ 使う・置く', 'use', 3], ['🎒 持ち物', 'inventory', 3], ['🔁 次の物', 'slot next', 3]],
    [['⏩ 進み続ける', 'move forward', 1], ['⏹️ 止まる', 'release', 4], ['🧎 しゃがむ', 'sneak'], ['📍 どこ', 'where'], ['🎥 5 秒', 'clip 5']],
    [['💬 チャット', '#chat', 1], ['⌨️ 命令', '#cmd', 1], ['📷 画面', 'screen'], ['🎮 メニュー', '#page:menu'], ['🧰 道具', '#page:tools']],
  ],
  menu: [
    [['Ⓐ 決定', 'pad A', 1], ['Ⓑ 戻る', 'pad B', 4], ['Ⓧ', 'pad X'], ['Ⓨ', 'pad Y'], ['☰ ポーズ', 'pause']],
    [['▲', 'pad UP', 1], ['▼', 'pad DOWN', 1], ['◀', 'pad LEFT', 1], ['▶', 'pad RIGHT', 1], ['⎋ 閉じる', 'key ESCAPE']],
    [['1', 'slot 1'], ['2', 'slot 2'], ['3', 'slot 3'], ['4', 'slot 4'], ['5', 'slot 5']],
    [['6', 'slot 6'], ['7', 'slot 7'], ['8', 'slot 8'], ['9', 'slot 9'], ['🗑️ 落とす', 'drop']],
    [['⏪ LB', 'pad LB'], ['⏩ RB', 'pad RB'], ['📷 画面', 'screen'], ['🕹️ 遊ぶ', '#page:play', 3], ['🧰 道具', '#page:tools']],
  ],
  tools: [
    [['🖧 サーバーを立てる', 'bds up', 1], ['🔗 参加', 'relay && step join', 1], ['🚪 タイトルまで', 'title 5'], ['🔄 視点', 'perspective'], ['🧭 北を向く', 'face north']],
    [['🌞 昼に', 'bds do time set day'], ['☀️ 晴れに', 'bds do weather clear'], ['🛠️ クリエ', 'bds do gamemode creative @a'], ['⚔️ サバイバル', 'bds do gamemode survival @a'], ['❤️ 回復', 'bds do effect @a instant_health 1 10']],
    [['📍 どこ', 'where'], ['🎒 持ち物の一覧', 'items'], ['⚡ 描画の速さ', 'fps'], ['📜 BDS のログ', 'bdslog 20'], ['🎥 10 秒', 'clip 10']],
    [['▶️ ゲーム起動', 'launch'], ['🆗 ダイアログ', 'answer'], ['🧪 app.txt', 'run'], ['⏹️ 全部はなす', 'release', 4], ['❓ 使い方', 'help']],
    [['💬 チャット', '#chat', 1], ['⌨️ 命令', '#cmd', 1], ['📷 画面', 'screen'], ['🕹️ 遊ぶ', '#page:play', 3], ['🎮 メニュー', '#page:menu']],
  ],
};
