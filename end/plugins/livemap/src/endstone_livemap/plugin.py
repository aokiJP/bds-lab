"""A live web map: open http://<server>:<port>/ in a browser to see the land from above and every player moving on it
(refreshes by itself). GET /map.png is the picture, GET /players.json the positions. The land is redrawn one row per tick,
so the server never stalls. BDS scripts cannot serve web pages, draw pictures or write files."""
import json
import struct
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from endstone.command import Command, CommandSender
from endstone.plugin import Plugin

SIZE, SCALE = 64, 4   # blocks -32..31 around the origin, 4 px per block
COLORS = {"grass_block": (98, 160, 60), "dirt": (134, 96, 67), "stone": (125, 125, 125), "water": (50, 90, 220), "sand": (219, 207, 163),
          "oak_planks": (162, 131, 78), "oak_log": (109, 85, 50), "oak_leaves": (60, 120, 40), "red_wool": (160, 39, 34),
          "blue_wool": (53, 57, 157), "white_wool": (233, 236, 236), "lava": (220, 90, 10), "snow": (248, 248, 248), "bedrock": (60, 60, 60)}
MARKS = [(255, 255, 0), (255, 0, 255), (0, 255, 255), (255, 128, 0), (255, 255, 255)]
PAGE = """<!doctype html><meta charset=utf-8><title>Live map</title><body style="background:#111;color:#eee;font:14px sans-serif">
<img id=m src=/map.png width=512 height=512 style="image-rendering:pixelated"><ul id=p></ul><script>
setInterval(async()=>{m.src='/map.png?'+Date.now();const r=await(await fetch('/players.json')).json();
p.innerHTML=r.map(x=>`<li>${x.name} ${x.x} ${x.y} ${x.z}</li>`).join('')},2000)</script>"""


def color(t: str) -> tuple[int, int, int]:
    n = t.removeprefix("minecraft:")
    if n in COLORS:
        return COLORS[n]
    h = zlib.crc32(n.encode())
    return (64 + h % 160, 64 + (h >> 8) % 160, 64 + (h >> 16) % 160)


def png(w: int, h: int, px: bytearray) -> bytes:
    raw = b"".join(b"\0" + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


class Livemap(Plugin):
    api_version = "0.11"
    prefix = "LiveMap"
    commands = {"livemap": {"description": "The address of the live web map", "usages": ["/livemap"], "permissions": ["livemap.command"]}}
    permissions = {"livemap.command": {"description": "Use /livemap", "default": True}}

    def on_enable(self) -> None:
        self.land = [[(0, 0, 0)] * SIZE for _ in range(SIZE)]   # written by the server thread, read by web threads
        self.players: list[dict] = []
        self.row = 0
        plugin = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:
                pass

            def send(self, kind: str, body: bytes) -> None:
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                path = self.path.split("?")[0]
                if path == "/":
                    return self.send("text/html; charset=utf-8", PAGE.encode())
                if path == "/players.json":
                    return self.send("application/json", json.dumps(plugin.players).encode())
                if path == "/map.png":
                    return self.send("image/png", plugin.picture())
                self.send_error(404)

        self.http = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self.port = self.http.server_address[1]
        threading.Thread(target=self.http.serve_forever, daemon=True).start()  # lab: ok (web threads read the snapshots only)
        self.server.scheduler.run_task(self, self.tick, delay=0, period=1)
        self.logger.info(f"live map on http://127.0.0.1:{self.port}/")

    def tick(self) -> None:
        dim = self.server.level.dimensions[0]
        z, row = self.row - SIZE // 2, []
        for x in range(-SIZE // 2, SIZE // 2):
            try:
                row.append(color(dim.get_highest_block_at(x, z).type))
            except Exception:   # not loaded
                row.append((0, 0, 0))
        self.land[self.row] = row
        self.row = (self.row + 1) % SIZE
        self.players = [{"name": p.name, "x": p.location.block_x, "y": p.location.block_y, "z": p.location.block_z} for p in self.server.online_players]

    def picture(self) -> bytes:
        w = SIZE * SCALE
        px = bytearray(w * w * 3)
        for bz, row in enumerate(self.land):
            for bx, c in enumerate(row):
                for dy in range(SCALE):
                    i = ((bz * SCALE + dy) * w + bx * SCALE) * 3
                    px[i:i + SCALE * 3] = bytes(c) * SCALE
        for k, p in enumerate(self.players):   # a 3x3 dot per player, then its color
            cx, cz = (p["x"] + SIZE // 2) * SCALE + SCALE // 2, (p["z"] + SIZE // 2) * SCALE + SCALE // 2
            for dz in range(-2, 3):
                for dx in range(-2, 3):
                    if 0 <= cx + dx < w and 0 <= cz + dz < w:
                        i = ((cz + dz) * w + cx + dx) * 3
                        px[i:i + 3] = bytes(MARKS[k % len(MARKS)])
        return png(w, w, px)

    def on_disable(self) -> None:
        if getattr(self, "http", None):
            self.http.shutdown()
            self.http.server_close()

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        sender.send_message(f"live map: http://<this server>:{self.port}/")
        return True
