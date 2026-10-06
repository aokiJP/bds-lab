"""/pixelmap [heart|creeper|face|<name>]: a map item with pixel art drawn by the plugin (MapRenderer); `face` is the
player's own skin face, 16x. BDS scripts cannot draw on maps."""
from endstone import Player
from endstone.command import Command, CommandSender
from endstone.inventory import ItemStack, MapMeta
from endstone.map import MapCanvas, MapRenderer, MapView
from endstone.plugin import Plugin

ART = {
    "heart": [".RR.RR..", "RWRRRRR.", "RRRRRRR.", "RRRRRRR.", ".RRRRR..", "..RRR...", "...R....", "........"],
    "creeper": ["GGGGGGGG", "GGGGGGGG", "GKKGGKKG", "GKKGGKKG", "GGGKKGGG", "GGKKKKGG", "GGKKKKGG", "GGKGGKGG"],
}
COLORS = {"R": (220, 30, 50), "W": (255, 255, 255), "G": (90, 190, 70), "K": (20, 30, 20), ".": (240, 230, 200)}


class Art(MapRenderer):
    def __init__(self, pixels: list[list[tuple]]) -> None:
        super().__init__()
        self.pixels = pixels

    def render(self, view: MapView, canvas: MapCanvas, player: Player) -> None:
        n = len(self.pixels)
        s = 128 // n
        for y in range(128):
            for x in range(128):
                canvas.set_pixel_color(x, y, self.pixels[min(y // s, n - 1)][min(x // s, n - 1)])


class Pixelmap(Plugin):
    api_version = "0.11"
    prefix = "PixelMap"
    commands = {"pixelmap": {"description": "A map with pixel art", "usages": ["/pixelmap [art: str]"], "permissions": ["pixelmap.command"]}}
    permissions = {"pixelmap.command": {"description": "Use /pixelmap", "default": True}}

    def face(self, p: Player) -> list[list[tuple]]:
        img = p.skin.image  # (h, w, 4): the face is 8x8 at (8, 8) on a 64-wide skin
        k = img.shape[1] // 64 or 1
        return [[tuple(int(c) for c in img[(8 + y) * k][(8 + x) * k][:3]) for x in range(8)] for y in range(8)]

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("players only")
            return True
        what = args[0] if args else "heart"
        if what == "face" or self.server.get_player(what):
            pixels = self.face(sender if what == "face" else self.server.get_player(what))
        elif what in ART:
            pixels = [[COLORS[c] for c in row] for row in ART[what]]
        else:
            sender.send_error_message(f"art: heart, creeper, face or a player name (not {what})")
            return True
        view = self.server.create_map(sender.dimension)
        view.add_renderer(Art(pixels))
        view.locked = True
        item = ItemStack("minecraft:filled_map")
        meta = item.item_meta
        assert isinstance(meta, MapMeta)
        meta.map_view = view
        meta.display_name = f"Pixel map: {what}"
        item.set_item_meta(meta)
        sender.inventory.add_item(item)
        sender.send_message(f"pixel map {what} (#{view.id})")
        return True
