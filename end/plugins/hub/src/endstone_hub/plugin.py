"""/hub [name]: sends the player to another server (TransferPacket), a lobby network in one command. Servers are
listed in plugins/hub/servers.json. BDS scripts cannot move a player to another server."""
import json

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.plugin import Plugin

DEFAULT = {"lobby": ["127.0.0.1", 19132], "survival": ["127.0.0.1", 19134]}


class Hub(Plugin):
    api_version = "0.11"
    prefix = "Hub"
    commands = {"hub": {"description": "Go to another server", "usages": ["/hub [server: str]"], "permissions": ["hub.command.hub"]}}
    permissions = {"hub.command.hub": {"description": "Use /hub", "default": True}}

    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        f = self.data_folder / "servers.json"
        if not f.exists():
            f.write_text(json.dumps(DEFAULT, indent=2))
        self.servers: dict[str, list] = json.loads(f.read_text())

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        name = args[0] if args else next(iter(self.servers))
        if name not in self.servers:
            sender.send_message("servers: " + ", ".join(self.servers))
            return True
        host, port = self.servers[name]
        sender.send_message(f"-> {name} ({host}:{port})")
        sender.transfer(host, int(port))
        return True
