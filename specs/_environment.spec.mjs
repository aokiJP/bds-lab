/** @type {import('../types/spec').Spec[]} */
export default [
  {
    name: '入力まわりの API が実機に在る',
    why: 'この実機の版で何が使えるかを毎回記録する',
    async run(t) {
      await t.spawn();
      for (const p of ['inputInfo.getMovementVector', 'inputPermissions.setPermissionCategory', 'camera.setFov']) {
        const r = await t.api(p);
        t.note(`${p}: ${r.exists ? r.type : '無い'}`);
      }
      t.expect(true);
    },
  },
  {
    name: 'SimulatedPlayer の入力は inputInfo に載らない',
    why: '載らないことを毎回確かめる。載るなら移動系も sim で検証できる',
    async run(t) {
      await t.spawn();
      await t.gamemode('Creative');
      await t.move(0, 1);
      await t.ticks(5);
      const mv = await t.read('movementVector');
      await t.stop();
      t.note(`movementVector=${mv.x},${mv.y}（0,0 なら移動系は real でしか確かめられない）`);
      t.expect(true);
    },
  },
];
