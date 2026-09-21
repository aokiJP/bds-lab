import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'minecraft-modules.json');

export function moduleData() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

export function npmSpec(name, track = 'stable') {
  const v = moduleData()[name]?.versions?.[track]?.version;
  return v ? `@minecraft/${name}@${v}` : null;
}

/** npm の版（2.11.0-beta.1.26.51-stable）から manifest に書く版（2.11.0-beta）を作る */
export function manifestVersion(name, track = 'stable') {
  const v = moduleData()[name]?.versions?.[track]?.version;
  if (!v) return null;
  const m = /^(\d+\.\d+\.\d+)(?:-(beta|rc))?/.exec(v);
  if (!m) return v;
  return m[2] === 'beta' ? `${m[1]}-beta` : m[1];
}

export function dependencies({ beta = false, ui = true, gametest = false } = {}) {
  const track = beta ? 'beta' : 'stable';
  const out = [];
  const add = (name, t) => {
    const version = manifestVersion(name, t) ?? manifestVersion(name, 'stable');
    if (version) out.push({ module_name: `@minecraft/${name}`, version });
  };
  add('server', track);
  if (ui) add('server-ui', track);
  if (gametest) add('server-gametest', 'beta');
  return out;
}

export function typeSpecs({ beta = false } = {}) {
  const track = beta ? 'beta' : 'stable';
  return ['server', 'server-ui', 'server-gametest']
    .map((n) => npmSpec(n, n === 'server-gametest' ? 'beta' : track))
    .filter(Boolean);
}
