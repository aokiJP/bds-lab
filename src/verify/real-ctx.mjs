import { baseCtx } from './spec-runner.mjs';

/**
 * 本物のクライアントで仕様書を動かすための t。
 * 入力はクライアントが送り、値は実機の中の検証係が読む。
 * 形は sim-ctx.mjs と同じなので、同じ書き方の仕様書が両方で動く。
 */
export function makeRealCtx({ session, bot, name }) {
  return async () => {
    await session.do('attach', { name });
    const take = session.since();
    session.bridge?.reset();
    const { t, notes } = baseCtx({ logsOf: take, ticks: (n) => bot.ticks(n) });

    const held = { forward: false, back: false, left: false, right: false, jump: false, sneak: false };
    const set = (patch) => { Object.assign(held, patch); bot.setControls(held); };
    const rest = async () => { set({ forward: false, back: false, left: false, right: false, jump: false, sneak: false }); await bot.ticks(2); };

    Object.assign(t, {
      session,
      bot,
      spawn: async () => { await rest(); return { name }; },
      gamemode: async (mode) => { const r = await session.do('gamemode', { mode }); await bot.ticks(10); return r; },
      tp: async (at, rotation) => {
        const r = await session.do('tp', { at, rotation });
        bot.look(rotation?.y ?? 0, rotation?.x ?? 0);
        await bot.ticks(10);
        return r;
      },
      look: async (yaw, pitch = 0) => { bot.look(yaw, pitch); await bot.ticks(2); return { yaw, pitch }; },
      move: async (x, y) => { set({ forward: y > 0, back: y < 0, left: x > 0, right: x < 0 }); await bot.ticks(1); return { x, y }; },
      stop: async () => { set({ forward: false, back: false, left: false, right: false }); await bot.ticks(1); return {}; },
      jump: async () => { set({ jump: true }); await bot.ticks(2); set({ jump: false }); return { jumped: true }; },
      sneak: async (on) => { set({ sneak: Boolean(on) }); await bot.ticks(1); return { sneaking: Boolean(on) }; },
      hold: async (button, on) => {
        if (button === 'Jump') set({ jump: Boolean(on) });
        else if (button === 'Sneak') set({ sneak: Boolean(on) });
        await bot.ticks(1);
        return { button, on: Boolean(on) };
      },
      read: (what) => session.do('read', { what }),
      component: (id) => session.do('component', { id }),
      api: (p) => session.do('api', { path: p }),
      // 値は実機の中の検証係が読む（sim と同じ）。入力だけがクライアント側から出る
      entities: (type = null, radius = 32) => session.do('entities', { type, radius }),
      give: async (item, count = 1, slot = null) => { const r = await session.do('give', { item, count, slot }); await bot.ticks(5); if (slot !== null) bot.selectSlot(slot); return r; },
      setBlock: (at, block = 'minecraft:stone') => session.do('setBlock', { at, block }),
      health: () => session.do('health'),
      /** 本物のクライアントとして叩く。近くの相手を自分で探して、見てから殴る */
      attack: async (type = null, radius = 8) => {
        const near = bot.nearby({ type, radius });
        if (!near.length) return { hit: false, why: '近くに相手が見えません（add_entity が届いていない可能性があります）' };
        bot.lookAt(near[0]);
        await bot.ticks(2);
        bot.hitEntity(near[0].id);
        await bot.ticks(2);
        return { hit: true, typeId: near[0].type, distance: Number(near[0].distance.toFixed(2)) };
      },
      use: async () => { bot.useItem(); await bot.ticks(2); return { used: true }; },
      dig: async (at) => { const r = await bot.dig(at); return { started: true, ...r }; },
      send: async (id, message = '') => { const r = await session.do('send', { id, message }); await bot.ticks(3); return r; },
      cmd: (command) => session.do('cmd', { command }),
      logsSinceLoad: () => session.sinceLoad(),
      fromAddon: () => ({ notes: [...session.bridge.notes], metrics: { ...session.bridge.metrics }, failures: [...session.bridge.failures] }),
    });
    return { t, notes };
  };
}
