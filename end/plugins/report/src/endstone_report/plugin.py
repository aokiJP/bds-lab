"""通報システム: /report <プレイヤー> <理由> を SQLite に保存し、OP は /reports で確認、/reports clear <番号> で処理済みにする。"""
import sqlite3
import time

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.event import PlayerJoinEvent, event_handler
from endstone.plugin import Plugin

MAX_REASON = 200


class Report(Plugin):
    api_version = "0.11"
    prefix = "Report"

    commands = {
        "report": {
            "description": "プレイヤーを通報する",
            "usages": ["/report <player: str> <reason: message>"],
            "permissions": ["report.command.report"],
        },
        "reports": {
            "description": "通報一覧 (OP)",
            "usages": ["/reports", "/reports (clear)<action: ReportsClear> <id: int>"],
            "permissions": ["report.command.reports"],
        },
    }
    permissions = {
        "report.command.report": {"description": "Use /report", "default": True},
        "report.command.reports": {"description": "Use /reports", "default": "op"},
    }

    # settable so tests can shorten them
    cooldown_seconds = 60.0
    list_size = 10

    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.data_folder / "reports.db")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL,"
            " target TEXT NOT NULL, reason TEXT NOT NULL, created REAL NOT NULL, handled INTEGER NOT NULL DEFAULT 0,"
            " handled_by TEXT)"
        )
        self.db.execute("CREATE TABLE IF NOT EXISTS seen (name TEXT PRIMARY KEY COLLATE NOCASE)")
        self.db.commit()
        self.register_events(self)

    def on_disable(self) -> None:
        self.db.close()

    @event_handler
    def on_player_join(self, event: PlayerJoinEvent) -> None:
        self.db.execute("INSERT OR IGNORE INTO seen (name) VALUES (?)", (event.player.name,))
        self.db.commit()

    def resolve_target(self, name: str) -> str | None:
        online = self.server.get_player(name)
        if online is not None:
            return online.name
        for pl in self.server.online_players:
            if pl.name.lower() == name.lower():
                return pl.name
        row = self.db.execute("SELECT name FROM seen WHERE name = ?", (name,)).fetchone()
        return row[0] if row else None

    def do_report(self, sender: CommandSender, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("通報はプレイヤーだけができます")
            return True
        if len(args) < 2:
            return False
        reason = " ".join(args[1:]).strip()
        if not reason:
            sender.send_error_message("理由を書いてください")
            return True
        reason = reason[:MAX_REASON]
        target = self.resolve_target(args[0].strip().lstrip("@").strip('"'))
        if target is None:
            sender.send_error_message(f"プレイヤー {args[0]} が見つかりません")
            return True
        if target.lower() == sender.name.lower():
            sender.send_error_message("自分自身は通報できません")
            return True
        now = time.time()
        row = self.db.execute(
            "SELECT MAX(created) FROM reports WHERE reporter = ? AND target = ? COLLATE NOCASE",
            (sender.name, target),
        ).fetchone()
        if row and row[0] is not None and now - row[0] < self.cooldown_seconds:
            left = int(self.cooldown_seconds - (now - row[0])) + 1
            sender.send_error_message(f"{target} はさっき通報しました。あと {left} 秒待ってください")
            return True
        cur = self.db.execute(
            "INSERT INTO reports (reporter, target, reason, created) VALUES (?, ?, ?, ?)",
            (sender.name, target, reason, now),
        )
        self.db.commit()
        rid = cur.lastrowid
        sender.send_message(f"§a通報 #{rid} を受け付けました: {target} ({reason})")
        for pl in self.server.online_players:
            if pl.has_permission("report.command.reports") and pl.name != sender.name:
                pl.send_message(f"§e[通報] #{rid} {sender.name} → {target}: {reason}")
        self.logger.info(f"report #{rid} {sender.name} -> {target}: {reason}")
        return True

    def do_reports(self, sender: CommandSender, args: list[str]) -> bool:
        if not args:
            rows = self.db.execute(
                "SELECT id, reporter, target, reason, created FROM reports WHERE handled = 0 ORDER BY id DESC LIMIT ?",
                (self.list_size,),
            ).fetchall()
            total = self.db.execute("SELECT COUNT(*) FROM reports WHERE handled = 0").fetchone()[0]
            if not rows:
                sender.send_message("未処理の通報はありません")
                return True
            sender.send_message(f"未処理の通報 {total} 件 (新しい順に最大{self.list_size}件):")
            for rid, reporter, target, reason, created in rows:
                when = time.strftime("%m/%d %H:%M", time.localtime(created))
                sender.send_message(f"#{rid} {when} {reporter} → {target}: {reason}")
            return True
        if args[0] != "clear" or len(args) < 2:
            return False
        try:
            rid = int(args[1])
        except ValueError:
            return False
        row = self.db.execute("SELECT handled FROM reports WHERE id = ?", (rid,)).fetchone()
        if row is None:
            sender.send_error_message(f"通報 #{rid} はありません")
            return True
        if row[0]:
            sender.send_error_message(f"通報 #{rid} はすでに処理済みです")
            return True
        self.db.execute("UPDATE reports SET handled = 1, handled_by = ? WHERE id = ?", (sender.name, rid))
        self.db.commit()
        sender.send_message(f"§a通報 #{rid} を処理済みにしました")
        return True

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if command.name == "report":
            return self.do_report(sender, args)
        if command.name == "reports":
            return self.do_reports(sender, args)
        return True
