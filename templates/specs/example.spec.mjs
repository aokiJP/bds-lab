/** @type {import('../types/spec').Spec[]} */
export default [
  {
    name: 'パックが読める',
    why: '最初の関門',
    async run(t) {
      await t.expectLoadLog(/__TAG__ loaded/);
      await t.expectNoLog(/SyntaxError|ReferenceError/);
    },
  },
  {
    name: 'status が返る',
    why: '入口が生きている',
    async run(t) {
      await t.spawn();
      await t.send('__NS__:status');
      await t.expectLog(/__TAG__ status/);
    },
  },
  {
    name: '本物のクライアントの入力が届く',
    why: 'SimulatedPlayer では確かめられないところ',
    tags: ['real'],
    async run(t) {
      await t.gamemode('Creative');
      await t.tp({ x: 0, y: -39, z: 0 }, { x: 0, y: 0 });
      const a = await t.read('location');
      await t.move(0, 1);
      await t.ticks(20);
      await t.stop();
      const b = await t.read('location');
      t.note(`前進 20 tick: Δx=${(b.x - a.x).toFixed(3)} Δz=${(b.z - a.z).toFixed(3)}`);
      t.expect(Math.abs(b.z - a.z) + Math.abs(b.x - a.x) > 0.5, '前進の入力が届いていません');
      await t.expectNoLog(/SyntaxError|ReferenceError|TypeError/);
    },
  },
];
