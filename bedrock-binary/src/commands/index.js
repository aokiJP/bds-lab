// コマンドの一覧。ヘルプはこの順で表示する
import { start, doctor } from './getting-started.js';
import { fetchCmd, apk, track } from './acquire.js';
import { scan, info, enumCmd, strings } from './analyze.js';
import { sources, names } from './sources.js';
import { docs, report, diff } from './output.js';

export const COMMANDS = Object.fromEntries(
  Object.entries({ start, doctor, fetch: fetchCmd, apk, track, scan, info, enum: enumCmd, strings, sources, names, docs, report, diff }),
);
