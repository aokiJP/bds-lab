"""A sidebar per player: everyone sees their own position and ping (a private Scoreboard per player).
BDS has one scoreboard for the whole world: a sidebar is the same for everybody."""
import math

from endstone import Player
from endstone.event import PlayerJoinEvent, PlayerQuitEvent, event_handler
from endstone.plugin import Plugin
from endstone.scoreboard import Criteria, DisplaySlot, Objective, ObjectiveSortOrder, Scoreboard


class Sidebar(Plugin):
    api_version = "0.11"
    prefix = "Sidebar"

    def on_enable(self) -> None:
        self.boards: dict[str, tuple[Scoreboard, Objective]] = {}
        self.register_events(self)
        for p in self.server.online_players:
            self.give(p)
        self.server.scheduler.run_task(self, self.update, delay=10, period=10)

    def give(self, p: Player) -> None:
        sb = self.server.create_scoreboard()
        o = sb.add_objective("me", Criteria.DUMMY, f"§e{p.name}")
        o.set_display(DisplaySlot.SIDE_BAR, ObjectiveSortOrder.DESCENDING)
        p.scoreboard = sb
        self.boards[p.name] = (sb, o)

    @event_handler
    def on_join(self, e: PlayerJoinEvent) -> None:
        self.give(e.player)

    @event_handler
    def on_quit(self, e: PlayerQuitEvent) -> None:
        self.boards.pop(e.player.name, None)

    def update(self) -> None:
        for p in self.server.online_players:
            b = self.boards.get(p.name)
            if not b:
                continue
            o = b[1]
            loc = p.location
            for k, v in (("§bX", math.floor(loc.x)), ("§bY", math.floor(loc.y)), ("§bZ", math.floor(loc.z)), ("§aping", p.ping)):
                o.get_score(k).value = v
