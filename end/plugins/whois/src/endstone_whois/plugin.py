"""/whois <player>: address, ping, device, OS, language, client version. BDS scripts see none of these."""
from endstone.command import Command, CommandSender
from endstone.plugin import Plugin


class Whois(Plugin):
    api_version = "0.11"
    prefix = "Whois"
    commands = {"whois": {"description": "Who is that player", "usages": ["/whois <name: str>"], "permissions": ["whois.command.whois"]}}
    permissions = {"whois.command.whois": {"description": "Use /whois", "default": "op"}}

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not args:
            return False
        p = self.server.get_player(args[0])
        if p is None:
            sender.send_error_message(f"{args[0]} is not online")
            return True
        a = p.address
        sender.send_message(f"{p.name}: ip {a.hostname}:{a.port} ping {p.ping}ms | {p.device_os} ({p.device_id[:8]}) | {p.locale} | client {p.game_version} | xuid {p.xuid or '-'} | op {p.is_op}")
        return True
