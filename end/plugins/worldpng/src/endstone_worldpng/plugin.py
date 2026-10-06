"""/worldpng [radius]: a top-down picture of the land around the player (block colors, shaded by height like a map), saved
as a PNG file in the plugin folder (for a website, Discord, backups) and handed to the player as a map item showing the
same picture. BDS scripts can neither write files nor draw on maps."""
import struct
import zlib

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.inventory import ItemStack, MapMeta
from endstone.map import MapCanvas, MapRenderer, MapView
from endstone.plugin import Plugin

COLORS = {
    "grass_block": (98, 160, 60), "dirt": (134, 96, 67), "stone": (125, 125, 125), "cobblestone": (110, 110, 110),
    "water": (50, 90, 220), "sand": (219, 207, 163), "gravel": (136, 126, 126), "snow": (248, 248, 248),
    "oak_planks": (162, 131, 78), "oak_log": (109, 85, 50), "oak_leaves": (60, 120, 40), "glass": (200, 230, 240),
    "red_wool": (160, 39, 34), "blue_wool": (53, 57, 157), "yellow_wool": (248, 197, 39), "white_wool": (233, 236, 236),
    "black_wool": (21, 21, 26), "lava": (220, 90, 10), "bedrock": (60, 60, 60), "gold_block": (246, 208, 61),
    "diamond_block": (98, 219, 214), "torch": (255, 200, 80), "air": (0, 0, 0),
}


def color(block_type: str) -> tuple[int, int, int]:
    name = block_type.removeprefix("minecraft:")
    if name in COLORS:
        return COLORS[name]
    h = zlib.crc32(name.encode())   # anything else: a stable color of its own
    return (64 + h % 160, 64 + (h >> 8) % 160, 64 + (h >> 16) % 160)


def png(rows: list[list[tuple[int, int, int]]]) -> bytes:
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


class Picture(MapRenderer):
    def __init__(self, rows: list[list[tuple[int, int, int]]]) -> None:
        super().__init__()
        self.rows = rows

    def render(self, view: MapView, canvas: MapCanvas, player: Player) -> None:
        n = len(self.rows)
        for y in range(128):
            for x in range(128):
                canvas.set_pixel_color(x, y, self.rows[y * n // 128][x * n // 128])


class Worldpng(Plugin):
    api_version = "0.11"
    prefix = "WorldPng"
    commands = {"worldpng": {"description": "A picture of the land around you (PNG file + map)", "usages": ["/worldpng [radius: int]"], "permissions": ["worldpng.command"]}}
    permissions = {"worldpng.command": {"description": "Use /worldpng", "default": True}}

    def picture(self, p: Player, r: int) -> list[list[tuple[int, int, int]]]:
        dim, cx, cz = p.dimension, int(p.location.block_x), int(p.location.block_z)
        rows = []
        for z in range(cz - r, cz + r):
            row = []
            for x in range(cx - r, cx + r):
                try:
                    b = dim.get_highest_block_at(x, z)
                    y, c = b.y, color(b.type)
                    n = dim.get_highest_block_y_at(x, z - 1)
                except Exception:   # not loaded
                    row.append((0, 0, 0))
                    continue
                k = 1.15 if y > n else 0.8 if y < n else 1.0   # lit from the north, like a vanilla map
                row.append(tuple(min(255, int(v * k)) for v in c))
            rows.append(row)
        return rows

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        try:
            r = int(args[0]) if args else 16
        except ValueError:
            return False
        if not 4 <= r <= 64:
            sender.send_error_message("radius: 4 to 64")
            return True
        rows = self.picture(sender, r)
        self.data_folder.mkdir(parents=True, exist_ok=True)
        f = self.data_folder / f"{sender.name}.png"
        f.write_bytes(png(rows))
        view = self.server.create_map(sender.dimension)
        view.add_renderer(Picture(rows))
        view.locked = True
        item = ItemStack("minecraft:filled_map")
        meta = item.item_meta
        assert isinstance(meta, MapMeta)
        meta.map_view = view
        meta.display_name = f"Land around {sender.location.block_x} {sender.location.block_z}"
        item.set_item_meta(meta)
        sender.inventory.add_item(item)
        kinds = len({px for row in rows for px in row})
        sender.send_message(f"worldpng: {2 * r}x{2 * r} px, {kinds} colors -> plugins/worldpng/{f.name}")
        return True
