# 31. 外から呼ぶ入口

## /scriptevent
アドオンを外から動かす、いちばん確実な入口です。チャットのイベントはもうありません。

```js
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const [ns, cmd] = ev.id.split(':');
  if (ns !== 'myaddon') return;
  const player = ev.sourceEntity ?? world.getAllPlayers().filter(Boolean)[0];
  switch (cmd) {
    case 'status': console.warn(`TAG status enabled=${CONFIG.enabled}`); break;
    case 'set': { const n = Number(ev.message); /* … */ break; }
    default: console.warn(`TAG unknown ${cmd}`);
  }
}, { namespaces: ['myaddon'] });
```

ゲームの中から:
```
/scriptevent myaddon:status
/scriptevent myaddon:set 12
```

- `ev.id` は `名前空間:操作`。名前空間は**自分のアドオン専用の短い名前**にしてください
- `ev.message` は後ろの文字列全部。数値なら `Number()`、構造が要るなら JSON にする
- `ev.sourceEntity` は**コンソールから打つと `undefined`** です。必ず `??` で逃がしてください

## カスタムコマンド
新しめの実機には `/` から始まる自作コマンドを登録する仕組みがあります（版によります）。
**在るかどうかを `.bds-lab/api.json` で確かめてから**使ってください。
無い実機でも動かしたいなら `/scriptevent` にしておくのが安全です。

## 検証から呼ぶ
仕様書からは `t.send('myaddon:status')` で、そのまま叩けます。
sim でも本物のクライアントでも同じ書き方です。
