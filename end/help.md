## py
`py <code>` runs Python inside the server, on the server thread, through the lab's helper plugin (`scriptevent lab:py`, loaded only on lab servers).
An expression prints its value; statements run as a function body, so `return x` works: `py S.n = 3\nreturn S.n * 2`.
Names: `server`, `plugin` (the plugin under test, as Endstone loaded it), `p(name)` (last joined player without a name), `cmd("say hi")`, `dim("overworld")`, `inv(p)`, `block(x,y,z)`, `S` (a namespace kept for the whole run), `endstone`, `fmt(v)`.
Values print short: Player → name, ItemStack → `diamond*3`, Block → `stone@1,2,3`, Location → `x,y,z`, objects → `{field=value ...}`.

## events
`events on [PlayerJoinEvent PlayerChatEvent ...]` registers a MONITOR handler for every Endstone event class (names with or without "Event" filter them).
Output: `EV <Class> field=value ...` after all plugins handled it, so `is_cancelled=True` shows the final decision. `events off` stops printing.
`states on [health location inventory ...]` polls each player every tick and prints changes: `ST A location=3,-60,0`; the first line per player is `init`.
Script API events (bp/scripts) instead: `sapi events on`.

## reload
`do` after an edit: the lab asks the helper to forget your package's modules, sends Endstone's `/reload` (plugins + scripts), and waits for the helper to report back. Players stay; your plugin's on_disable/on_load/on_enable run again.
Changed pyproject.toml (entry point, name) or packs: `reload --full` (restart, world kept). If /reload does not come back, the lab restarts by itself.
Module-level state is rebuilt on reload; keep what must survive in `self.data_folder` files.

## cpp
`new <name> --cpp`: CMakeLists.txt (FetchContent endstone at the pinned tag + `endstone_add_plugin`) and `src/<name>.cpp` with `ENDSTONE_PLUGIN("name", "version", Class) { ... }`.
Needs cmake and a C++20 compiler: Linux clang + libc++ (Endstone's requirement), Windows MSVC. The first build fetches Endstone's headers (network). The built library goes into each lab server's plugins/.
`trace`/`cov`/`prof`/`py` see Python only; for C++ use `logger` output, `events on`, `states on`, `py` to inspect the world.

## server
The lab keeps a Python venv at `.lab/py` with `endstone` from PyPI (pinned to the release line that supports this BDS; `LAB_ENDSTONE="endstone==x.y.z"` overrides; `LAB_PYTHON` picks the interpreter) and lets Endstone download the BDS it supports into `.lab/bds`.
Each server instance gets its own entry-point metadata for your plugin (no pip install per run), so your src/ is what runs and instances never mix.
`server` shows versions · `server --update` newest compatible Endstone + its BDS · `server 0.11.12` a specific Endstone.
Endstone keeps IPv6 off by default; the lab needs no IPv6 shim here.
macOS: Endstone ships no macOS wheels, so the venv, Endstone and its BDS live in the lab's linux/amd64 container (`help human`); pyright on the host reads the container venv's site-packages, Python syntax checks use the host's python3 when there is one. C++ plugins build in the same image (cmake, ninja, clang, libc++).

## packets
`packets on [name|id ...]` taps PacketReceiveEvent/PacketSendEvent (Endstone): `PK A> name {decoded}` from the client, `PK A< name {..}` to it. Decoded on the host with the real player's protocol tables (installed by the first `@A join`; ids + hex before that). Without names the per-tick noise (chunks, movement, attributes, sounds, auth input) is hidden. `packets drop <name|id> [n] [in|out]` cancels the next n: how does the plugin (or the client) cope with a lost packet. `packets off`.
## fuzz
`fuzz <command> [n] [seed]` calls the command's on_command n times with arguments generated from its `usages` (`<n: int>` → 0 -1 2147483647 abc ..., str → empty, unicode, 300 chars, quotes; player/target → online names, @a, nobody; enums → each value + a wrong one; optionals sometimes left out). Each distinct failure once: `E FUZZ ValueError: .. (src/../plugin.py:23) <- /cmd abc`. Same seed = same inputs.
## lag
`lag <ms> [ticks]` sleeps on the server thread every tick (TPS drops as on a busy server): timers, scheduler tasks, movement checks. `perf` shows the effect. `watch <expr>` / `watch off`: a Python expression evaluated every tick, `W expr = value` on change.
## ideas
What Endstone does that BDS scripts cannot. Each is a working sample in plugins/<name>/ (tests.txt passes on the real server). Read plugins/<name>/src/endstone_<name>/plugin.py (~50 lines) and its tests.txt, then write yours in `new <yours>`:
- webapi: an HTTP API in the server (GET /status, POST /say with a token): threading + a snapshot the server thread refreshes
- bossbar: per-player boss bars (`server.create_boss_bar`, `bar.add_player`)
- toast: toast cards (`player.send_toast`)
- sidebar: a private sidebar per player (`server.create_scoreboard()` → `player.scoreboard = sb`)
- whois: IP, ping, device, OS, language, client version (`player.address/ping/device_os/locale/game_version`)
- guard: a no-entry zone (cancel `PlayerMoveEvent` + pull back what slips through)
- antispam: drop raw packets before the game sees them (`PacketReceiveEvent`, `is_cancelled`)
- hub: send a player to another server (`player.transfer(host, port)`)
- motd: the server list line per ping (`ServerListPingEvent.motd/level_name`); test with `serverping`
- sqlstats: SQLite statistics + leaderboard across restarts (`sqlite3`, `self.data_folder`)
- skinpng: players' skins as PNG files (`player.skin.image` numpy RGBA)
- pixelmap: pixel art on map items (`server.create_map`, `MapRenderer.render` → `canvas.set_pixel_color`, `MapMeta.map_view`)
- qrmap: any PyPI library (`lib add qrcode`): a QR code drawn on a map
- abilities: flight and walking speed per player (`player.allow_flight`, `walk_speed`)
- i18n: every player in their own game language (`player.locale`), one broadcast → each player's language
- tempban: refuse a login with a reason and time left (`PlayerLoginEvent.kick_message` + `is_cancelled`), kept in a JSON file
- worldpng: the land as a PNG file + map item (`dim.get_highest_block_at(x, z)`, zlib PNG writer, `MapRenderer`)
- livemap: a live web map in the browser (HTTP server thread + a PNG of the land, redrawn one row per tick, player dots, auto-refreshing page)
- cmdguard: see/cancel/rewrite every typed command, vanilla too (`PlayerCommandEvent.command` settable): full mute, aliases, a command log
- report: a report system (`/report` for everyone, `/reports` for ops through `permissions` with `"default": "op"`, an enum argument `(clear)<action: ReportsClear>`), kept in SQLite with a per-pair cooldown that holds over a restart
More in the same vein: raw packets out (`player.send_packet`), `player.kick`, server stats (`server.average_tps/mspt`), outbound HTTP/WebSocket libraries (Discord bridges) in a thread, file backups, numpy/Pillow image work, C++ plugins (`new --cpp`) for anything the Python API lacks.
