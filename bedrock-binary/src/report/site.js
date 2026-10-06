// プロファイル 1 本から、検索付きの静的サイトを生成する。
// 公式の bedrock-samples が metadata/ を配っているのと同じ感覚で、
// バイナリから復元した定義を「引ける形」で置くのが狙い。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameConfirmed, SOURCE_LABEL } from '../analysis/identify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (x) => (x ?? 0).toLocaleString();

/** 型名をファイル名にする。名前空間の :: は - にする */
export function slugOf(name) {
  return name.replace(/::/g, '-').replace(/[^A-Za-z0-9_-]/g, '_');
}

export function buildSite(profile, outDir) {
  // outDir ごと消すと、先に書いた metadata/ まで巻き込む。自分が作る場所だけ消す。
  fs.rmSync(path.join(outDir, 'enums'), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, 'assets'), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'enums'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
  for (const a of fs.readdirSync(path.join(HERE, 'assets'))) {
    fs.copyFileSync(path.join(HERE, 'assets', a), path.join(outDir, 'assets', a));
  }

  const records = [];
  const pages = [];
  const enums = [...profile.enums].sort((a, b) => a.name.localeCompare(b.name));
  const packetEnum = profile.enums.find((e) => e.short === 'MinecraftPacketIds');
  // 番号は getId() から読んだものだけ（src/analysis/packets.js）。古いプロファイルでは名前の一覧に留める
  const pk = profile.packets?.basis === 'getId' ? profile.packets : null;
  const packetCount = pk ? pk.list.length : packetEnum?.values.length;
  const title = `${profile.version ?? '?'} (${profile.channel ?? '?'})`;

  const commands = profile.commands ?? [];
  const wss = profile.wss;
  const nav = [
    { href: 'index.html', label: '概要' },
    { href: 'commands.html', label: 'コマンド', count: commands.length },
    { href: 'wss.html', label: 'WebSocket', count: wss?.summary.knownTotal },
    { href: 'enums.html', label: 'enum 一覧', count: enums.length },
    { href: 'packets.html', label: 'パケット ID', count: packetCount },
    { href: 'unreferenced.html', label: '未参照の識別子', count: profile.identifiers.dead.length },
    { href: 'method.html', label: '復元のしかた' },
  ];

  const rail = (depth, current) => {
    const b = '../'.repeat(depth);
    return (
      `<nav class="rail"><a class="rail-brand" href="${b}index.html">` +
      `<b>bedrock-binary</b><span>${esc(title)}</span></a><h3>ドキュメント</h3>` +
      nav
        .map(
          (i) =>
            `<a class="item${i.href === current ? ' on' : ''}" href="${b}${i.href}">${esc(i.label)}` +
            `${i.count ? `<span class="n">${n(i.count)}</span>` : ''}</a>`,
        )
        .join('') +
      `</nav>`
    );
  };

  const page = ({ file, heading, body, depth = 0, desc }) => {
    const b = '../'.repeat(depth);
    pages.push(file);
    const html = `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)} — bedrock-binary ${esc(title)}</title>
<meta name="description" content="${esc(desc ?? `BDS ${title} のバイナリから復元した ${heading}。`)}">
<link rel="stylesheet" href="${b}assets/style.css">
</head>
<body data-base="${b}">
<div class="shell">${rail(depth, file)}
<div class="main">
  <div class="searchbar"><div class="wrap">
    <input id="q" type="search" placeholder="enum 名、値、パケット名で検索" autocomplete="off" spellcheck="false">
    <span class="hint">/ で検索</span>
  </div></div>
  <div id="results"></div>
  <div class="page"><div class="wrap">${body}</div></div>
</div></div>
<script src="${b}assets/app.js"></script>
</body></html>`;
    const f = path.join(outDir, file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, html);
  };

  /* ---- 個別の enum ---- */

  for (const e of enums) {
    const file = `enums/${slugOf(e.name)}.html`;
    records.push({ k: 'enum', n: e.name, v: e.ordered, e: `${e.values.length} 値`, r: file });
    for (const [i, v] of e.values.entries()) {
      records.push({ k: '値', n: v, e: e.name, i, v: e.ordered, r: `${file}#v${i}` });
    }

    const rows = e.values
      .map((v, i) => `<tr id="v${i}"><td class="num">${i}</td><td><code>${esc(v)}</code></td></tr>`)
      .join('');

    page({
      file,
      depth: 1,
      heading: e.name,
      desc: `${e.name} の値 ${e.values.length} 件。BDS ${title} のバイナリから復元。`,
      body:
        `<div class="crumb"><a href="../enums.html">enum 一覧</a></div>` +
        `<h2 style="margin-top:6px">${esc(e.name)}</h2>` +
        `<p class="meta">${e.values.length} 値 / 復元元の関数 <code>0x${e.addr.toString(16)}</code></p>` +
        badges(e) +
        (e.ordered
          ? ''
          : `<div class="note"><p>この enum の並びはポインタ配列で裏を取れていません。命令の並び順から復元しているので、<strong>番号は目安</strong>です。値の集合は信頼できます。</p></div>`) +
        `<table><thead><tr><th>ID</th><th>値</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  /* ---- コマンド ---- */

  if (commands.length) {
    const hidden = commands.filter((c) => c.inOfficialMetadata === false);
    for (const c of commands) {
      records.push({
        k: 'コマンド',
        n: `/${c.name}`,
        v: c.inOfficialMetadata !== false,
        e: c.inOfficialMetadata === false ? '公式メタデータに無い' : '',
        r: `commands.html#c-${c.name}`,
      });
    }
    const row = (c) =>
      `<tr id="c-${esc(c.name)}"><td><code>/${esc(c.name)}</code></td>` +
      `<td><code>${esc(c.descriptionKey)}</code></td>` +
      `<td>${c.related.length ? `<code>${esc(c.related.slice(0, 4).join(', '))}</code>` : ''}</td></tr>`;

    page({
      file: 'commands.html',
      heading: 'コマンド',
      desc: `BDS ${title} のバイナリから復元したコマンド ${commands.length} 個。うち ${hidden.length} 個は公式メタデータに無い。`,
      body:
        `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">コマンド ${commands.length} 個</h2>` +
        `<p>翻訳キー <code>commands.&lt;名前&gt;.description</code> とコマンド名を同じ関数から読んでいることを手がかりに、` +
        `<code>CommandRegistry</code> への登録を拾ったものです。3 列目は同じ登録関数が読んでいる識別子で、` +
        `多くはそのコマンドのパラメータ列挙の型名です。</p>` +
        `<div class="note"><p>公式の <code>mojang-commands.json</code> に載っているのは 83 個（別名を含めて 91 名）ですが、` +
        `バイナリには <strong>${commands.length} 個</strong>あります。差の <strong>${hidden.length} 個</strong>は表に出ていないコマンドです。</p></div>` +
        `<h2>公式メタデータに無いもの (${hidden.length})</h2>` +
        `<table><thead><tr><th>コマンド</th><th>説明キー</th><th>関連する識別子</th></tr></thead><tbody>` +
        hidden.map(row).join('') +
        `</tbody></table>` +
        `<h2>すべて (${commands.length})</h2>` +
        `<table><thead><tr><th>コマンド</th><th>説明キー</th><th>関連する識別子</th></tr></thead><tbody>` +
        commands.map(row).join('') +
        `</tbody></table>` +
        `<div class="note"><p>引数の型や権限レベルは整数で埋め込まれていて、文字列からは復元できません。` +
        `そこは公式メタデータのほうが正確です。別名も同様に取れていません。</p></div>`,
    });
  }

  /* ---- WebSocket ---- */

  if (wss) {
    for (const t of wss.eventTypes) {
      for (const v of t.values) {
        records.push({
          k: 'WSS イベント',
          n: v.name,
          i: v.id,
          v: !v.obsolete,
          e: `${t.enum}${v.obsolete ? ' (廃止)' : ''}`,
          r: `wss.html#e-${slugOf(t.enum)}-${v.id}`,
        });
      }
    }

    const typeTable = wss.eventTypes
      .map(
        (t) =>
          `<h3>${esc(t.enum)}</h3><p class="meta">${t.values.length} 種別 / 並び ${t.orderVerified ? '裏取り済' : '未確定'}</p>` +
          `<table><thead><tr><th>ID</th><th>種別</th></tr></thead><tbody>` +
          t.values
            .map(
              (v) =>
                `<tr id="e-${slugOf(t.enum)}-${v.id}"><td class="num">${v.id}</td>` +
                `<td><code>${esc(v.name)}</code>${v.obsolete ? ' <span class="tag">廃止</span>' : ''}</td></tr>`,
            )
            .join('') +
          `</tbody></table>`,
      )
      .join('');

    const known = wss.knownNames;
    const live = known.filter((k) => k.referenced);
    const ghost = known.filter((k) => k.present && !k.referenced);
    const absent = known.filter((k) => !k.present);

    page({
      file: 'wss.html',
      heading: 'WebSocket',
      desc: `BDS ${title} のバイナリから見た WebSocket のイベント。`,
      body:
        `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">WebSocket</h2>` +
        `<div class="note"><p>${esc(wss.note)}よく出回っている ${known.length} 語のイベント名表も、` +
        `そのままの形ではバイナリに存在しません。ここに出せるのはサーバー側に残っている事実だけです。</p></div>` +
        `<h2>メッセージの封筒</h2>` +
        `<p><code>messagePurpose</code> を読む関数が使っているキーです。` +
        `やり取りする JSON の <code>header</code> に入るものと対応します。</p>` +
        `<pre class="plain">${esc(wss.envelope.join('\n'))}</pre>` +
        `<h2>サーバーが扱うイベント種別</h2>` +
        `<p><code>LegacyTelemetryEventPacket</code> が運ぶ種別です。` +
        `<code>_OBSOLETE</code> が付いていたものは廃止済みとして印を付けてあります。</p>` +
        typeTable +
        `<h2>出回っているイベント名 ${known.length} 語の検証</h2>` +
        `<p>ネット上で見かけるテレメトリ名の一覧を、バイナリの事実と突き合わせた結果です。` +
        `<strong>参照あり</strong>だけがサーバーで動きます。</p>` +
        `<div class="tally">` +
        `<div><b>${live.length}</b><span>参照あり</span></div>` +
        `<div><b>${ghost.length}</b><span>文字列だけある</span></div>` +
        `<div><b>${absent.length}</b><span>バイナリに無い</span></div>` +
        `</div>` +
        `<h3>参照あり (${live.length})</h3><pre class="plain">${esc(live.map((k) => k.name).join('\n'))}</pre>` +
        `<h3>文字列はあるが参照なし (${ghost.length})</h3>` +
        `<p class="meta">デッドコード由来。<code>BlockBroken</code> もここです。</p>` +
        `<pre class="plain">${esc(ghost.map((k) => k.name).join('\n'))}</pre>` +
        `<h3>バイナリに無い (${absent.length})</h3>` +
        `<p class="meta">クライアント専用。サーバー経由では取れません。</p>` +
        `<pre class="plain">${esc(absent.map((k) => k.name).join('\n'))}</pre>`,
    });
  }

  /* ---- enum 一覧 ---- */

  const listRows = [...enums]
    .sort((a, b) => b.values.length - a.values.length)
    .map(
      (e) =>
        `<tr><td><a href="enums/${slugOf(e.name)}.html"><code>${esc(e.name)}</code></a></td>` +
        `<td class="num">${e.values.length}</td>` +
        `<td>${SOURCE_LABEL[e.source] ?? '推定'}</td>` +
        `<td>${e.ordered ? '裏取り済' : '—'}</td></tr>`,
    )
    .join('');

  page({
    file: 'enums.html',
    heading: 'enum 一覧',
    body:
      `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">enum ${enums.length} 個 / 値 ${n(profile.enums.reduce((a, e) => a + e.values.length, 0))} 件</h2>` +
      `<p>型名の出所が<strong>シンボル / cereal / 名前辞書</strong>のものは裏が取れています。` +
      `<strong>推定</strong>は登録関数の形から拾ったもので、enum でない登録テーブルが混ざりえます。</p>` +
      `<table><thead><tr><th>型</th><th>値</th><th>型名</th><th>並び</th></tr></thead><tbody>${listRows}</tbody></table>`,
  });

  /* ---- パケット ---- */

  if (pk) {
    const rows = pk.list
      .map((x) => `<tr id="p${x.id}"><td class="num">${x.id}</td><td class="num">0x${x.id.toString(16)}</td><td><code>${esc(x.class)}</code></td><td>${x.name ? `<code>${esc(x.name)}</code>` : ''}</td></tr>`)
      .join('');
    const gone = (pk.noClass ?? []).map((x) => (x.id === null ? esc(x.name) : `${esc(x.name)} (${x.id})`)).join(', ');
    page({
      file: 'packets.html',
      heading: 'パケット ID',
      desc: `Bedrock のパケット ID ${pk.list.length} 件。BDS ${title} のバイナリの getId() から。`,
      body:
        `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">パケット ID ${pk.list.length} 件</h2>` +
        `<p>各パケットクラスの <code>getId()</code>（定数を返すだけの仮想関数）の機械語から読んだ番号です。` +
        `クラスは RTTI の型名から、関数は vtable からたどっています。<code>${esc(packetEnum?.name ?? 'MinecraftPacketIds')}</code> の値の並びは番号ではありません` +
        `（削除された番号は抜け、200〜299 は予約、新しいパケットほど順番が合いません）。</p>` +
        `<table><thead><tr><th>ID</th><th>16 進</th><th>クラス</th><th>列挙子</th></tr></thead><tbody>${rows}</tbody></table>` +
        (gone ? `<p>クラスの無い列挙子（削除済み・予約・このビルドに無いもの）: ${gone}</p>` : ''),
    });
  } else if (packetEnum) {
    const rows = packetEnum.values.map((v) => `<tr><td><code>${esc(v)}</code></td></tr>`).join('');
    page({
      file: 'packets.html',
      heading: 'パケット ID',
      desc: `Bedrock のパケット名 ${packetEnum.values.length} 件（番号なし）。BDS ${title}。`,
      body:
        `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">パケット名 ${packetEnum.values.length} 件</h2>` +
        `<div class="note"><p>このプロファイルにはパケットの番号がありません（${esc(profile.packets?.reason ?? '古いプロファイル')}）。` +
        `値の並びは番号ではないので、名前の一覧としてだけ使ってください。</p></div>` +
        `<table><thead><tr><th>列挙子</th></tr></thead><tbody>${rows}</tbody></table>`,
    });
  }

  /* ---- 未参照 ---- */

  page({
    file: 'unreferenced.html',
    heading: '未参照の識別子',
    body:
      `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">未参照の識別子 ${n(profile.identifiers.dead.length)} 件</h2>` +
      `<p><code>.rodata</code> に文字列としては存在するのに、<code>.text</code> からも再配置ポインタからも` +
      `一度も参照されていないものです。デッドコード由来で、サーバーでは使われません。</p>` +
      `<div class="note"><p>たとえば <code>BlockBroken</code> はここにあります。文字列があるからといって、` +
      `そのイベントがサーバーで発火するわけではありません。</p></div>` +
      `<pre class="plain">${esc(profile.identifiers.dead.join('\n'))}</pre>`,
  });

  /* ---- 手法 ---- */

  page({
    file: 'method.html',
    heading: '復元のしかた',
    body: method(profile),
  });

  /* ---- 概要 ---- */

  page({
    file: 'index.html',
    heading: '概要',
    desc: `Minecraft Bedrock Dedicated Server ${title} のバイナリから復元した enum とパケット ID。`,
    body:
      `<div class="hero"><h1>BDS のバイナリから<br>復元した定義</h1>` +
      `<p>Minecraft Bedrock Dedicated Server <code>${esc(title)}</code> の実行ファイルを読んで、` +
      `enum の名前と値、パケット ID、使われていない識別子を取り出したものです。</p>` +
      `<p>見どころは 2 つ。公式メタデータに載っていない <strong>${commands.filter((c) => c.inOfficialMetadata === false).length} 個のコマンド</strong>と、` +
      `出回っている WebSocket イベント名のうち<strong>サーバーで本当に動く ${wss?.summary.referencedInBinary ?? 0} 語</strong>です。</p>` +
      `<div class="tally">` +
      `<div><b>${n(commands.length)}</b><span>コマンド</span></div>` +
      `<div><b>${n(commands.filter((c) => c.inOfficialMetadata === false).length)}</b><span>公式に無いコマンド</span></div>` +
      `<div><b>${n(enums.length)}</b><span>enum</span></div>` +
      `<div><b>${n(profile.enums.reduce((a, e) => a + e.values.length, 0))}</b><span>値</span></div>` +
      `<div><b>${n(packetCount ?? 0)}</b><span>パケット ID</span></div>` +
      (profile.facts
        ? `<div><b>${n(profile.facts.namespaced?.byNamespace?.minecraft?.total ?? 0)}</b><span>minecraft: 識別子</span></div>` +
          `<div><b>${n(profile.facts.molang?.total ?? 0)}</b><span>Molang</span></div>` +
          `<div><b>${n(profile.facts.scriptModules?.length ?? 0)}</b><span>スクリプト API</span></div>`
        : '') +
      `</div></div>` +
      `<h2>どこから来たデータか</h2>` +
      `<table><thead><tr><th></th><th></th></tr></thead><tbody>` +
      `<tr><td>バージョン</td><td><code>${esc(profile.version ?? '?')}</code> (${esc(profile.channel ?? '?')})</td></tr>` +
      `<tr><td>build-id</td><td><code>${esc(profile.binary.buildId ?? '不明')}</code></td></tr>` +
      `<tr><td>アーキテクチャ</td><td>${esc(profile.binary.machine)}</td></tr>` +
      `<tr><td>シンボル</td><td>${profile.binary.symbols ? `${esc(profile.binary.symbols.file)}（関数 ${n(profile.binary.symbols.functions)} 個）` : '無し（型名は cereal と名前辞書から）'}</td></tr>` +
      `<tr><td>解析日時</td><td>${esc(profile.generatedAt)}</td></tr>` +
      `</tbody></table>` +
      `<h2>機械可読な形でも置いてあります</h2>` +
      `<p>公式の <code>bedrock-samples/metadata/</code> と同じ形の JSON を <code>metadata/</code> に出しています。` +
      `<code>module_type</code> と <code>data_items</code> を持つ素朴な構造なので、公式メタデータ用に書いた道具がそのまま動きます。</p>` +
      `<pre class="plain">metadata/packet_modules/       パケット ID、ログイン・入力・インベントリ・表示系の enum
metadata/wss_modules/          /connect の封筒と、イベント名が実際に発火するかの判定
metadata/command_modules/      表に出ていないコマンド、発行元と権限レベル
metadata/vanilladata_modules/  パーティクル・サウンド・エンチャントなどの内部 ID
metadata/enum_modules/         型名か並びの裏が取れた enum
metadata/version.json          出したモジュールと、検証に落ちて出さなかったもの</pre>` +
      `<p>各値には <code>id_basis</code> が付きます。<code>code_getid</code> は各クラスの <code>getId()</code> の機械語から読んだ番号（パケット ID）、<code>array_verified</code> はポインタ配列で番号を確認済み、` +
      `<code>declaration_order</code> は宣言順、<code>names_only</code> は番号が飛び飛びなので名前だけ使えるもの。</p>` +
      `<div class="note"><p>復元である以上、確度には差があります。型名が cereal から取れたものと登録関数の形から推定したもの、` +
      `並びをポインタ配列で裏取りできたものとできていないものを、すべてのページで区別して出しています。</p></div>`,
  });

  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(records));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  return { pages: pages.length, records: records.length };
}

