---
name: levilamina-mod
description: Build a LeviLamina mod (LegacyScriptEngine, TypeScript; or C++) proven on a real LeviLamina server under Wine: commands, events, files, SQLite, economy. Use when the person runs LeviLamina, or for what BDS scripts cannot do on a Windows server.
---

# LeviLamina mod

Not for a plain BDS (`bds-script-api` addon, or `endstone-plugin` for Python).

1. `node lab.mjs ll new <n> "Title" "<request>" desc="<what it does>"` (later `node lab.mjs <cmd>` stays in ll), then read ll/AGENTS.md (one screen: commands, events, files, test lines).
2. Look up, do not guess: `node lab.mjs api <Name|Name.member|onEvent|?word>`; working mods to copy from: ll/mods/ (`help ideas`).
3. tests.txt as for addons, plus `lse <code>` lines inside the mod (`return x`); `go` = types → tests → QA → dist/<n>-<ver>.zip.

<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->
- Commands: mc.newCommand(name, desc, PermType.Any) → mandatory/optional → overload([...]) → setCallback((_c, origin, out, r) => ...) → setup(); origin.player is null from the console (out.error); tests see `@A cmd: <success text>`. (when missed: a command that never registers, or crashes from the console) `ll-command`
- Offline servers (the lab's, many private ones) give pl.xuid = "": key saved data by pl.xuid || pl.uuid. (when missed: every player shares one account) `ll-xuid`
- Data lives under ./plugins/<n>/ (File.mkdir first; JsonConfigFile, DBSession sqlite3) and survives restart: prove it with a `restart` section. (when missed: data lost, or written beside the server) `ll-files`
- Before-style events (onChat, onPlayerCmd, onDestroyBlock ...) are cancelled by returning false from the listener. (when missed: the vanilla action still happens) `ll-cancel`
- `restart` keeps plugins/<n>/ and the world and the players rejoin: a section after it proves what must survive; `lse` lines see the mod's top-level names (lab builds). (when missed: data lost on restart, untested) `ll-restart`
- Start from the closest working mod in ll/mods (`help ideas`): JSON file + op commands + cooldown → warps; SQLite → sqlstats; economy → money. (when missed: a structure guessed from scratch) `ll-template`
<!-- rules:end -->

Done when `go` is DONE and gives dist/<n>-<ver>.zip; under Wine each player action takes about 1 s and the lab waits. Tell the person it needs LegacyScriptEngine-quickjs, and that what no `lse` line or player touched is unverified (say so).
