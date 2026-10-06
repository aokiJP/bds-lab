import { world } from '@minecraft/server';
import { cmd, load, save, cooldown } from './kit';

type Home = { dim: string; x: number; y: number; z: number };

cmd('lab:sethome', 'Set your home here', {}, (p) => {
  const { x, y, z } = p.location;
  save<Home>(p, 'home', { dim: p.dimension.id, x, y, z });
  return `Home set at ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} (${p.dimension.id.replace('minecraft:', '')})`;
});
cmd('lab:home', 'Go back to your home', {}, (p) => {
  const h = load<Home | null>(p, 'home', null);
  if (!h) return 'You have no home yet: /lab:sethome';
  if (!cooldown(p, 'home', 200)) return 'Wait a little before going home again';
  p.teleport({ x: h.x, y: h.y, z: h.z }, { dimension: world.getDimension(h.dim) });
  return 'Welcome home';
});
