"""The server list line (MOTD) written live: players online and the time, per ping (ServerListPingEvent).
BDS shows the fixed server-name from server.properties."""
import datetime

from endstone.event import ServerListPingEvent, event_handler
from endstone.plugin import Plugin


class Motd(Plugin):
    api_version = "0.11"
    prefix = "Motd"

    def on_enable(self) -> None:
        self.register_events(self)

    @event_handler
    def on_ping(self, e: ServerListPingEvent) -> None:
        n = len(self.server.online_players)
        e.motd = f"§a{n}人がプレイ中 §7{datetime.datetime.now():%H:%M}"
        e.level_name = "lab world" if n == 0 else ", ".join(p.name for p in self.server.online_players)[:40]
