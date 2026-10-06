---
name: bds-script-api
description: Write @minecraft/server Script API code that works on the real BDS: load order, before-events, scoreboards, saved data, removed or beta-only APIs. Use when writing or fixing src/main.ts or bp/scripts.
---

# Script API on the real server

Not for forms (`bds-forms`), tests.txt (`bds-tests`) or item / block JSON (`bds-content`).

1. Use kit (src/kit.ts, see AGENTS.md) for commands, forms, items, saved data: it is tested on this BDS.
2. Look an API up instead of guessing: `node lab.mjs api <Class|Class.member|?word>`; a whole file of uses against this BDS: `node lab.mjs brief`.
3. Type errors come with a fix after → ; fix the first, build again.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- No world.* at the top level of a script (it throws while the world loads): do it in kit ready(() => ...) or world.afterEvents.worldLoad. (when missed: TypeError / early execution at load; the addon does nothing) `api-early`
- A before-event is read-only: teleport, give, addScore/setScore, addTag and set blocks in system.run(() => ...) inside it (setDynamicProperty and sendMessage work directly). (when missed: "Native function ... cannot be used in restricted execution") `api-before-readonly`
- objective.getScore(p) throws "Failed to resolve identity" until p has a score in some objective; hasParticipant is false then. Use addScore(p, n) (it creates the score) or hasParticipant(p) ? getScore(p) : 0. (when missed: works in a test that sets a score first, crashes for a new player) `api-score-identity`
- runCommandAsync is gone in @minecraft/server 2.x: use runCommand (or the API itself: teleport, addItem). (when missed: TypeError: not a function after a game update) `api-runcommand`
- world.beforeEvents.chatSend exists only in beta modules (node lab.mjs mode beta); on stable, make the chat word a custom command (kit cmd). (when missed: cannot read property 'subscribe' of undefined at load) `api-chatsend-beta`
- A module version x.y.z-beta exists only in the BDS it was made for; stable versions carry over to newer BDS. (when missed: "@minecraft/server 1.9.0-beta is not in this BDS" after an update) `api-beta-versions`
- What scripts keep in variables (Map, object) is lost on /reload and restart; what must survive goes into dynamic properties (kit save/load). (when missed: "my homes disappear after a restart") `api-state-persist`
<!-- rules:end -->

Done when `node lab.mjs go` is DONE (tests on a fresh real server, then QA: 3 players, rejoin, /reload, restart, closed forms, edge values). Report beta APIs used (mode) and any code no test reaches (`gaps`); say so rather than call it working.
