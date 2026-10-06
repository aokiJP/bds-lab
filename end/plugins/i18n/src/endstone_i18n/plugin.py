"""Every player reads the server in their own game language (Player.locale): the join greeting, /rules and operator
announcements (/announce <key>, one broadcast, each player gets their language). /lang <code|auto> overrides it and is
remembered across restarts. BDS scripts cannot see a player's language."""
import json

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.event import PlayerJoinEvent, event_handler
from endstone.plugin import Plugin

TEXT = {
    "en": {"welcome": "Welcome, {name}!", "rules": "Rules: 1. Be kind 2. No griefing 3. Have fun", "restart": "The server restarts in 5 minutes", "event": "Event starts at spawn now!", "lang": "Language: {lang}"},
    "ja": {"welcome": "ようこそ、{name}さん！", "rules": "ルール: 1. やさしく 2. 荒らし禁止 3. 楽しもう", "restart": "5分後にサーバーを再起動します", "event": "スポーン地点でイベント開始！", "lang": "言語: {lang}"},
    "es": {"welcome": "¡Bienvenido, {name}!", "rules": "Reglas: 1. Sé amable 2. Nada de grief 3. Diviértete", "restart": "El servidor se reinicia en 5 minutos", "event": "¡El evento empieza ahora en el spawn!", "lang": "Idioma: {lang}"},
    "zh": {"welcome": "欢迎，{name}！", "rules": "规则：1. 友善 2. 禁止破坏 3. 玩得开心", "restart": "服务器将在5分钟后重启", "event": "活动现在在出生点开始！", "lang": "语言：{lang}"},
    "ko": {"welcome": "환영합니다, {name}님!", "rules": "규칙: 1. 친절하게 2. 테러 금지 3. 즐기기", "restart": "5분 후 서버가 재시작됩니다", "event": "스폰에서 이벤트가 시작됩니다!", "lang": "언어: {lang}"},
    "de": {"welcome": "Willkommen, {name}!", "rules": "Regeln: 1. Sei nett 2. Kein Griefing 3. Viel Spaß", "restart": "Der Server startet in 5 Minuten neu", "event": "Das Event beginnt jetzt am Spawn!", "lang": "Sprache: {lang}"},
    "fr": {"welcome": "Bienvenue, {name} !", "rules": "Règles : 1. Soyez gentil 2. Pas de grief 3. Amusez-vous", "restart": "Le serveur redémarre dans 5 minutes", "event": "L'événement commence au spawn !", "lang": "Langue : {lang}"},
}
KEYS = ["restart", "event"]


class I18n(Plugin):
    api_version = "0.11"
    prefix = "I18n"
    commands = {
        "rules": {"description": "Server rules in your language", "usages": ["/rules"], "permissions": ["i18n.command.rules"]},
        "lang": {"description": "Choose the server's language for you", "usages": ["/lang [code: str]"], "permissions": ["i18n.command.lang"]},
        "announce": {"description": "Tell everyone, each in their language", "usages": ["/announce <key: str>"], "permissions": ["i18n.command.announce"]},
    }
    permissions = {
        "i18n.command.rules": {"description": "Use /rules", "default": True},
        "i18n.command.lang": {"description": "Use /lang", "default": True},
        "i18n.command.announce": {"description": "Use /announce", "default": "op"},
    }

    def on_enable(self) -> None:
        self.file = self.data_folder / "lang.json"
        self.data_folder.mkdir(parents=True, exist_ok=True)
        self.chosen: dict[str, str] = json.loads(self.file.read_text("utf-8")) if self.file.exists() else {}
        self.register_events(self)

    def lang(self, p: Player) -> str:
        code = self.chosen.get(p.name) or p.locale.split("_")[0].lower()
        return code if code in TEXT else "en"

    def t(self, p: Player, key: str, **kw: str) -> str:
        return TEXT[self.lang(p)][key].format(**kw)

    @event_handler
    def on_join(self, e: PlayerJoinEvent) -> None:
        e.player.send_message(self.t(e.player, "welcome", name=e.player.name))

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if command.name == "announce":
            if not args or args[0] not in KEYS:
                sender.send_error_message(f"keys: {' '.join(KEYS)}")
                return True
            for p in self.server.online_players:
                p.send_message(f"§e{self.t(p, args[0])}")
            sender.send_message(f"announced {args[0]} to {len(self.server.online_players)} players")
            return True
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        if command.name == "rules":
            sender.send_message(self.t(sender, "rules"))
        elif command.name == "lang":
            if args and args[0] != "auto" and args[0] not in TEXT:
                sender.send_error_message(f"languages: auto {' '.join(TEXT)}")
                return True
            if args:
                self.chosen.pop(sender.name, None) if args[0] == "auto" else self.chosen.update({sender.name: args[0]})
                self.file.write_text(json.dumps(self.chosen), "utf-8")
            sender.send_message(self.t(sender, "lang", lang=f"{self.lang(sender)} ({sender.locale})"))
        return True
