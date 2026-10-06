// bds lab: Minecraft Bedrock addons (behavior + resource packs, Script API in TypeScript) on the plain Bedrock Dedicated Server.
// Everything is the shared engine's default (common/core.mjs): this file only says what a unit is.
import fs from 'node:fs';
import path from 'node:path';

export default {
  name: 'bds', title: 'bds-lab', unitDir: 'addons', unitWord: 'addon', branchPrefix: 'addon',
  isUnit: (d) => fs.existsSync(path.join(d, 'bp', 'manifest.json')),
  selftest: `## Script API eval (js)
js return 6*7
= 42
## Script API events
events on chatSend
@A chat ev-bds
~ EV .*chatSend
`,
};
