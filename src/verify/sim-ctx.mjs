import { baseCtx } from './spec-runner.mjs';

export function makeSimCtx(session) {
  return async () => {
    await session.do('despawn').catch(() => {});
    session.bridge?.reset();
    const take = session.since();
    const { t, notes } = baseCtx({ logsOf: take, ticks: (n) => session.ticks(n) });

    Object.assign(t, {
      session,
      spawn: (args) => session.do('spawn', args),
      gamemode: (mode) => session.do('gamemode', { mode }),
      tp: (at, rotation) => session.do('tp', { at, rotation }),
      look: (yaw, pitch = 0) => session.do('look', { yaw, pitch }),
      move: (x, y) => session.do('move', { x, y }),
      stop: () => session.do('stop'),
      jump: () => session.do('jump'),
      sneak: (on) => session.do('sneak', { on }),
      hold: (button, on) => session.do('button', { button, state: on ? 'Pressed' : 'Released' }),
      read: (what) => session.do('read', { what }),
      component: (id) => session.do('component', { id }),
      api: (p) => session.do('api', { path: p }),
      reflect: (depth = 2) => session.do('reflect', { depth }, { timeoutMs: 30000 }),
      entities: (type = null, radius = 32) => session.do('entities', { type, radius }),
      give: (item, count = 1, slot = null) => session.do('give', { item, count, slot }),
      setBlock: (at, block = 'minecraft:stone') => session.do('setBlock', { at, block }),
      health: () => session.do('health'),
      attack: (type = null, radius = 8) => session.do('attackNearest', { type, radius }),
      use: () => session.do('use'),
      dig: (at) => session.do('breakBlock', { at }),
      send: (id, message = '') => session.do('send', { id, message }),
      cmd: (command) => session.do('cmd', { command }),
      logsSinceLoad: () => session.sinceLoad(),
      async expectLoadLog(re) {
        for (let i = 0; i < 20; i++) {
          if (session.sinceLoad().some((l) => re.test(l))) return true;
          await session.ticks(1);
        }
        const { Failed } = await import('./spec-runner.mjs');
        throw new Failed(`読み込み時のログに ${re} が出ませんでした`);
      },
      fromAddon: () => ({ notes: [...session.bridge.notes], metrics: { ...session.bridge.metrics }, failures: [...session.bridge.failures] }),
    });
    return { t, notes };
  };
}
