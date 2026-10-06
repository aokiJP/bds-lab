// プロファイルと差分を Markdown にする。GitHub 上でそのまま読めて、PR の diff にも乗る。
import { isEmptyDiff } from './diff.js';
import { nameConfirmed, SOURCE_LABEL } from '../analysis/identify.js';

const n = (x) => (x ?? 0).toLocaleString();

export function renderProfile(p) {
  const l = [];
  const title = p.version ? `${p.version} (${p.channel ?? '?'})` : p.binary.path;
  l.push(`# ${title}`, '');
  l.push(
    `\`${p.binary.machine}\` / ${p.binary.type} / build-id \`${p.binary.buildId ?? '不明'}\``,
    '',
    ...(p.source?.kind === 'apk'
      ? [`APK \`${p.source.package ?? '?'}\` versionCode ${p.source.versionCode ?? '?'}（${p.source.abi}）から取り出した \`${p.binary.path}\`。`, '']
      : []),
    '| | |',
    '|---|---|',
    `| バイナリ | ${n(p.binary.size)} バイト |`,
    `| 関数 | ${n(p.stats.functions)} |`,
    `| 文字列 | ${n(p.stats.strings)} |`,
    `| うち参照あり | ${n(p.stats.referenced)} |`,
    `| enum | ${p.enums.length} |`,
    `| enum の値 | ${n(p.enums.reduce((a, e) => a + e.values.length, 0))} |`,
    `| 並びを配列で確定 | ${p.enums.filter((e) => e.ordered).length} |`,
    `| パケット | ${p.packets?.basis ? `${p.packets.list.length}（ID は getId() から）` : `—（${p.packets?.reason ?? 'このプロファイルには無い'}）`} |`,
    `| ポインタ配列 | ${n(p.pointerTables ?? 0)} |`,
    `| 解析時間 | ${(p.stats.elapsedMs / 1000).toFixed(1)} 秒 |`,
    '',
  );

  if (p.packets?.basis) {
    l.push(
      '## パケット ID',
      '',
      '各パケットクラスの `getId()` の機械語（定数を返すだけの関数）から読んだ番号。`MinecraftPacketIds` の値の並びは番号ではない',
      '（削除された番号は抜け、200〜299 は予約、新しいパケットほど順番が合わない）ので使わない。列挙子の名前はクラスと結び付いたものだけ。',
      '',
      '```',
      ...p.packets.list.map((x) => `${String(x.id).padStart(3)}  0x${x.id.toString(16).padStart(2, '0')}  ${x.class}${x.name && x.name !== x.class.replace(/Packet$/, '') && x.name !== x.class ? `  (${x.name})` : ''}`),
      '```',
      '',
    );
    if (p.packets.noClass?.length) {
      l.push(`クラスの無い列挙子（削除済み・予約・このビルドに無いもの）: ${p.packets.noClass.map((x) => (x.id === null ? x.name : `${x.name} (${x.id})`)).join(', ')}`, '');
    }
  }

  const cereal = p.enums.filter((e) => nameConfirmed(e));
  l.push(
    '## enum 一覧',
    '',
    `型名の裏が取れているもの ${cereal.length} 個は、シンボル表・cereal のリフレクション文字列・名前辞書のいずれかから取れている。`,
    `残り ${p.enums.length - cereal.length} 個は登録関数の形から推定したもので、`,
    'enum ではない登録テーブル（ECS のシステム名など）が混ざりうる。',
    '',
    '| 型 | 値 | 出所 |',
    '|---|---|---|',
  );
  for (const e of [...p.enums].sort((a, b) => b.values.length - a.values.length)) {
    l.push(`| [\`${e.name}\`](#${anchor(e.name)}) | ${e.values.length} | ${nameConfirmed(e) ? '確定' : '推定'} |`);
  }
  l.push('');

  for (const e of [...p.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    l.push(`### ${e.name}`, '');
    l.push(`関数 \`0x${e.addr.toString(16)}\` から復元。${e.values.length} 値。型名の出所は${SOURCE_LABEL[e.source] ?? '登録関数の形'}。`, '', '```');
    for (const [i, v] of e.values.entries()) l.push(`${String(i).padStart(3)}  ${v}`);
    l.push('```', '');
  }
  return l.join('\n');
}

export function renderDiff(d) {
  const label = (x) => `${x.version ?? '?'}${x.channel ? ` (${x.channel})` : ''}`;
  const l = [`# ${label(d.from)} → ${label(d.to)}`, ''];
  if (d.crossBinary) {
    l.push(
      `> サーバーとクライアントの比較です（\`${d.from.machine}\` → \`${d.to.machine}\`）。`,
      '> 識別子の増減は版の変化ではなく、片側のバイナリにしか無いコードを表します。',
      '',
    );
  }

  if (isEmptyDiff(d)) {
    l.push(`${d.packets ? 'パケットにも' : ''}enum にも識別子にも変化はありません。`, '');
    return l.join('\n');
  }

  l.push('| | 前 | 後 | 差 |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(d.stats)) {
    l.push(`| ${k} | ${n(v.before)} | ${n(v.after)} | ${v.delta > 0 ? '+' : ''}${n(v.delta)} |`);
  }
  l.push('');

  // パケットを最初に出す。番号の変化はプロトコル実装を壊す
  const pk = d.packets;
  if (pk && (pk.added.length || pk.removed.length || pk.renumbered.length || pk.renamed?.length)) {
    l.push(`## パケット (+${pk.added.length} / -${pk.removed.length} / 番号の変化 ${pk.renumbered.length}${pk.renamed?.length ? ` / 名前だけ変わった ${pk.renamed.length}` : ''})`, '');
    l.push('番号は両方の版とも各パケットクラスの `getId()` から読んだもの。', '');
    const row = (x) => `${String(x.id).padStart(3)}  0x${x.id.toString(16).padStart(2, '0')}  ${x.class}`;
    if (pk.renumbered.length) l.push('番号が変わった（プロトコル実装はここで壊れます）', '', '```', ...pk.renumbered.map((r) => `${r.from} → ${r.to}  ${r.class}`), '```', '');
    if (pk.added.length) l.push('追加', '', '```', ...pk.added.map(row), '```', '');
    if (pk.removed.length) l.push('削除', '', '```', ...pk.removed.map(row), '```', '');
    if (pk.renamed?.length) l.push('同じ番号でクラス名だけ変わった', '', '```', ...pk.renamed.map((r) => `${String(r.id).padStart(3)}  0x${r.id.toString(16).padStart(2, '0')}  ${r.from} → ${r.to}`), '```', '');
  } else if (!pk) {
    l.push('> パケット ID は比べていません（片方のプロファイルが古く、getId() から読んだ番号がありません）。', '');
  }

  // 番号がずれた enum を最初に出す。ここが実装を壊す
  const shifted = d.enums.changed.filter((c) => c.renumbered.length && c.ordered);
  const unstable = d.enums.changed.filter((c) => c.renumbered.length && !c.ordered);
  if (shifted.length) {
    l.push('## 番号がずれた enum', '');
    l.push('既存の値の番号が動いています。プロトコル実装はここで壊れます。', '');
    for (const c of shifted) {
      l.push(`### ${c.name}`, '');
      l.push(`\`${c.shiftedFrom}\` 番以降がずれています（${c.renumbered.length} 値）。`, '', '```');
      for (const r of c.renumbered.slice(0, 40)) l.push(`${r.from} → ${r.to}  ${r.value}`);
      if (c.renumbered.length > 40) l.push(`... 他 ${c.renumbered.length - 40} 値`);
      l.push('```', '');
    }
  }

  if (unstable.length) {
    l.push('## 並びが変わった enum（番号は未確定）', '');
    l.push(
      'ポインタ配列で裏を取れていない enum です。命令の並び順から復元しているため、',
      'コンパイラが登録呼び出しを並べ替えただけでもここに出ます。番号は信用しないでください。',
      '',
    );
    for (const c of unstable.slice(0, 20)) {
      l.push(`- \`${c.name}\` ${c.shiftedFrom} 番以降（+${c.added.length} / -${c.removed.length}）`);
    }
    if (unstable.length > 20) l.push(`- ... 他 ${unstable.length - 20} 個`);
    l.push('');
  }

  const plain = d.enums.changed.filter((c) => !c.renumbered.length);
  if (plain.length) {
    l.push('## 値が増減した enum', '');
    for (const c of plain) {
      l.push(`### ${c.name}`, '');
      if (c.added.length) l.push('追加', '', '```', ...c.added.map((a) => `${a.id}  ${a.value}`), '```', '');
      if (c.removed.length) l.push('削除', '', '```', ...c.removed.map((r) => `${r.id}  ${r.value}`), '```', '');
    }
  }

  if (d.enums.renamed?.length) {
    l.push('## 名前だけが変わった enum', '', '中身（値の 8 割以上）が同じで、型名の出どころが変わったもの。増減ではありません。', '');
    for (const e of d.enums.renamed) l.push(`- \`${e.from}\` → \`${e.to}\` (${e.count} 値${e.same ? '' : `、値 +${e.added} / -${e.removed}`})`);
    l.push('');
  }
  if (d.enums.added.length || d.enums.removed.length) {
    l.push('## enum 自体の増減', '');
    for (const e of d.enums.added) l.push(`- 追加 \`${e.name}\` (${e.count} 値)`);
    for (const e of d.enums.removed) l.push(`- 削除 \`${e.name}\` (${e.count} 値)`);
    l.push('');
  }

  const li = d.identifiers.live;
  l.push(`## 参照されている識別子 (+${li.added.length} / -${li.removed.length})`, '');
  l.push(section('追加', li.added), section('削除', li.removed));

  return l.join('\n');
}

function section(title, items) {
  if (!items.length) return '';
  const body = ['```', ...items.slice(0, 300), items.length > 300 ? `... 他 ${items.length - 300} 件` : '', '```', ''];
  return items.length > 60
    ? [`<details><summary>${title} ${items.length} 件</summary>`, '', ...body, '</details>', ''].join('\n')
    : [title, '', ...body].join('\n');
}

const anchor = (s) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
