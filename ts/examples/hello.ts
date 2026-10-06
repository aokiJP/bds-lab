// node lab.mjs ts ts/examples/hello.ts: runs once, now (the last expression is the answer)
say("hello from the workspace");
world.getAllPlayers().map((p) => `${p.name} @ ${Math.floor(p.location.x)},${Math.floor(p.location.y)},${Math.floor(p.location.z)}`)
