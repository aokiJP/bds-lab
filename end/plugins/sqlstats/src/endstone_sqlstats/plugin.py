"""A real SQL database (SQLite) of player statistics: /stats [name], /top <blocks|deaths|joins>.
BDS scripts store only small dynamic properties: no queries, no sorting, no sharing with other programs."""
import sqlite3

from endstone.command import Command, CommandSender
from endstone.event import BlockBreakEvent, PlayerDeathEvent, PlayerJoinEvent, event_handler
from endstone.plugin import Plugin

COLS = ("blocks", "deaths", "joins")


class Sqlstats(Plugin):
    api_version = "0.11"
    prefix = "Stats"
    commands = {
        "stats": {"description": "A player's statistics", "usages": ["/stats [name: str]"], "permissions": ["sqlstats.command"]},
        "top": {"description": "Leaderboard", "usages": ["/top (blocks|deaths|joins)<what: TopWhat>"], "permissions": ["sqlstats.command"]},
    }
    permissions = {"sqlstats.command": {"description": "Use /stats and /top", "default": True}}

    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.data_folder / "stats.db")
        self.db.execute("CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, blocks INT DEFAULT 0, deaths INT DEFAULT 0, joins INT DEFAULT 0)")
        self.db.commit()
        self.register_events(self)

    def on_disable(self) -> None:
        self.db.close()

    def bump(self, name: str, col: str) -> None:
        self.db.execute(f"INSERT INTO stats (name, {col}) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET {col} = {col} + 1", (name,))
        self.db.commit()

    @event_handler
    def on_join(self, e: PlayerJoinEvent) -> None:
        self.bump(e.player.name, "joins")

    @event_handler(ignore_cancelled=True)
    def on_break(self, e: BlockBreakEvent) -> None:
        self.bump(e.player.name, "blocks")

    @event_handler
    def on_death(self, e: PlayerDeathEvent) -> None:
        self.bump(e.player.name, "deaths")

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if command.name == "stats":
            name = args[0] if args else sender.name
            row = self.db.execute("SELECT blocks, deaths, joins FROM stats WHERE name = ?", (name,)).fetchone()
            sender.send_message(f"{name}: " + (" ".join(f"{c} {v}" for c, v in zip(COLS, row)) if row else "no data"))
            return True
        what = args[0] if args and args[0] in COLS else "blocks"
        rows = self.db.execute(f"SELECT name, {what} FROM stats ORDER BY {what} DESC, name LIMIT 5").fetchall()
        sender.send_message(f"top {what}: " + (" | ".join(f"{i + 1}. {n} {v}" for i, (n, v) in enumerate(rows)) or "empty"))
        return True
