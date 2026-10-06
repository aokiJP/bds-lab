"""Every player's skin saved as a PNG when they join (plugins/skinpng/skins/<name>.png); /skin tells its size.
BDS scripts cannot read skins at all."""
import struct
import zlib

from endstone.command import Command, CommandSender
from endstone.event import PlayerJoinEvent, event_handler
from endstone.plugin import Plugin


def png(rgba: bytes, w: int, h: int) -> bytes:
    raw = b"".join(b"\x00" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


class Skinpng(Plugin):
    api_version = "0.11"
    prefix = "SkinPNG"
    commands = {"skin": {"description": "Where is a player's skin saved", "usages": ["/skin [name: str]"], "permissions": ["skinpng.command.skin"]}}
    permissions = {"skinpng.command.skin": {"description": "Use /skin", "default": True}}

    def on_enable(self) -> None:
        self.dir = self.data_folder / "skins"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.register_events(self)

    def save(self, player) -> str:
        img = player.skin.image  # numpy uint8 (height, width, 4) RGBA
        h, w = int(img.shape[0]), int(img.shape[1])
        f = self.dir / f"{player.name}.png"
        f.write_bytes(png(img.tobytes(), w, h))
        return f"{w}x{h}"

    @event_handler
    def on_join(self, e: PlayerJoinEvent) -> None:
        self.logger.info(f"skin of {e.player.name} saved ({self.save(e.player)})")

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        name = args[0] if args else sender.name
        p = self.server.get_player(name)
        if p is None:
            sender.send_error_message(f"{name} is not online")
            return True
        sender.send_message(f"{name}: {self.save(p)} -> skins/{name}.png ({p.skin.id})")
        return True
