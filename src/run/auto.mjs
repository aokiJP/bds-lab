import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LabSession } from './session.mjs';
import { loadSpecs, runSpecs, writeReport, summarize } from '../verify/spec-runner.mjs';
import { otherAddons } from './check.mjs';
import { makeSimCtx } from '../verify/sim-ctx.mjs';
import { captureApi, runReal } from './check.mjs';
import { makeHandoff, ensureMaterials } from './handoff.mjs';
import crypto from 'node:crypto';
import { pushCurrent, commitAll, currentBranch, gitReady } from './github.mjs';

const hashDir = (dir) => {
  if (!fs.existsSync(dir)) return '';
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(dir).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex');
};

function stuckNote(seen, results) {
  const lines = [];
  for (const r of results.filter((x) => !x.ok)) {
    const key = `${r.name}::${r.detail}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (seen.get(key) >= 3) lines.push(`- ${r.name}: 同じ落ち方が ${seen.get(key)} 回続いています`);
  }
  if (!lines.length) return '';
  return [
    '## 手が止まっています',
    '',
    ...lines,
    '',
    'いまのやり方では通りません。小さく直すのをやめて、別のやり方に変えてください。',
    '必要なら `specs/` に調べるための本を 1 つ足し、`t.note()` で実機に値を読ませてから決めてください。',
  ].join('\n');
}

const AGENTS = [
  { bin: 'claude', args: (f) => ['-p', `@${f} の指示に従って、このリポジトリのファイルを直してください。`, '--permission-mode', 'acceptEdits'] },
  { bin: 'codex', args: (f) => ['exec', `@${f} の指示に従って、このリポジトリのファイルを直してください。`] },
  { bin: 'gemini', args: (f) => ['-p', `@${f} の指示に従って、このリポジトリのファイルを直してください。`, '-y'] },
];

const which = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin]).status === 0;

export function findAgent(given) {
  if (given) return { bin: given.split(' ')[0], args: (f) => [...given.split(' ').slice(1), f] };
  return AGENTS.find((a) => which(a.bin)) ?? null;
}

export async function auto({ ROOT, bdsDir, addonDir, specsDir, filter = null, say = console.log, rounds = 5, agent = null, how = 'auto', push = true, release = true, realToo = true }) {
  const runner = findAgent(agent);
  if (!runner) {
    say('AI の CLI が見つかりません（claude / codex / gemini）。--agent "<コマンド>" で指定もできます');
    say('見つからない間は prompt と cycle で手動の往復になります');
  } else {
    say(`AI: ${runner.bin}`);
  }
  if (gitReady(ROOT)) say(`枝: ${currentBranch(ROOT)}`);

  const session = await LabSession.open({ bdsDir, addonDir, say });
  await captureApi({ ROOT, session, say });
  const history = [];
  const seen = new Map();
  let specsHash = hashDir(specsDir);
  try {
    for (let round = 1; round <= rounds; round++) {
      say('');
      say(`── ${round} 回目`);
      const up = await session.apply({ how });
      const specs = await loadSpecs(specsDir, { addon: session.addon.name, others: otherAddons(ROOT, session.addon.name) });
      const r = await runSpecs({ specs, makeCtx: makeSimCtx(session), tag: 'sim', filter, say });

      // sim が通ったら、その場で本物のクライアントでも確かめる（実機は 1 台のまま）
      let realR = { ok: true, total: 0, passed: 0, results: [], skipped: [] };
      if (realToo && r.ok) {
        say('');
        // required: false — 依存が入らないのは環境の話。アドオンの失敗にはせず飛ばす
        try { realR = await runReal({ ROOT, session, specs, filter, say, required: false }); }
        catch (e) { say(`  本物のクライアントで入れませんでした: ${String(e.message ?? e)}`); realR = { ok: false, total: 1, passed: 0, skipped: [], results: [{ name: '本物のクライアントで入る', ok: false, detail: String(e.message ?? e), notes: [] }] }; }
      }

      const all = [...r.results, ...realR.results];
      const passed = all.filter((x) => x.ok).length;
      const report = {
        at: new Date().toISOString(), version: session.version, addon: session.addon.name, how: up.how,
        ok: passed === all.length && all.length > 0, total: all.length, passed, results: all,
        scriptErrors: session.scriptErrors ?? [],
        skipped: realR.skipped ?? [], skippedWhy: realR.why ?? null,
      };
      writeReport({ ROOT, report });
      history.push({ round, passed: report.passed, total: report.total });
      say('');
      say(summarize(report));

      const nowHash = hashDir(specsDir);
      const touched = nowHash !== specsHash;
      if (touched) {
        say('  ※ AI が specs/ を書き換えました。受け入れ条件が緩んでいないか確かめてください');
        specsHash = nowHash;
      }

      if (gitReady(ROOT)) {
        const msg = `auto ${round} 回目: ${report.passed}/${report.total}${report.ok ? ' 全部通りました' : ''}${touched ? '（specs も変更）' : ''}`;
        if (commitAll(ROOT, msg) && push) {
          pushCurrent({ ROOT, message: msg, say });
          if (release) {
            try {
              const { publish } = await import('./release.mjs');
              await publish({ ROOT, addonDir, say: (...a) => say(' ', ...a) });
            } catch (e) { say(`  Release は更新できませんでした: ${String(e.message ?? e)}`); }
          }
        }
      }

      if (report.ok) {
        say('');
        const skipped = (realR.skipped ?? []).length;
        say(`全部通りました（${round} 回・sim ${r.total} 本 + 本物 ${realR.total} 本${skipped ? `・飛ばした ${skipped} 本` : ''}）`);
        return { ok: true, rounds: round, report, history };
      }
      if (round === rounds || !runner) {
        say('');
        say(runner ? `${rounds} 回やっても通りませんでした` : 'AI の CLI が無いので、ここからは手で往復します');
        if (!runner) {
          makeHandoff({ ROOT, addonDir, specsDir, say, missing: await ensureMaterials({ ROOT, say: () => {} }) });
          say('');
          say('  1. 上の zip を AI に渡す（作りたいものは TASK.md に入っています）');
          say('  2. 返ってきた zip を npm run cycle -- <返信.zip> に渡す');
        }
        return { ok: false, reason: runner ? 'rounds' : 'no-agent', rounds: round, report, history };
      }

      // ここは手元の AI CLI に直接渡す指示文（PROMPT.md）だけが要る。zip は使わないので BDS は同梱しない
      const { prompt } = makeHandoff({ ROOT, addonDir, specsDir, say: () => {}, extra: stuckNote(seen, report.results), withBds: false });
      const file = path.join(ROOT, '.bds-lab', 'handoff', 'PROMPT.md');
      fs.writeFileSync(file, prompt);
      say('');
      say(`AI に直させています（${runner.bin}）…`);
      const res = spawnSync(runner.bin, runner.args(path.relative(ROOT, file)), { cwd: ROOT, stdio: 'inherit', timeout: 30 * 60000 });
      if (res.status !== 0) say(`  ${runner.bin} が終了コード ${res.status} で終わりました。そのまま次の検証に進みます`);
    }
  } finally {
    await session.close();
  }
  return { ok: false, rounds, history };
}
