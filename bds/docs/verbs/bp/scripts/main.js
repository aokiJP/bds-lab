// The verb check needs no behavior of its own: the lab's tap (`events on`, `states on`) and `js` run in this addon's context.
import { world } from '@minecraft/server';

world.afterEvents.worldLoad.subscribe(() => console.warn('verbs unit ready'));
