// ホストへ渡す口（SB_RUNTIME の戻り値）

function console_(level) {
  return (...a) => log(level, a.map((x) => fmt(x)).join(' '));
}

return {
  buildModule,
  setVersions,
  startup,
  beginTick,
  step,
  report,
  coverage,
  running: () => S.running,
  currentTick: () => S.tick,
  logUncaught: (label, e) => { if (e instanceof SandboxNotImplemented) { notImplemented(e); return; } S.uncaught++; log('error', `${label}: ${errInfo(e).name}: ${errInfo(e).message}`, { error: errInfo(e) }); },
  enterEarly: () => { S.mode = 'early'; },
  shutdown: () => {
    const list = handlers.get('system.beforeEvents.shutdown');
    if (!list?.length) return;
    const ev = inst('ShutdownEvent', { data: {} });
    for (const { fn } of [...list]) call('system.beforeEvents.shutdown', fn, [ev], 'readonly');
  },
  logSpike: (t, ms) => log('warn', `[Watchdog] tick ${t} のスクリプト処理に ${ms}ms かかりました（スパイク）`, { watchdog: 'spike', ms }),
  markUnsupported: (k) => bump(S.unsupported, k),
  markHang: (ms) => log('error', `[Watchdog] ${S.running ?? 'スクリプト'} が ${ms}ms 以上止まりませんでした。スクリプトを停止しました`, { watchdog: 'hang', running: S.running }),
  console: { log: console_('info'), info: console_('info'), warn: console_('warn'), error: console_('error'), debug: console_('debug') },
  random,
  now,
  wireAll() {
    wireSignals('WorldAfterEvents', 'world.afterEvents', API.modules['@minecraft/server']);
    wireSignals('WorldBeforeEvents', 'world.beforeEvents', API.modules['@minecraft/server']);
    wireSignals('SystemAfterEvents', 'system.afterEvents', API.modules['@minecraft/server']);
    wireSignals('SystemBeforeEvents', 'system.beforeEvents', API.modules['@minecraft/server']);
  },
  // vcommands からも同じ仕組みを使う（比較用に、直接コマンドを流す）
  runCommandDirect(cmd, playerName) {
    const p = playerName ? playerByName(playerName) : null;
    try {
      const r = withMode('normal', () => runCommand({ dim: p?.dim ?? 'minecraft:overworld', pos: p ? Vec(p.loc) : { x: 0, y: 0, z: 0 }, entity: p }, cmd));
      return $JSON.stringify({ ok: true, successCount: H.get(r).data.successCount });
    } catch (e) {
      return $JSON.stringify({ ok: false, error: errInfo(e) });
    }
  },
};
