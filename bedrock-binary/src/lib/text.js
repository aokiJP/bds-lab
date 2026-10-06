// 端末表示用の小道具。日本語（全角）は 2 桁として数えないと列が揃わない。
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

export function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

export function padDisplay(s, width) {
  const str = String(s);
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}
