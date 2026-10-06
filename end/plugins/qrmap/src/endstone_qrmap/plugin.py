"""/qr <text>: a map item showing a scannable QR code of the text (the pure-Python `qrcode` library from PyPI).
Any Python library works the same way (`node lab.mjs lib add <pkg>`); BDS scripts can use no native or PyPI code."""
import qrcode
from qrcode.constants import ERROR_CORRECT_M

from endstone import Player
from endstone.command import Command, CommandSender
from endstone.inventory import ItemStack, MapMeta
from endstone.map import MapCanvas, MapRenderer, MapView
from endstone.plugin import Plugin


def matrix(text: str) -> list[list[bool]]:
    q = qrcode.QRCode(border=2, error_correction=ERROR_CORRECT_M)
    q.add_data(text)
    q.make(fit=True)
    return q.get_matrix()


class Qr(MapRenderer):
    def __init__(self, cells: list[list[bool]]) -> None:
        super().__init__()
        self.cells = cells

    def render(self, view: MapView, canvas: MapCanvas, player: Player) -> None:
        n = len(self.cells)
        s = max(1, 128 // n)
        off = (128 - n * s) // 2
        for y in range(128):
            for x in range(128):
                cx, cy = (x - off) // s, (y - off) // s
                dark = 0 <= cx < n and 0 <= cy < n and self.cells[cy][cx]
                canvas.set_pixel_color(x, y, (0, 0, 0) if dark else (255, 255, 255))


class Qrmap(Plugin):
    api_version = "0.11"
    prefix = "QRMap"
    commands = {"qr": {"description": "A map with a QR code", "usages": ["/qr <text: message>"], "permissions": ["qrmap.command.qr"]}}
    permissions = {"qrmap.command.qr": {"description": "Use /qr", "default": True}}

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        text = " ".join(args)[:300]
        if not text:
            return False
        cells = matrix(text)
        view = self.server.create_map(sender.dimension)
        view.add_renderer(Qr(cells))
        view.locked = True
        item = ItemStack("minecraft:filled_map")
        meta = item.item_meta
        assert isinstance(meta, MapMeta)
        meta.map_view = view
        meta.display_name = f"QR: {text[:30]}"
        item.set_item_meta(meta)
        sender.inventory.add_item(item)
        sender.send_message(f"QR {len(cells)}x{len(cells)} for {text[:40]}")
        return True
