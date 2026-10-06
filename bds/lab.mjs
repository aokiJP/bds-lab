#!/usr/bin/env node
// CLI entry. Usage: AGENTS.md. No need to read further.
globalThis.LAB_FLAVOR = new URL('./flavor.mjs', import.meta.url).href;
await import('../common/core.mjs');
