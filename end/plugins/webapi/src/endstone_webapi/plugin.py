"""Web API: the server answers HTTP. GET /status (players, TPS), GET /players/<name>, POST /say (token).
BDS scripts cannot listen on a socket at all (@minecraft/server-net only sends requests out)."""
import json
import queue
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from endstone.command import Command, CommandSender
from endstone.plugin import Plugin


class Webapi(Plugin):
    api_version = "0.11"
    prefix = "WebAPI"
    commands = {"webapi": {"description": "Show the Web API address", "usages": ["/webapi"], "permissions": ["webapi.command.webapi"]}}
    permissions = {"webapi.command.webapi": {"description": "Use /webapi", "default": "op"}}

    def on_enable(self) -> None:
        self.snapshot: dict = {"players": [], "tps": 20.0}
        self.inbox: queue.Queue[str] = queue.Queue()
        self.data_folder.mkdir(parents=True, exist_ok=True)
        tok = self.data_folder / "token.txt"
        if not tok.exists():
            tok.write_text(secrets.token_hex(16))
        self.token = tok.read_text().strip()
        plugin = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:  # quiet: no line per request in the server log
                pass

            def reply(self, code: int, body: object) -> None:
                data = json.dumps(body, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:  # web threads only read the snapshot the server thread keeps fresh
                snap = plugin.snapshot
                if self.path == "/status":
                    return self.reply(200, snap)
                if self.path.startswith("/players/"):
                    name = self.path.split("/", 2)[2]
                    hit = next((p for p in snap["players"] if p["name"].lower() == name.lower()), None)
                    return self.reply(200 if hit else 404, hit or {"error": "offline"})
                self.reply(404, {"error": "GET /status | GET /players/<name> | POST /say"})

            def do_POST(self) -> None:
                if self.headers.get("Authorization") != f"Bearer {plugin.token}":
                    return self.reply(401, {"error": "Authorization: Bearer <token.txt>"})
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    text = str(json.loads(self.rfile.read(n) or b"{}").get("text", ""))[:200]
                except ValueError:
                    return self.reply(400, {"error": "JSON body {\"text\": ...}"})
                if self.path != "/say" or not text:
                    return self.reply(400, {"error": "POST /say {\"text\": ...}"})
                plugin.inbox.put(text)  # the world is only touched on the server thread (tick below)
                self.reply(202, {"queued": text})

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.http.server_address[1]
        (self.data_folder / "port.txt").write_text(str(self.port))
        threading.Thread(target=self.http.serve_forever, daemon=True).start()  # lab: ok (web threads touch only the snapshot/inbox)
        self.server.scheduler.run_task(self, self.tick, delay=0, period=10)
        self.logger.info(f"listening on http://127.0.0.1:{self.port}")

    def tick(self) -> None:
        self.snapshot = {
            "tps": round(self.server.current_tps, 1),
            "players": [{"name": p.name, "ping": p.ping, "health": p.health, "device": p.device_os,
                         "pos": [round(p.location.x, 1), round(p.location.y, 1), round(p.location.z, 1)]} for p in self.server.online_players],
        }
        while not self.inbox.empty():
            self.server.broadcast_message(f"[Web] {self.inbox.get()}")

    def on_disable(self) -> None:
        if getattr(self, "http", None):
            self.http.shutdown()
            self.http.server_close()

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        sender.send_message(f"Web API: http://127.0.0.1:{self.port}/status (POST /say needs the token in {self.data_folder / 'token.txt'})")
        return True
