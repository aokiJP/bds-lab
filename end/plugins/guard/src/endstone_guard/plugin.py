"""/guard <x1> <z1> <x2> <z2>: a no-entry zone. Moves into it are cancelled on the server (the client is pulled back);
BDS scripts cannot stop a player's movement, only teleport them afterwards."""
import json
import time

from endstone.level import Location
from endstone.command import Command, CommandSender
from endstone.event import PlayerMoveEvent, event_handler
from endstone.plugin import Plugin


class Guard(Plugin):
    api_version = "0.11"
    prefix = "Guard"
    commands = {"guard": {"description": "Set or clear the no-entry zone", "usages": ["/guard <x1: int> <z1: int> <x2: int> <z2: int>", "/guard (off)<off: GuardOff>"], "permissions": ["guard.command.guard"]}}
    permissions = {"guard.command.guard": {"description": "Use /guard", "default": "op"}, "guard.bypass": {"description": "Walk into zones", "default": False}}

    def on_enable(self) -> None:
        self.file = self.data_folder / "zone.json"
        self.zone = json.loads(self.file.read_text()) if self.file.exists() else None
        self.warned: dict[str, int] = {}
        self.safe: dict[str, Location] = {}
        self.register_events(self)
        self.server.scheduler.run_task(self, self.sweep, delay=1, period=2)

    def inside(self, x: float, z: float) -> bool:
        z1 = self.zone
        return bool(z1) and z1[0] <= x <= z1[2] and z1[1] <= z <= z1[3]

    def depth(self, x: float, z: float) -> float:
        a = self.zone
        if a is None or not self.inside(x, z):
            return 0.0
        return min(x - a[0], a[2] - x, z - a[1], a[3] - z)

    def sweep(self) -> None:
        # the cancelled move pulls the client back; a step that still lands inside (a lagging client, a knockback)
        # is undone here: back to where they last stood outside
        for p in self.server.online_players:
            loc = p.location
            if not self.inside(loc.x, loc.z):
                self.safe[p.name] = loc
            elif p.name in self.safe and not p.has_permission("guard.bypass"):
                p.teleport(self.safe[p.name])

    @event_handler
    def on_move(self, e: PlayerMoveEvent) -> None:
        if not self.zone or e.player.has_permission("guard.bypass"):
            return
        t, f = e.to_location, e.from_location
        # no step that ends inside and is not on its way out (someone caught inside can still walk out)
        if self.inside(t.x, t.z) and self.depth(t.x, t.z) >= self.depth(f.x, f.z) - 1e-6:
            e.is_cancelled = True
            now = int(time.monotonic() * 20)
            if now - self.warned.get(e.player.name, -100) > 40:
                self.warned[e.player.name] = now
                e.player.send_tip("立入禁止 / No entry")

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if args and args[0] == "off":
            self.zone = None
            self.file.unlink(missing_ok=True)
            sender.send_message("zone cleared")
            return True
        try:
            x1, z1, x2, z2 = (int(a) for a in args[:4])
        except ValueError:
            return False
        self.zone = [min(x1, x2), min(z1, z2), max(x1, x2) + 1, max(z1, z2) + 1]
        self.data_folder.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(self.zone))
        sender.send_message(f"zone {self.zone[0]},{self.zone[1]} .. {self.zone[2]},{self.zone[3]}: no entry")
        return True
