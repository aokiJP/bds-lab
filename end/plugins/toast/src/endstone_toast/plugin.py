"""Toast notifications (the pop-in card at the top): a welcome toast, and /notify <text> for everyone.
BDS scripts can show titles and action bars, but not toasts."""
from endstone.command import Command, CommandSender
from endstone.event import PlayerJoinEvent, event_handler
from endstone.plugin import Plugin


class Toast(Plugin):
    api_version = "0.11"
    prefix = "Toast"
    commands = {"notify": {"description": "A toast for everyone", "usages": ["/notify <text: message>"], "permissions": ["toast.command.notify"]}}
    permissions = {"toast.command.notify": {"description": "Use /notify", "default": "op"}}

    def on_enable(self) -> None:
        self.register_events(self)

    @event_handler
    def on_join(self, e: PlayerJoinEvent) -> None:
        e.player.send_toast("ようこそ", f"{e.player.name}さん、{len(self.server.online_players)}人目のプレイヤーです")

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not args:
            return False
        for p in self.server.online_players:
            p.send_toast(f"§6{sender.name}", " ".join(args))
        return True
