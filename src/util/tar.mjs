import zlib from 'node:zlib';

// npm の .tgz を読むだけの最小の tar。外部パッケージを使わずに済ませるためのもの。
// パッケージマネージャを通さずに型定義を取りに行けるので、pnpm のワークスペースや
// lockfile の事情に巻き込まれない。

const str = (b) => b.toString('utf8').replace(/\0.*$/, '');
const oct = (b) => parseInt(str(b).trim() || '0', 8) || 0;

/** gzip された tar を展開して [{ name, body }] を返す（ファイルだけ） */
export function readTgz(buf) {
  const tar = zlib.gunzipSync(buf);
  const out = [];
  let longName = null;
  for (let off = 0; off + 512 <= tar.length;) {
    const head = tar.subarray(off, off + 512);
    if (head.every((x) => x === 0)) break;
    const name = longName ?? [str(head.subarray(345, 500)), str(head.subarray(0, 100))].filter(Boolean).join('/');
    const size = oct(head.subarray(124, 136));
    const type = String.fromCharCode(head[156] || 0x30);
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    longName = null;
    if (type === 'L') { longName = str(body); continue; }   // GNU の長い名前
    if (type === '0' || type === '\0') out.push({ name, body });
  }
  return out;
}

/** tgz の中の 1 ファイルだけ取り出す（先頭の package/ は外して照合する） */
export function pickFromTgz(buf, wanted) {
  for (const e of readTgz(buf)) {
    if (e.name.replace(/^[^/]+\//, '') === wanted) return e.body;
  }
  return null;
}
