## lse
`lse <code>` runs JavaScript inside your mod's own script (the lab bundles its helper in front of your code for lab runs only; `pack` leaves it out).
An expression prints its value; statements run as an async function body: `lse const pl = p('A'); return pl.health`.
Names: `mc`, `ll`, `logger`, `p(name)` (last joined without a name), `run("cmd")` → the command's output, `inv(p)`, `block(x,y,z,dim)`, `$` (kept for the run), `fmt(v)`, plus your mod's top-level functions and variables.
Values print short: Player → name, Item → `diamond*3`, Block → `stone@1,2,3`, pos → `x,y,z`.
Native mods: the helper runs alone as plugins/lab_lse, so `lse` sees the world but not your C++.

## events
`events on [onJoin onChat ...]` listens to the LSE events and prints `EV <event> <args...>` (before-style events print before your handler's decision). `events off` stops printing.
`states on [health pos inventory ...]` prints player property changes each tick: `ST A pos=3,-60,0`.
`perf [ms]` measures tick time from onTick (TPS, max tick).
Script API events (bp/scripts): `sapi events on`.

## reload
`do` after an edit: rebuild, `ll unload <mod>`, copy the new files over (config/data you wrote stay), `ll load <mod>`, wait for the helper. Players stay.
Native mods: the DLL is unloaded before it is replaced. If the mod does not come back the lab restarts (world kept).

## native
`new <name> --native`: the levilamina-mod-template layout (xmake.lua, `src/mod/<Mod>.cpp` with load/enable/disable + `LL_REGISTER_MOD`, a command through `ll::command::CommandRegistrar`).
Build: Windows with xmake + Visual Studio 2022 (MSVC); `check`/`run` call `xmake f -m release --target_type=server` then `xmake`. Output: `bin/<Mod>/` which the lab deploys.
On Linux there is no build: build on Windows (or CI, windows-latest) and the lab tests the existing `bin/<Mod>/` under Wine.

## wine
On Linux the server is BDS for Windows + LeviLamina under Wine (like the official Docker image and Pterodactyl egg). Needs `wine` (64-bit; Debian/Ubuntu: `sudo dpkg --add-architecture i386 && sudo apt install wine64 wine32 winetricks`).
The lab uses its own prefix `.lab/wine` (`WINEDEBUG=-all`). If the server stops with 0xc0000135 or a missing vcruntime/msvcp140: `WINEPREFIX=$PWD/.lab/wine winetricks -q vcrun2022`.
lip.exe (the installer) may need .NET under Wine; the lab tries `winetricks -q dotnet10` once when lip says so.
A fresh prefix is prepared once by itself: `wineboot -i` + `winetricks -q vcrun2022` (marker `.lab/wine/.lab-vcrun2022`).
macOS: Wine runs inside the lab's linux/amd64 container (`help human`), the same path as Linux. Alternative: `LAB_RUNTIME=native LAB_WINE=wine64` with a macOS Wine (e.g. wine-crossover), untested; or `LAB_LL_SERVER` with a server made on Windows.

## server
`.lab/bds` holds a LeviLamina server installed by lip: LeviLamina (`LAB_LL_VERSION`, default 26.51.5 = BDS 1.26.51.1) and LegacyScriptEngine QuickJS (`LAB_LSE_VERSION`); other engines are added when a mod's manifest asks for them.
Or bring one: `LAB_LL_SERVER=/path/to/levilamina-server` (a folder or zip with bedrock_server_mod.exe, e.g. made on Windows with `lip install github.com/LiteLDev/LeviLamina`).
`server` shows versions · `server --update` reinstalls.

## bots
`bots <n> [x y z] [walk]` spawns n LeviLamina simulated players (mc.spawnSimulatedPlayer: real Player objects on the server, no network, no client): multi-player logic, join/leave handlers, load with `perf`. `walk` moves them around the spot every 2 s (simulateMoveTo). `bots off` disconnects them. For what a real client sends (forms, inventory screens), use `@A join`.
## crash
LeviLamina's CrashLogger writes a symbolized native stack to logs/crash/trace_*.log; after a crash the lab prints it under the crash line, your mod's frames first (`crash report trace_... (2 frame(s) in <mod>)`). `lag <ms> [ticks]` stalls the server thread; `watch <expr>` / `watch off` evaluates in the mod's context every tick.
## ideas
What LeviLamina (LegacyScriptEngine) does that BDS scripts cannot. Each is a working sample in mods/<name>/ (tests.txt passes on the real server). Read mods/<name>/src/main.ts (~30 lines) and its tests.txt, then write yours in `new <yours>`:
- sidebar: a private sidebar per player (`pl.setSidebar(title, {line: n})`)
- bossbar: per-player boss bars (`pl.setBossBar(uid, title, percent, colour)`, `removeBossBar`)
- toast: toast cards (`pl.sendToast`)
- whois: IP, ping, packet loss, OS, client id (`pl.getDevice()`)
- hub: send a player to another server (`pl.transServer(host, port)`)
- motd: the server list line (`mc.setMotd`); test with `serverping`
- sqlstats: SQLite across restarts (`new DBSession('sqlite3', {path})`, `prepare/bind/execute`, `query`)
- chatlog: write files (`File.mkdir/writeLine/readFrom`)
- unbreakable: read/write item NBT (`it.getNbt()` → NbtCompound, `setTag('Unbreakable', new NbtByte(1))`, `it.setNbt`, `pl.refreshItems()`)
- money: a shared economy (LegacyMoney `money.add/get/trans`); offline servers have no xuid: key accounts by uuid
- i18n: every player in their own game language (`pl.langCode`), one broadcast → each player's language
- tempban: refuse a login with a reason and time left (`onPreJoin`: `pl.kick(msg)`, return false), kept in a JSON file
- cmdguard: see/cancel every typed command, vanilla too (`onPlayerCmd` return false; `pl.runcmd` for aliases, which comes back through onPlayerCmd): full mute, aliases, a command log
- warps: named warp points (`mc.newCommand(name, desc, PermType.GameMasters)` for ops, `pl.feetPos`/`direction`, `pl.teleport` across dimensions), kept in a JSON file (`File.writeTo`), 10 s per player between warps
More: block/entity NBT (`block.getBlockEntity().getNbt()`, `entity.getNbt()`), `mc.spawnSimulatedPlayer`, forms with custom callbacks, `network.httpGet/httpPost` and WebSocket clients, other mods' functions (`ll.exports/imports`), native C++ mods (`new --native`) with hooks into any game function.
Known: LSE 0.22.1's HttpServer throws bad_function_call after binding under Wine: serve HTTP from Endstone (end lab) instead.
