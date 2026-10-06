---
name: bds-deliver
description: Hand a finished addon to the person who asked: the file, how to install it (beta APIs, permissions, their own server), and an honest report in their language. Use after go says DONE (and the quality pass), for new and fixed addons alike.
---

# Delivering

1. The file: `go`'s DONE line names it (bds/dist/<Name>.mcaddon; a fixed addon keeps its pack UUIDs, one version up, so worlds update in place).
2. Install notes from the manifest: beta modules (x.y.z-beta) need the world's "Beta APIs" experiment and work only on this game version; @minecraft/server-net / server-admin need the server's permissions.json. Their own BDS: `node lab.mjs deploy <BDS folder> <unit>` does packs, permissions and the experiment (stop the server first; `--undo`).
   Endstone plugin: the .whl from DONE (end/dist/) goes into the server's plugins/ (or `pip install` it in Endstone's Python); its data lives in plugins/<name>/. LeviLamina mod: unzip ll/dist/<n>-<ver>.zip into plugins/ (it needs LegacyScriptEngine-quickjs).
Not for making it pass (`bds-quality` comes first).

3. Done when they have the file and these notes. The report, in the person's language, short: what they asked → done (proven by which test sections on the real server); what you fixed or decided unasked; what is left or only guessed (TASK.md "Guessed"); how to install.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- On beta modules: tell them to turn on the world's Beta APIs experiment and that it works only on this Minecraft version; prefer stable when the request allows (go tries it). (when missed: the addon does nothing in their world) `deliver-beta`
- Say which request lines a real-server test proves, and list guesses and unasked changes apart; never claim a look or a feel nobody saw. (when missed: a report the person cannot trust) `deliver-honest` [source]
- A fixed addon keeps its pack UUIDs and goes one version up (go does it after import): their worlds take it as an update. (when missed: two copies of the addon in their world, or the old one kept) `deliver-update`
<!-- rules:end -->
