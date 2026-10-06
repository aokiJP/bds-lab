// 世界（runtime）から受け取るもの

const { S, G, DIMS, entities, objectives, identities, identityFor, displaySlots,
  hurt, setEffect, clearEffects, triggerEntityEvent, effectId,
  readBlock, writeBlock, makePerm, blockTypeId, itemId, entityTypeId, dimId, chunkLoaded,
  query, spawn, removeEntity, say, fireAfter, log, ITEM_MAX, random, fmt, addItem,
  structures, functions, rideAdd, rideEject, rideEjectAll, entityLoot, packDef } = W;
void log; void fmt; void displaySlots;

const num = (t) => { const n = Number(t); if (!Number.isFinite(n)) throw new Syntax(String(t)); return n; };

const FILL_LIMIT = 32768; // /fill と /clone の上限（バニラ）
