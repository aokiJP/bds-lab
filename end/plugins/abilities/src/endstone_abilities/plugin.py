"""/fly and /walkspeed <0.05..1>: flight and walking speed per player, no effects needed.
BDS scripts can only approximate speed with potion effects and cannot grant flight in survival."""
from endstone import Player
from endstone.command import Command, CommandSender
from endstone.plugin import Plugin


class Abilities(Plugin):
    api_version = "0.11"
    prefix = "Abilities"
    commands = {
        "fly": {"description": "Toggle flight", "usages": ["/fly"], "permissions": ["abilities.command.fly"]},
        "walkspeed": {"description": "Set walking speed (vanilla 0.1)", "usages": ["/walkspeed <speed: float>"], "permissions": ["abilities.command.walkspeed"]},
    }
    permissions = {
        "abilities.command.fly": {"description": "Use /fly", "default": "op"},
        "abilities.command.walkspeed": {"description": "Use /walkspeed", "default": "op"},
    }

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        if command.name == "fly":
            sender.allow_flight = not sender.allow_flight
            if not sender.allow_flight and sender.is_flying:
                sender.is_flying = False
            sender.send_message(f"flight {'on' if sender.allow_flight else 'off'}")
            return True
        try:
            v = float(args[0])
        except (IndexError, ValueError):
            return False
        if not 0.0 < v <= 1.0:
            sender.send_error_message("speed: 0.01 .. 1 (vanilla 0.1)")
            return True
        sender.walk_speed = v
        sender.send_message(f"walk speed {v}")
        return True
