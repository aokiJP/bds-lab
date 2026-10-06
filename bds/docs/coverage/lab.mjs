#!/usr/bin/env node
globalThis.LAB_FLAVOR = new URL('../../flavor.mjs', import.meta.url).href;
await import('../../../common/core.mjs');