function badges(e) {
  const a = nameConfirmed(e)
    ? `<span class="tag ok">型名 ${esc(SOURCE_LABEL[e.source] ?? e.source)}</span>`
    : '<span class="tag">型名 推定</span>';
  const b = e.ordered ? '<span class="tag ok">並び 裏取り済</span>' : '<span class="tag">並び 未確定</span>';
  return `<p>${a}${b}</p>`;
}

function method(p) {
  return `<div class="crumb">ドキュメント</div><h2 style="margin-top:6px">復元のしかた</h2>
<p><code>bedrock_server</code> は完全にストリップされていて、残っているシンボルは 392 個しかありません。
それでも ${n(p.stats.functions)} 個の関数と ${p.enums.length} 個の enum が取り出せます。手順は 6 段です。</p>

<h3>1. 関数の境界は .eh_frame_hdr にある</h3>
<p>シンボルが消えても、例外処理のための FDE テーブルは消えません。
<code>.eh_frame_hdr</code> の二分探索テーブルが全関数の開始アドレスを昇順で持っています。</p>

<h3>2. 文字列の末尾マージを解く</h3>
<p>リンカは <code>"SubClientLogin"</code> と <code>"Login"</code> を一本化します。後者へのポインタは前者の<strong>途中</strong>を
指すので、開始アドレスだけを索引するとそういう値が消えます。実際これで
<code>Login</code> <code>Disconnect</code> <code>Text</code> が抜け落ちていました。</p>

<h3>3. 参照元の関数でまとめる</h3>
<p><code>.rodata</code> には ${n(p.stats.strings)} 個の文字列がありますが、並び順に意味はありません。
リンカの文字列マージで散っていて、既知の 98 語を調べたところ連続していたのは最大 7 語でした。
代わりに <code>.text</code> の RIP 相対アドレッシングを全部拾い、
「どの関数がどの文字列をどの順で読んでいるか」を作ります。</p>

<h3>4. 型名はコンパイラが残している</h3>
<p>Bedrock は cereal の型リフレクションで enum と文字列を結び付けています。
その登録関数には <code>__PRETTY_FUNCTION__</code> 由来の文字列が埋まっています。</p>
<pre class="plain">Factory&lt;Type&gt; cereal::BasicFactory&lt;MinecraftPacketIds&gt;::scope(std::string_view)</pre>
<p>山括弧の中が名前空間つきの正確な型名です。ただしこれは release ビルドにしかありません。
preview では消えているので、登録関数の<strong>形</strong>（型名を 1 個読んで、そのあと値を順に読む）でも拾います。</p>

<h3>5. 並び順はポインタ配列で裏を取る</h3>
<p>命令の並び順は、コンパイラが登録呼び出しを並べ替えれば動きます。
一方 <code>.data.rel.ro</code> に置かれた <code>const char*</code> の配列はメモリ配置そのものなので動きません。
PIE なので中身はファイル上では 0 で、実際の値は <code>R_X86_64_RELATIVE</code> の addend として
<code>.rela.dyn</code> に入っています。名前は命令側から、順序は配列側から取ります。</p>

<h3>6. パケット ID は getId() の機械語から</h3>
<p><code>MinecraftPacketIds</code> の値の並びは番号ではありません。削除されたパケットの番号は抜け、200〜299 は予約、
新しいパケットほど並びと番号が合いません。そこで RTTI の型名（<code>10TextPacket</code>）から typeinfo、vtable とたどり、
定数を返すだけの仮想関数 <code>getId()</code>（<code>mov eax, 9; ret</code>）の即値を読みます。
どの位置の関数が getId かは、値がいちばんばらける位置で選び、<code>TextPacket = 9</code>・<code>LoginPacket = 1</code> で確かめます。</p>

<h2>限界</h2>
<ul>
<li>型名が「推定」の enum には、enum でない登録テーブル（ECS のシステム名など）が混ざります</li>
<li>並びが「未確定」の enum は、値の集合は信頼できますが番号は目安です</li>
<li>ここにあるのは 1 つのビルドの姿です。削除された値や将来の値は含まれません</li>
</ul>`;
}
