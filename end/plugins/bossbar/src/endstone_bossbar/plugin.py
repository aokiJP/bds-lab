"""Boss bars from a plugin: /countdown <seconds> [title] shows each player their own draining bar, then a title.
BDS scripts have no boss bar API (only entities with a boss component can show one)."""
from endstone import Player
from endstone.boss import BarColor, BarStyle
from endstone.command import Command, CommandSender
from endstone.plugin import Plugin


class Bossbar(Plugin):
    api_version = "0.11"
    prefix = "Bossbar"
    commands = {"countdown": {"description": "Show a countdown boss bar", "usages": ["/countdown <seconds: int> [title: message]"], "permissions": ["bossbar.command.countdown"]}}
    permissions = {"bossbar.command.countdown": {"description": "Use /countdown", "default": True}}

    def on_enable(self) -> None:
        self.running: dict[str, tuple] = {}

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        try:
            secs = max(1, min(3600, int(args[0])))
        except (IndexError, ValueError):
            return False
        title = " ".join(args[1:]) or "Countdown"
        old = self.running.pop(sender.name, None)
        if old:
            self.server.scheduler.cancel_task(old[1])
            old[0].remove_all()
        bar = self.server.create_boss_bar(f"{title} {secs}", BarColor.GREEN, BarStyle.SEGMENTED_10)
        bar.add_player(sender)
        left = [secs * 20]

        def tick() -> None:
            left[0] -= 20
            if not sender.is_valid or left[0] <= 0:
                bar.remove_all()
                task = self.running.pop(sender.name, (None, None))[1]
                if task is not None:
                    self.server.scheduler.cancel_task(task)
                if sender.is_valid:
                    sender.send_title("Time!", title)
                return
            bar.progress = left[0] / (secs * 20)
            bar.color = BarColor.RED if bar.progress < 0.3 else BarColor.YELLOW if bar.progress < 0.6 else BarColor.GREEN
            bar.title = f"{title} {left[0] // 20}"

        task = self.server.scheduler.run_task(self, tick, delay=20, period=20)
        self.running[sender.name] = (bar, task.task_id)
        return True
