// /function・構文エラー・実行の入口（SB_COMMANDS の戻り値）

// ---- /function ------------------------------------------------------------

const FUNCTIONS = functions ?? {};
let fnDepth = 0;
/** 実測: 無い関数を指してもエラーにならず {} が返る。中身は 1 行ずつ流れる */
function runFunctionFile(name, src) {
  if (fnDepth > 10) return;                       // 入れ子の上限は未測定。無限ループだけ防ぐ
  const key = String(name).replace(/^\/+/, '').replace(/\.mcfunction$/, '');
  const body = FUNCTIONS[key];
  if (body === undefined) return;
  fnDepth++;
  const saved = currentLine;
  try {
    for (const raw of String(body).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const toks = tokenize(line);
      if (!toks.length) continue;
      currentLine = line.replace(/^\//, '');
      try { runTokens(toks, src); } catch { /* 実測: 中の失敗は外に出ない */ }
    }
  } finally {
    fnDepth--;
    currentLine = saved;
  }
}

/** 実測: 引用符で囲んでいない語に / があると、その位置で構文エラーになる */
function slashSyntax(tok) {
  const idx = currentLine.indexOf('/', tok ? tok.start : 0);
  const before = currentLine.slice(Math.max(0, idx - 10), idx);
  const after = currentLine.slice(idx + 1, idx + 11);
  const err = new Syntax(`Syntax error: Unexpected "/": at "${before}>>/<<${after}"`);
  err.raw = true;
  return err;
}
const checkSlashes = (toks) => { for (const t of toks ?? []) if (!t.quoted && String(t.v).includes('/')) throw slashSyntax(t); };

const KNOWN = new Set(['?', 'help', 'ability', 'aimassist', 'allowlist', 'alwaysday', 'camera', 'camerashake', 'changesetting', 'clearspawnpoint', 'connect', 'controlscheme', 'damage', 'daylock', 'deop', 'dialogue', 'effect', 'enchant', 'event', 'fog', 'function', 'hud', 'inputpermission', 'kick', 'list', 'locate', 'loot', 'me', 'mobevent', 'music', 'op', 'particle', 'playanimation', 'playsound', 'recipe', 'reload', 'replaceitem', 'ride', 'schedule', 'spawnpoint', 'spreadplayers', 'stopsound', 'structure', 'tickingarea', 'title', 'titleraw', 'toggledownfall', 'wsserver', 'xp', 'place', 'project', 'transfer', 'stop', 'save', 'setmaxplayers', 'permission', 'whitelist', 'worldbuilder', 'wb', 'agent', 'code', 'gametest', 'reloadconfig', 'sendshowstoreoffer', 'volumearea', 'weather', 'waypoint',
  // BDS が持つが Mojang の文書に無いもの（bedrock-binary が見つけ、BDS 1.26.52.3 のコンソールで実測: 未知ではなく構文エラーか実行）
  'clearrealmevents', 'listd', 'gettopsolidblock', 'querytarget', 'serveridentity', 'editor-allowlist']);

let currentLine = '';
function syntaxMessage(tokens, token) {
  const line = currentLine;
  if (token === W.custom.END) return `Error occurred with parsing command params: Syntax error: Unexpected "": at "${line.slice(-10)}>><<"`;
  const hit = tokens.find((t, i) => i > 0 && t.v === token) ?? (token === tokens[0]?.v ? tokens[0] : null);
  if (!hit) return `Error occurred with parsing command params: Syntax error: Unexpected "${token}": at "${line}"`;
  const before = line.slice(Math.max(0, hit.start - 10), hit.start);
  const after = line.slice(hit.end, hit.end + 10);
  return `Error occurred with parsing command params: Syntax error: Unexpected "${line.slice(hit.start, hit.end)}": at "${before}>>${line.slice(hit.start, hit.end)}<<${after}"`;
}

/**
 * 1 つのコマンドを流す。
 *   { ok: true, successCount }                 成功（実行してみて 0 件なら successCount: 0, failed: 理由）
 *   { ok: false, syntax: true, message }       構文エラー（Script API の runCommand は例外にする）
 *   { ok: false, notImplemented }              サンドボックスが再現していない
 */
function runTokens(tokens, src) {
  const name = String(tokens[0]?.v ?? '').toLowerCase();
  const args = tokens.slice(1).map((t) => t.v);
  const h = H[name];
  const custom = !h && W.custom.find ? W.custom.find(name) : null;
  if (custom) {
    const r = W.custom.run(custom, args, src, { pos: (a, i, s2) => pos3(a, i, s2.pos, false), select: (t, s2) => select(t, s2) });
    if (r.ok || r.notImplemented) return r;
    if (r.syntaxToken !== undefined) return { ok: false, syntax: true, message: syntaxMessage(tokens, r.syntaxToken) };
    return { ok: true, successCount: 0, failed: r.message };
  }
  if (!h) {
    if (KNOWN.has(name)) return { ok: false, notImplemented: name };
    return { ok: false, syntax: true, message: syntaxMessage(tokens, tokens[0]?.v ?? '') };
  }
  try {
    const r = h(args, src, tokens.slice(1)) ?? {};
    return { ok: true, successCount: r.successCount ?? 1, message: r.message ?? '' };
  } catch (e) {
    if (e instanceof NotImpl) return { ok: false, notImplemented: `${name}（${e.message}）` };
    // raw を立てた Syntax は、実機の文言をそのまま返す（>>…<< の形にならないもの）
    if (e instanceof Syntax && e.raw) return { ok: false, syntax: true, message: `Error occurred with parsing command params: ${e.message}` };
    if (e instanceof Syntax) return { ok: false, syntax: true, message: syntaxMessage(tokens, e.token ?? ''), detail: e.message };
    if (e instanceof Failed) return { ok: true, successCount: 0, failed: e.message };
    throw e;
  }
}

return {
  run(line, src) {
    currentLine = String(line).trim().replace(/^\//, '');
    const tokens = tokenize(String(line));
    if (!tokens.length) return { ok: false, syntax: true, message: 'Error occurred with parsing command params: Syntax error: Unexpected "": at ""' };
    return runTokens(tokens, { dim: src.dim, pos: { ...src.pos }, entity: src.entity ?? null, typed: !!src.typed });
  },
  implemented: () => Object.keys(H).sort(),
};
