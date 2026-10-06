#!/usr/bin/env python3
"""Fake `endstone` launcher for the lab's offline tests: the same plugin discovery (importlib.metadata entry points, group
"endstone"), Endstone's log format, ScriptMessageEvent for console `scriptevent`, /reload, and a scheduler ticking at 20 TPS.
Console extras: `fakejoin <name>` (PlayerJoinEvent), `fakechat <name> <msg>`, `fakepacket in|out <name> <id> <hex>` (PacketReceive/SendEvent)."""
import os, sys, time, inspect, threading, queue
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import endstone
from endstone import Logger, Scheduler, FakePlayer
from endstone.event import ServerLoadEvent, ScriptMessageEvent, PlayerJoinEvent, PlayerChatEvent, PacketReceiveEvent, PacketSendEvent

args = sys.argv[1:]
folder = args[args.index("--server-folder") + 1] if "--server-folder" in args else "."
os.chdir(folder)
log = Logger("Server")

class PM:
    def __init__(self): self.plugins = {}; self.handlers = {}
    def get_plugin(self, n): return self.plugins.get(n)
    def register_event(self, name, fn, prio, plugin, ignore): self.handlers.setdefault(name, []).append(fn)
    def register_events(self, listener, plugin):
        for k in dir(listener):
            f = getattr(listener, k, None)
            if callable(f) and getattr(f, "_es_handler", False):
                ann = list(inspect.signature(f).parameters.values())[0].annotation
                self.handlers.setdefault(ann.__name__, []).append(f)
    def call(self, ev):
        for h in list(self.handlers.get(type(ev).__name__, [])):
            try: h(ev)
            except Exception as e:
                import traceback; Logger("EventBus").error("error in handler: " + "".join(traceback.format_exception(e)).strip())

class Server:
    def __init__(self):
        self.plugin_manager = PM(); self.scheduler = Scheduler(); self.online_players = []; self.command_sender = type("ConsoleCommandSender", (), {"name": "Server", "send_message": lambda _s, m: log.info("[Server] (to console) %s" % m)})()
        self.current_mspt = 1.5; self.average_tps = 20.0
    def get_player(self, n): return next((p for p in self.online_players if p.name == n), None)
    def dispatch_command(self, sender, line): handle(line); return True
    def get_plugin_command(self, name):   # like Endstone: a Command with usages, run by the plugin that declared it
        for pl in self.plugin_manager.plugins.values():
            c = (getattr(pl, "commands", None) or {}).get(name)
            if c is not None:
                return type("Command", (), {"name": name, "usages": c.get("usages", ["/" + name]), "executor": pl})()
        return None

S = Server(); endstone._SERVER = S

def load_plugins():
    from importlib.metadata import entry_points
    S.plugin_manager.plugins.clear(); S.plugin_manager.handlers.clear()
    for ep in entry_points(group="endstone"):
        try:
            cls = ep.load()
            if not getattr(cls, "api_version", None): raise RuntimeError("plugin %s has no api_version" % ep.name)
            pl = cls(); pl.server = S; pl.name = ep.name; pl.logger = Logger(getattr(cls, "prefix", None) or ep.name)
            log.info("Loading %s v0.0" % ep.name); pl.on_load(); S.plugin_manager.plugins[ep.name] = pl
        except Exception as e:
            Logger("PluginManager").error("Could not load plugin %s: %r" % (ep.name, e))
    for pl in S.plugin_manager.plugins.values():
        try: pl.on_enable(); pl.is_enabled = True
        except Exception as e: Logger("PluginManager").error("Error occurred when enabling %s: %r" % (pl.name, e))

def handle(line):
    w = line.split(" ", 2)
    if w[0] == "stop": log.info("Stopping server..."); os._exit(0)
    elif w[0] == "scriptevent": S.plugin_manager.call(ScriptMessageEvent(w[1], w[2] if len(w) > 2 else "")); log.info("Script event %s has been sent" % w[1])
    elif w[0] == "reload":
        for pl in S.plugin_manager.plugins.values(): pl.on_disable()
        for m in [m for m in sys.modules if m.startswith("endstone_lab_helper")]: del sys.modules[m]
        load_plugins(); S.plugin_manager.call(ServerLoadEvent("RELOAD")); Logger("Scripting").info("LAB_JS_READY")
    elif w[0] == "fakejoin":
        p = FakePlayer(w[1]); S.online_players.append(p); S.plugin_manager.call(PlayerJoinEvent(p))
    elif w[0] == "fakechat":
        S.plugin_manager.call(PlayerChatEvent(S.get_player(w[1]), w[2]))
    elif w[0] == "fakepacket":
        d, name, pid, hx = line.split(" ")[1:5]
        ev = (PacketReceiveEvent if d == "in" else PacketSendEvent)(S.get_player(name), int(pid), bytes.fromhex(hx))
        S.plugin_manager.call(ev)
        log.info("[Server] packet %s %s" % (pid, "dropped" if ev.is_cancelled else "delivered"))
    elif w[0] == "say": log.info("[Server] " + line[4:])
    else: log.info("Unknown command: %s" % w[0])

log.info("Endstone v%s (fake)" % endstone.__version__)
load_plugins()
log.info("Server started.")
S.plugin_manager.call(ServerLoadEvent("STARTUP"))
time.sleep(0.3)
Logger("Scripting").info("LAB_READY")
q = queue.Queue()
threading.Thread(target=lambda: [q.put(l.rstrip("\n")) for l in sys.stdin], daemon=True).start()
while True:
    t0 = time.time()
    while not q.empty(): handle(q.get())
    S.scheduler.step()
    time.sleep(max(0, 0.05 - (time.time() - t0)))
