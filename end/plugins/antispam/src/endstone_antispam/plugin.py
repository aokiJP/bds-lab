"""Chat flood control at the packet level: more than 3 chat packets in 3 seconds are dropped before the game sees them
(PacketReceiveEvent). BDS scripts can cancel a chat message but never see or drop raw packets."""
from endstone.event import PacketReceiveEvent, event_handler
from endstone.plugin import Plugin

TEXT = 9  # the Text packet: chat from a client
LIMIT, WINDOW = 3, 60  # messages per window (ticks)


class Antispam(Plugin):
    api_version = "0.11"
    prefix = "Antispam"

    def on_enable(self) -> None:
        self.seen: dict[str, list[int]] = {}
        self.tick = 0
        self.server.scheduler.run_task(self, self.count, delay=1, period=1)
        self.register_events(self)

    def count(self) -> None:
        self.tick += 1

    @event_handler
    def on_packet(self, e: PacketReceiveEvent) -> None:
        if e.packet_id != TEXT or e.player is None:
            return
        name = e.player.name
        recent = [t for t in self.seen.get(name, []) if self.tick - t < WINDOW]
        if len(recent) >= LIMIT:
            e.is_cancelled = True
            e.player.send_tip("§c送信が速すぎます / slow down")
        else:
            recent.append(self.tick)
        self.seen[name] = recent
