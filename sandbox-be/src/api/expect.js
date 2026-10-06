// 期待値（expect）の照合と、全体の判定（verdict）。
//
// verdict: pass / fail / error / timeout / watchdog / crashed / inconclusive

const dimOf = (d) => (d ? (String(d).includes(':') ? String(d) : `minecraft:${d}`) : 'minecraft:overworld');
const idOf = (s) => (String(s).includes(':') ? String(s) : `minecraft:${s}`);

function blockAt(report, dim, at) {
  const k = `${dimOf(dim)}|${at.x}|${at.y}|${at.z}`;
  const hit = report.diff.blocks.find((b) => `${b.dimension}|${b.at.x}|${b.at.y}|${b.at.z}` === k);
  if (hit) return hit.after;
  return null; // 変化なし（呼び出し側で初期値を見る）
}

function naturalBlock(generator, dim, y) {
  if (generator === 'void' || dimOf(dim) !== 'minecraft:overworld') return 'minecraft:air';
  return { [-64]: 'minecraft:bedrock', [-63]: 'minecraft:dirt', [-62]: 'minecraft:dirt', [-61]: 'minecraft:grass_block' }[y] ?? 'minecraft:air';
}

/** 1 つの期待を確かめる → { ok, expect, actual? } */
export function checkExpectation(exp, result, req) {
  const r = result.report;
  const say = (ok, actual) => ({ ok, expect: exp, ...(actual !== undefined ? { actual } : {}) });
  if (!r) return say(false, 'レポートがありません');
  if (exp.block) {
    const e = exp.block;
    let got = blockAt(r, e.dimension, e.at);
    if (got === null) {
      const init = (req.world?.blocks ?? []).find((b) => {
        const from = b.at ?? b.from;
        const to = b.to ?? from;
        return ['x', 'y', 'z'].every((k) => e.at[k] >= Math.min(from[k], to[k]) && e.at[k] <= Math.max(from[k], to[k])) && dimOf(b.dimension) === dimOf(e.dimension);
      });
      got = init ? idOf(init.type ?? init.id) : naturalBlock(req.world?.generator, e.dimension, e.at.y);
    }
    return say(got === idOf(e.is), got);
  }
  if (exp.chat) {
    const e = exp.chat;
    const hits = r.chat.filter((c) => (!e.to || c.to === e.to || c.to === '@a') && (e.equals !== undefined ? c.text === e.equals : c.text.includes(e.contains ?? '')));
    return say(e.count !== undefined ? hits.length === e.count : hits.length > 0, r.chat.map((c) => `${c.to}: ${c.text}`));
  }
  if (exp.score) {
    const e = exp.score;
    const table = r.final.scores[e.objective];
    if (!table) return say(e.exists === false, '目的がありません');
    const key = Object.keys(table).find((k) => k === e.participant || k === `Player:${e.participant}` || k === `Entity:${e.participant}`);
    const v = key ? table[key] : undefined;
    if (e.exists === false) return say(v === undefined, v);
    if (v === undefined) return say(false, '点数がありません');
    const ok = (e.equals === undefined || v === e.equals) && (e.min === undefined || v >= e.min) && (e.max === undefined || v <= e.max);
    return say(ok, v);
  }
  if (exp.entity) {
    const e = exp.entity;
    const list = Object.values(r.final.entities).filter((x) => (!e.type || x.typeId === idOf(e.type))
      && (!e.name || x.name === e.name || x.nameTag === e.name)
      && (!e.tag || x.tags.includes(e.tag))
      && (!e.dimension || x.dimension === dimOf(e.dimension)));
    const n = list.length;
    const ok = (e.count === undefined || n === e.count) && (e.min === undefined || n >= e.min) && (e.max === undefined || n <= e.max) && (e.count !== undefined || e.min !== undefined || e.max !== undefined || n > 0);
    return say(ok, n);
  }
  if (exp.player) {
    const e = exp.player;
    const p = Object.values(r.final.entities).find((x) => x.name === e.name && x.typeId === 'minecraft:player');
    if (!p) return say(false, 'プレイヤーがいません');
    const checks = [];
    if (e.hasItem) {
      const total = (p.inventory ?? []).filter(Boolean).reduce((n, s) => {
        const [id, amt] = s.split('×');
        return id === idOf(e.hasItem.id ?? e.hasItem) ? n + Number(amt) : n;
      }, 0);
      checks.push(total >= (e.hasItem.amount ?? 1));
    }
    if (e.tag) checks.push(p.tags.includes(e.tag));
    if (e.gameMode) checks.push(p.gameMode === e.gameMode);
    if (e.at) checks.push(['x', 'y', 'z'].every((k) => Math.abs(p.location[k] - e.at[k]) < (e.within ?? 0.001)));
    if (e.health !== undefined) checks.push(p.health === e.health);
    return say(checks.every(Boolean), p);
  }
  if (exp.log) {
    const e = exp.log;
    const hits = r.log.filter((l) => (!e.level || l.level === e.level) && l.message.includes(e.contains ?? ''));
    return say(e.absent ? hits.length === 0 : hits.length > 0, hits.map((l) => l.message).slice(0, 10));
  }
  if (exp.effect) {
    const e = exp.effect;
    const hits = r.effects.filter((x) => x.kind === e.kind && (!e.id || x.id === e.id) && (!e.to || x.to === e.to) && (!e.text || String(x.text ?? '').includes(e.text)));
    return say(hits.length > 0, r.effects.filter((x) => x.kind === e.kind).slice(0, 10));
  }
  if (exp.form) {
    const e = exp.form;
    const hits = r.forms.filter((f) => (!e.kind || f.kind === e.kind) && (!e.to || f.to === e.to));
    return say(hits.length > 0, r.forms.slice(0, 10));
  }
  if (exp.error) {
    const e = exp.error;
    const errs = r.log.filter((l) => l.level === 'error');
    const hits = errs.filter((l) => (!e.name || l.error?.name === e.name) && (!e.contains || l.message.includes(e.contains)));
    return say(hits.length > 0, errs.map((l) => l.message).slice(0, 10));
  }
  return say(false, `未知の期待 ${Object.keys(exp).join(', ')}`);
}

export function verdictOf(result, req) {
  if (result.fatal) return result.fatal.stage === 'host' ? 'crashed' : 'error';
  if (result.killed) return 'timeout';
  if (result.hang) return 'watchdog';
  const expectErrors = (req.expect ?? []).some((e) => e.error);
  const failed = result.expectations.some((x) => !x.ok);
  if (failed) return 'fail';
  if (result.loadError && !result.report.inconclusive) return 'error';
  if (result.report.uncaught > 0 && !expectErrors && req.allowErrors !== true) return 'fail';
  if (result.report.inconclusive || Object.keys(result.report.unsupported).length) return 'inconclusive';
  return 'pass';
}
