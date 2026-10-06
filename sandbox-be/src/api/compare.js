// compareCommands: コマンドをそのまま流した世界と、cmdscript-be で変換したスクリプトの世界を比べる。
// cmdscript-be は任意の依存（入っていなければ compareCommands だけが使えない）。
import { runSandbox } from './run.js';

/**
 * コマンドの変換は別パッケージ（cmdscript-be）。入っていれば使う。
 * npm で入れたもの → 隣に置いたフォルダ（../cmdscript-be）の順に探す。
 */
let converter = null;
export async function loadConverter() {
  if (converter) return converter;
  const tries = [
    ...(process.env.SANDBOX_BE_CMDSCRIPT ? [() => import(new URL(`file://${process.env.SANDBOX_BE_CMDSCRIPT}`).href)] : []),
    () => import('cmdscript-be'),
    () => import(new URL('../../../cmdscript-be/src/index.js', import.meta.url).href),
  ];
  for (const t of tries) {
    try { converter = await t(); return converter; } catch { /* 次へ */ }
  }
  throw new Error('compareCommands には cmdscript-be が要ります（npm i cmdscript-be、または隣のフォルダに置く）');
}

function stripModule(src) {
  return src
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export\s+(?=(function|const|let|class|async))/gm, '');
}

/** commands2script の結果を、サンドボックスで動く 1 本のスクリプトにする */
export async function commandsToProgram(lines, { player = 'Steve' } = {}) {
  const { commands2script, PRELUDE } = await loadConverter();
  const conv = commands2script(lines);
  const body = conv.map((c) => `  // ${c.command}\n  {\n${c.code.split('\n').map((l) => `    ${l}`).join('\n')}\n  }`).join('\n');
  const code = [
    "import { world, system, BlockPermutation, BlockVolume, ItemStack } from '@minecraft/server';",
    stripModule(PRELUDE),
    'world.afterEvents.worldLoad.subscribe(() => {',
    '  system.run(async () => {',
    '    const dimension = world.getDimension("overworld");',
    `    const entity = world.getPlayers({ name: ${JSON.stringify(player)} })[0];`,
    '    const self = entity;',
    '    const origin = entity ? entity.location : { x: 0, y: 0, z: 0 };',
    body.replace(/^/gm, '  '),
    '  });',
    '});',
  ].join('\n');
  return { code, conversions: conv };
}

function compareFinal(a, b) {
  const diffs = [];
  const blocksA = new Map(a.diff.blocks.map((x) => [`${x.dimension}|${x.at.x}|${x.at.y}|${x.at.z}`, x.after]));
  const blocksB = new Map(b.diff.blocks.map((x) => [`${x.dimension}|${x.at.x}|${x.at.y}|${x.at.z}`, x.after]));
  for (const k of new Set([...blocksA.keys(), ...blocksB.keys()])) {
    if (blocksA.get(k) !== blocksB.get(k)) diffs.push({ kind: 'block', at: k, command: blocksA.get(k) ?? '(変化なし)', script: blocksB.get(k) ?? '(変化なし)' });
  }
  const scoreKey = (s) => JSON.stringify(s);
  if (scoreKey(a.final.scores) !== scoreKey(b.final.scores)) diffs.push({ kind: 'scores', command: a.final.scores, script: b.final.scores });
  const ents = (r) => Object.values(r.final.entities).map((e) => `${e.typeId}|${e.name ?? e.nameTag ?? ''}|${e.dimension}|${e.location.x.toFixed(2)},${e.location.y.toFixed(2)},${e.location.z.toFixed(2)}|${e.tags.join(',')}|${(e.inventory ?? []).filter(Boolean).join(',')}|${e.gameMode ?? ''}`).sort();
  const ea = ents(a);
  const eb = ents(b);
  if (JSON.stringify(ea) !== JSON.stringify(eb)) diffs.push({ kind: 'entities', command: ea, script: eb });
  const chat = (r) => r.chat.map((c) => `${c.to}: ${c.text}`);
  if (JSON.stringify(chat(a)) !== JSON.stringify(chat(b))) diffs.push({ kind: 'chat', command: chat(a), script: chat(b) });
  if (JSON.stringify(a.final.world) !== JSON.stringify(b.final.world)) diffs.push({ kind: 'world', command: a.final.world, script: b.final.world });
  return diffs;
}

/**
 * コマンドをそのまま流した世界と、c2s で変換したスクリプトを流した世界を比べる。
 * 変換が「結果として同じ」かを、実機なしで確かめる。
 */
export async function compareCommands({ commands, world, players, ticks = 40, player = 'Steve', limits } = {}) {
  const lines = (Array.isArray(commands) ? commands : String(commands ?? '').split('\n')).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new TypeError('commands が空です');
  const common = { world, players: players ?? [{ name: player }], limits: { ...(limits ?? {}), ticks } };
  const viaCommands = await runSandbox({
    ...common,
    code: "import { world } from '@minecraft/server';\n",
    actions: lines.map((command) => ({ tick: 1, type: 'command', player, command })),
  });
  const prog = await commandsToProgram(lines, { player });
  const viaScript = await runSandbox({ ...common, code: prog.code });
  if (!viaCommands.report || !viaScript.report) {
    return { ok: false, verdict: 'error', viaCommands, viaScript, program: prog.code };
  }
  const differences = compareFinal(viaCommands.report, viaScript.report);
  const cmdErrors = viaCommands.report.log.filter((l) => l.level === 'warn' && /^command /.test(l.message)).map((l) => l.message);
  const scriptErrors = viaScript.report.log.filter((l) => l.level === 'error').map((l) => l.message);
  const unsupported = { ...viaCommands.report.unsupported, ...viaScript.report.unsupported };
  // 変換の時点で「だいたい」と注記した差（/say の発言者名など）は、想定どおりの差として分ける
  const approxChat = prog.conversions.some((c) => c.fidelity === 'approximate' && ['say', 'me', 'tell', 'msg', 'w', 'tellraw'].includes(c.command));
  for (const d of differences) if (d.kind === 'chat' && approxChat) d.expected = true;
  const real = differences.filter((d) => !d.expected);
  const verdict = scriptErrors.length ? 'fail'
    : real.length ? 'different'
      : Object.keys(unsupported).length ? 'inconclusive'
        : differences.length ? 'approximate' : 'same';
  return {
    ok: verdict === 'same' || verdict === 'approximate',
    verdict,
    differences,
    commandErrors: cmdErrors,
    scriptErrors,
    unsupported,
    conversions: prog.conversions.map((c) => ({ command: c.command, fidelity: c.fidelity, notes: c.notes })),
    program: prog.code,
  };
}
