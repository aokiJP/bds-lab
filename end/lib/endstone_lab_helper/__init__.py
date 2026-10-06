"""bds-lab helper plugin for Endstone (loaded only on the lab's own servers, never packed).

The lab talks to it with `scriptevent lab:py <base64 json>` (Endstone's ScriptMessageEvent); long payloads come in
`lab:pyp` parts first. Everything it prints goes through its logger, which the lab shows as plain lines.

  eval   `py <code>`              in a namespace with the server, the plugin under test and short helpers
  events `events on [names]`      every Endstone event, with its fields (EV <EventName> field=value ...)
  states `states on [keys]`       each player's properties, printed when they change (ST <player> key=value)
  trace  `trace file.py:line`     locals each time that line runs (sys.settrace on the server thread)
  cov    `cov on` / `cov`         which lines of the plugin's source ran
  prof   `prof start|stop [n]`    cProfile of the server thread, the plugin's functions first
  perf   `perf [ms]`              tick time / TPS over a window
"""
import atexit
import base64
import cProfile
import json
import os
import pstats
import sys
import threading
import time
import traceback
import types

from endstone.plugin import Plugin

from endstone.event import event_handler, EventPriority, ServerLoadEvent, ScriptMessageEvent

try:
    from endstone.event import Event
except Exception:  # pragma: no cover
    Event = object

try:
    import endstone as _es
    _API = ".".join(str(getattr(_es, "__version__", "0.11")).split(".")[:2])
except Exception:  # pragma: no cover
    _API = "0.11"

CONF = {}
try:
    with open(os.environ.get("LAB_PY_CONF", ""), encoding="utf-8") as _f:
        CONF = json.load(_f)
except Exception:
    CONF = {}

_norm = lambda p: os.path.normcase(os.path.abspath(p))
SRC = _norm(CONF.get("src") or ".")
UNIT = CONF.get("unit") or ""


def rel(path):
    """plugin file -> path as the AI wrote it (relative to the unit folder)"""
    try:
        r = os.path.relpath(path, UNIT) if UNIT else path
        return r.replace(os.sep, "/")
    except ValueError:
        return path


# ---------------------------------------------------------------- formatting (same shapes as the Script API tap)
def num(v):
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v == int(v) and abs(v) < 1e15 else ("%.3f" % v).rstrip("0").rstrip(".")
    return str(v)


def _name_of(v):
    for k in ("name",):
        try:
            x = getattr(v, k)
            if isinstance(x, str):
                return x
        except Exception:
            pass
    return None


def fmt(v, d=0):
    """short, stable text for a value: Player -> name, Actor -> type, Block -> type@x,y,z, ItemStack -> type*n"""
    if v is None:
        return "-"
    if isinstance(v, (bool, int, float)):
        return num(v)
    if isinstance(v, str):
        return v if d == 0 else (json.dumps(v, ensure_ascii=False) if len(v) < 60 else json.dumps(v[:57] + "...", ensure_ascii=False))
    if isinstance(v, (list, tuple, set, frozenset)):
        v = list(v)
        return "[" + ",".join(fmt(x, d + 1) for x in v[:12]) + (",+%d" % (len(v) - 12) if len(v) > 12 else "") + "]"
    if isinstance(v, dict):
        if d > 2:
            return "{..}"
        items = list(v.items())
        return "{" + " ".join("%s=%s" % (k, fmt(x, d + 1)) for k, x in items[:20]) + ("+%d" % (len(items) - 20) if len(items) > 20 else "") + "}"
    cls = type(v).__name__
    try:
        if cls in ("Player",) or (hasattr(v, "xuid") and _name_of(v)):
            return _name_of(v) or cls
        if hasattr(v, "type") and hasattr(v, "amount") and not hasattr(v, "location"):  # ItemStack
            return "%s*%s" % (str(v.type).replace("minecraft:", ""), v.amount)
        if hasattr(v, "type") and hasattr(v, "x") and hasattr(v, "y") and hasattr(v, "z") and hasattr(v, "data"):  # Block
            return "%s@%s,%s,%s" % (str(v.type).replace("minecraft:", ""), v.x, v.y, v.z)
        if hasattr(v, "x") and hasattr(v, "y") and hasattr(v, "z") and not callable(getattr(v, "x")):  # Vector / Location
            return "%s,%s,%s" % (num(v.x), num(v.y), num(v.z))
        if hasattr(v, "type") and hasattr(v, "location"):  # Actor
            return str(v.type).replace("minecraft:", "")
        if hasattr(v, "id") and cls in ("Dimension",):
            return str(v.id)
        if isinstance(v, types.ModuleType):
            return "<module %s>" % v.__name__
        if callable(v):
            return "[fn]"
        s = str(v)
        if s and not s.startswith("<"):
            return s.replace("minecraft:", "") if len(s) < 80 else s[:77] + "..."
    except Exception:
        pass
    if d > 1:
        return cls + "{..}"
    return cls + "{" + " ".join("%s=%s" % (k, fmt(x, d + 1)) for k, x in list(props(v).items())[:12]) + "}"


SKIP_PROPS = {"server", "plugin", "handlers", "event_name", "is_asynchronous", "scoreboard", "skin", "permissions"}


def props(o):
    """public, non-callable attributes (properties) of an object; errors skipped"""
    out = {}
    for k in dir(o):
        if k.startswith("_") or k in SKIP_PROPS:
            continue
        try:
            x = getattr(o, k)
        except Exception:
            continue
        if callable(x) and not isinstance(x, (str, bytes)):
            continue
        out[k] = x
    return out


# ---------------------------------------------------------------- tracing / coverage (sys.settrace, server thread)
def code_lines(path):
    """lines that hold code inside functions of a file (def/class/import lines excluded: they run at import time)"""
    try:
        with open(path, encoding="utf-8") as f:
            top = compile(f.read(), path, "exec")
    except Exception:
        return set()
    lines, stack = set(), [c for c in top.co_consts if isinstance(c, types.CodeType)]
    while stack:
        c = stack.pop()
        stack.extend(x for x in c.co_consts if isinstance(x, types.CodeType))
        for _, _, ln in c.co_lines():
            if ln is not None and ln != c.co_firstlineno:
                lines.add(ln)
    return lines


class Tracer:
    def __init__(self, say):
        self.say = say
        self.points = {}       # (file, line) -> trace spec
        self.cov = None        # set of (file, line) that ran
        self.err = False
        self.last_ex = None
        self.on = False
        self.threads = set()

    def watched(self, f):
        return f.startswith(SRC)

    def glob(self, frame, event, arg):
        if event == "call" and self.watched(_norm(frame.f_code.co_filename)):
            return self.local
        return None

    def local(self, frame, event, arg):
        try:
            f = _norm(frame.f_code.co_filename)
            if event == "line":
                key = (f, frame.f_lineno)
                if self.cov is not None:
                    self.cov.add(key)
                t = self.points.get(key)
                if t:
                    self.hit(t, frame)
            elif event == "exception" and self.err:
                exc = arg[1]
                sig = "%s@%s" % (id(exc), frame.f_lineno)
                if sig != self.last_ex:
                    self.last_ex = sig
                    loc = " ".join("%s=%s" % (k, fmt(v, 1)) for k, v in self.locals(frame).items())
                    self.say("X %s:%s %s: %s | %s" % (rel(f), frame.f_lineno, type(exc).__name__, exc, loc))
        except Exception:
            pass
        return self.local

    @staticmethod
    def locals(frame):
        out = {}
        for k, v in frame.f_locals.items():
            if k.startswith("__") or isinstance(v, (types.ModuleType, types.FunctionType, type)):
                continue
            out[k] = v
        return out

    def hit(self, t, frame):
        t["hits"] += 1
        if t["exprs"]:
            vals = {}
            for e in t["exprs"]:
                try:
                    vals[e] = fmt(eval(e, frame.f_globals, frame.f_locals), 1)
                except Exception as x:
                    vals[e] = "<%s>" % x
        else:
            vals = {k: fmt(v, 1) for k, v in self.locals(frame).items()}
        prev = t["prev"]
        changed = vals if prev is None else {k: v for k, v in vals.items() if prev.get(k) != v}
        t["prev"] = vals
        if changed:
            t["shown"] += 1
            self.say("T%d %s %s" % (t["hits"], t["src"], " ".join("%s=%s" % kv for kv in changed.items())))
        else:
            self.say("T%d %s (same)" % (t["hits"], t["src"]))
        if t["max"] and t["hits"] >= t["max"]:
            self.points.pop((t["file"], t["line"]), None)
            self.say("trace %s: %d hits, removed" % (t["src"], t["max"]))
            self.update()

    def monitor(self):
        """coverage through sys.monitoring (Python 3.12+): one switch for every thread, also the short-lived thread states
        Endstone makes for each callback (sys.settrace is lost with them: commands and events never counted as run).
        Each line is reported once, then switched off: almost free."""
        mon = getattr(sys, "monitoring", None)
        if mon is None or self.cov is None or getattr(self, "monitoring", False):
            return False
        tid = mon.COVERAGE_ID
        try:
            mon.use_tool_id(tid, "bds-lab coverage")
        except ValueError:
            pass

        def _line(code, line):
            f = _norm(code.co_filename)
            if f.startswith(SRC) and self.cov is not None:
                self.cov.add((f, line))
            return mon.DISABLE

        mon.register_callback(tid, mon.events.LINE, _line)
        mon.set_events(tid, mon.events.LINE)
        self.monitoring = True
        return True

    def update(self):
        if self.cov is not None:
            self.monitor()
        # sys.settrace is per thread: the loader thread (import) and the server thread (commands, events, scheduler) each
        # need it; it used to be set once, in the loader's thread only, and code run by commands never counted as run
        want = bool(self.points) or (self.cov is not None and not getattr(self, 'monitoring', False)) or self.err
        me = threading.get_ident()
        if want and (not self.on or me not in self.threads):
            sys.settrace(self.glob)
            threading.settrace(self.glob)
            self.threads.add(me)
            self.on = True
        elif not want and self.on:
            sys.settrace(None)
            threading.settrace(None)
            self.threads.clear()
            self.on = False

    def add(self, file, line, exprs, mx):
        f = _norm(file)
        lines = sorted(x for x in code_lines(f) if x >= line)
        if not lines:
            return "E trace: %s:%d has no code at or after this line (inside a function)" % (rel(f), line)
        ln = lines[0]
        src = "%s:%d" % (rel(f), ln)
        self.points[(f, ln)] = {"file": f, "line": ln, "src": src, "exprs": exprs, "max": mx, "hits": 0, "shown": 0, "prev": None}
        self.update()
        return "trace %s%s (up to %d hits)" % (src, " " + " ".join(exprs) if exprs else "", mx)

    def report(self):
        if self.cov is None:
            return "COV off (cov on, or run/test --cov)"
        total = miss_all = 0
        parts = []
        for root, _, fs in os.walk(SRC):
            for n in sorted(fs):
                if not n.endswith(".py"):
                    continue
                f = _norm(os.path.join(root, n))
                want = code_lines(f)
                if not want:
                    continue
                miss = sorted(x for x in want if (f, x) not in self.cov)
                total += len(want)
                miss_all += len(miss)
                rng = []
                for x in miss:
                    if rng and x == rng[-1][1] + 1:
                        rng[-1][1] = x
                    else:
                        rng.append([x, x])
                txt = ",".join(str(a) if a == b else "%d-%d" % (a, b) for a, b in rng)
                parts.append("%s %d/%d%s" % (rel(f), len(want) - len(miss), len(want), " never ran: " + txt if txt else ""))
        pct = round(100 * (total - miss_all) / total) if total else 100
        return "COV %d%% of code lines ran | %s" % (pct, " | ".join(parts) or "no plugin code")


TRACER = Tracer(lambda s: None)
# started with the server (test --cov / run -t file.py:line): trace the plugin from its import on
if CONF.get("cov"):
    TRACER.cov = set()
    # a `restart` in the test starts Python again: the lines that ran before it are kept in a file of this run and merged
    _cf, _run = CONF.get("covFile"), CONF.get("covRun")
    if _cf:
        try:
            with open(_cf, encoding="utf-8") as _f:
                _j = json.load(_f)
            if _j.get("run") == _run:
                TRACER.cov.update((a, b) for a, b in _j.get("lines", []))
        except Exception:
            pass

        def _dump_cov():
            try:
                with open(_cf, "w", encoding="utf-8") as _f:
                    json.dump({"run": _run, "lines": sorted(TRACER.cov)}, _f)
            except Exception:
                pass

        def _cov_loop():
            n = -1
            while True:
                time.sleep(1)
                if TRACER.cov is not None and len(TRACER.cov) != n:
                    n = len(TRACER.cov)
                    _dump_cov()

        atexit.register(_dump_cov)
        threading.Thread(target=_cov_loop, daemon=True).start()
    TRACER.update()
for _t in CONF.get("traces", []):
    try:
        TRACER.add(_t["file"], int(_t["line"]), _t.get("exprs", []), int(_t.get("max", 20)))
    except Exception:
        pass


# ---------------------------------------------------------------- the plugin
class LabHelper(Plugin):
    api_version = _API
    prefix = "lab_helper"
    description = "bds-lab helper (lab servers only)"

    def on_load(self):
        TRACER.say = self.say
        self.S = types.SimpleNamespace()
        self.buf = []
        self.tap_on = False
        self.tap_names = None
        self.tapped = False
        self.st_task = None
        self.st_prev = {}
        self.st_keys = None
        self.prof = None
        self.perf = None

    # every line of output: one logger line each (the lab shows them as they are)
    def say(self, text):
        for line in str(text).split("\n"):
            if line.startswith("E "):
                self.logger.error(line[2:])
            else:
                self.logger.info(line)

    def on_enable(self):
        self.register_events(self)
        if CONF.get("cov") or CONF.get("traces"):
            TRACER.update()   # this thread too (the server thread may differ from the loader's)
            try:   # and the thread the scheduler runs tasks on (commands and events run there too)
                self.server.scheduler.run_task(self, TRACER.update, delay=1)
            except Exception:
                pass

    @event_handler
    def on_server_load(self, event: ServerLoadEvent):
        name = CONF.get("plugin")
        if name:
            pl = None
            try:
                pl = self.server.plugin_manager.get_plugin(name)
            except Exception:
                pl = None
            if pl is None:
                self.logger.error("plugin %s did not load: the error above (none there: check the pyproject entry point and api_version)" % name)
            elif not getattr(pl, "is_enabled", True):
                self.logger.error("plugin %s loaded but is not enabled (on_enable raised?)" % name)
        self.logger.info("LAB_PY_READY")

    @event_handler
    def on_script_message(self, event: ScriptMessageEvent):
        mid = getattr(event, "message_id", None) or getattr(event, "id", "")
        msg = getattr(event, "message", "") or ""
        if mid == "lab:pyp":
            self.buf.append(msg)
            return
        if mid != "lab:py":
            return
        payload = "".join(self.buf) + msg
        self.buf = []
        try:
            req = json.loads(base64.b64decode(payload).decode("utf-8"))
        except Exception as x:
            self.logger.error("py: unreadable request (%s)" % x)
            self.logger.info("LAB_PY_DONE")
            return
        try:
            getattr(self, "op_" + req.get("op", "eval"))(req)
        except Exception:
            self.logger.error("py: " + traceback.format_exc().strip().split("\n")[-1])
        self.logger.info("LAB_PY_DONE")

    # ---- eval
    def namespace(self):
        server = self.server
        plugin = None
        try:
            plugin = server.plugin_manager.get_plugin(CONF.get("plugin") or "")
        except Exception:
            pass

        def p(name=None):
            ps = list(server.online_players)
            if name is None:
                return ps[-1] if ps else None
            return server.get_player(name)

        def cmd(line):
            return server.dispatch_command(server.command_sender, line)

        def dim(name="overworld"):
            lv = server.level
            for d in getattr(lv, "dimensions", []):
                if name in str(getattr(d, "id", getattr(d, "name", ""))).lower():
                    return d
            return lv.get_dimension(name)

        def inv(pl=None):
            pl = p(pl) if pl is None or isinstance(pl, str) else pl
            out = []
            for i, it in enumerate(pl.inventory.contents):
                if it is not None:
                    out.append("%d:%s" % (i, fmt(it)))
            return out

        def block(x, y, z, d="overworld"):
            return dim(d).get_block_at(int(x), int(y), int(z))

        import endstone
        return {"server": server, "plugin": plugin, "helper": self, "p": p, "cmd": cmd, "dim": dim, "inv": inv, "block": block,
                "S": self.S, "endstone": endstone, "fmt": fmt, "sys": sys}

    def op_eval(self, req):
        src = req.get("code", "")
        g = self.namespace()
        try:
            code = compile(src, "<py>", "eval")
        except SyntaxError:
            code = None
        if code is not None:
            r = eval(code, g)
        else:
            body = "def __lab__():\n" + "\n".join("    " + ln for ln in src.split("\n"))
            exec(compile(body, "<py>", "exec"), g)
            r = g["__lab__"]()
        if r is not None:
            self.say(fmt(r))

    # ---- event tap
    def op_events(self, req):
        self.tap_on = bool(req.get("on"))
        names = [n for n in req.get("names", []) if n]
        self.tap_names = set(names) if names else None
        if not self.tap_on:
            self.say("events off")
            return
        n = self.tap_all() if not self.tapped else len(self.event_classes())
        self.tapped = True
        self.say("events on: %d" % n)

    def event_classes(self):
        import endstone.event as ev
        out = []
        for k in dir(ev):
            c = getattr(ev, k)
            if isinstance(c, type) and k.endswith("Event") and k != "Event" and (Event is object or issubclass(c, Event)):
                out.append(c)
        return out

    def emit_event(self, event):
        if not self.tap_on:
            return
        name = type(event).__name__
        if self.tap_names and name not in self.tap_names and name.replace("Event", "") not in self.tap_names:
            return
        if name == "ScriptMessageEvent" and str(getattr(event, "message_id", "")).startswith("lab:"):
            return
        fields = []
        for k, v in props(event).items():
            if k == "is_cancelled" and not v:
                continue
            fields.append("%s=%s" % (k, fmt(v, 1)))
        self.say("EV %s%s" % (name, " " + " ".join(fields) if fields else ""))

    def tap_all(self):
        n = 0
        mon = getattr(EventPriority, "MONITOR", getattr(EventPriority, "HIGHEST", None))
        pm = self.server.plugin_manager
        for cls in self.event_classes():
            handler = (lambda e, self=self: self.emit_event(e))
            try:
                pm.register_event(cls.__name__, handler, mon, self, False)
                n += 1
                continue
            except Exception:
                pass
            try:   # older signature: a listener object with an annotated @event_handler method
                def h(_self, event):
                    self.emit_event(event)
                h.__annotations__ = {"event": cls}
                listener = type("LabTap" + cls.__name__, (), {"on_event": event_handler(priority=mon)(h)})()
                self.register_events(listener)
                n += 1
            except Exception:
                pass
        return n

    # ---- player states
    def op_states(self, req):
        if self.st_task is not None:
            try:
                self.st_task.cancel()
            except Exception:
                pass
            self.st_task = None
        self.st_prev = {}
        keys = [k for k in req.get("keys", []) if k]
        self.st_keys = keys or None
        if not req.get("on"):
            self.say("states off")
            return
        self.st_task = self.server.scheduler.run_task(self, self.poll_states, delay=0, period=1)
        self.say("states on" + (": " + " ".join(keys) if keys else ""))

    def read_state(self, pl):
        v = {}
        for k, x in props(pl).items():
            if k in ("location", "velocity", "inventory", "ender_chest", "address", "skin", "device_id", "xuid", "unique_id", "id", "runtime_id", "ping"):
                continue
            if isinstance(x, (bool, int, float, str)):
                v[k] = num(x) if not isinstance(x, str) else x
            elif type(x).__name__ in ("GameMode",) or hasattr(type(x), "__members__"):
                v[k] = str(x).split(".")[-1]
        try:
            loc = pl.location
            v["location"] = "%d,%d,%d" % (int(loc.x // 1), int(loc.y // 1), int(loc.z // 1))
            v["dimension"] = str(getattr(loc.dimension, "id", getattr(loc.dimension, "name", "?"))).replace("minecraft:", "")
            v["rotation.pitch"] = str(round(loc.pitch / 15) * 15)
            v["rotation.yaw"] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"][int(round(loc.yaw / 45)) % 8]
        except Exception:
            pass
        try:
            vel = pl.velocity
            v["velocity.y"] = "+" if vel.y > 0.05 else "-" if vel.y < -0.05 else "0"
            v["velocity.xz"] = "moving" if (vel.x ** 2 + vel.z ** 2) ** 0.5 > 0.05 else "0"
        except Exception:
            pass
        try:
            v["inventory"] = ",".join("%d:%s" % (i, fmt(it)) for i, it in enumerate(pl.inventory.contents) if it is not None) or "-"
            v["held"] = str(pl.inventory.held_item_slot)
        except Exception:
            pass
        if self.st_keys:
            v = {k: x for k, x in v.items() if any(k == w or k.startswith(w + ".") for w in self.st_keys)}
        return v

    def poll_states(self):
        here = set()
        for pl in list(self.server.online_players):
            name = pl.name
            here.add(name)
            try:
                v = self.read_state(pl)
            except Exception as x:
                self.say("ST %s (unreadable: %s)" % (name, x))
                continue
            pv = self.st_prev.get(name)
            self.st_prev[name] = v
            if pv is None:
                self.say("ST %s init %s" % (name, " ".join("%s=%s" % kv for kv in v.items())))
                continue
            for k in sorted(set(pv) | set(v)):
                if pv.get(k, "-") != v.get(k, "-"):
                    self.say("ST %s %s=%s" % (name, k, v.get(k, "-")))
        for n in list(self.st_prev):
            if n not in here:
                del self.st_prev[n]

    # ---- trace / coverage / profile / perf
    def op_trace(self, req):
        TRACER.say = self.say
        a = req.get("args", [])
        if a[:1] == ["err"]:
            TRACER.err = a[1:2] != ["off"]
            TRACER.update()
            self.say("trace err %s" % ("on (every raise in the plugin stops briefly)" if TRACER.err else "off"))
            return
        if a[:1] == ["off"]:
            TRACER.points.clear() if len(a) < 2 else [TRACER.points.pop(k) for k in list(TRACER.points) if TRACER.points[k]["src"].startswith(a[1].split(":")[0])]
            TRACER.update()
            self.say("trace off%s" % (" " + a[1] if len(a) > 1 else ""))
            return
        self.say(TRACER.add(req["file"], int(req["line"]), req.get("exprs", []), int(req.get("max", 20))))

    def op_cov(self, req):
        TRACER.say = self.say
        if req.get("on"):
            if TRACER.cov is None:
                TRACER.cov = set()
            TRACER.update()
            self.say("cov on")
        else:
            self.say(TRACER.report())

    def op_prof(self, req):
        if req.get("start"):
            self.prof = cProfile.Profile()
            self.prof.enable()
            self.say("prof started (server thread)")
            return
        if self.prof is None:
            self.say("prof: no profile (prof start first)")
            return
        self.prof.disable()
        st = pstats.Stats(self.prof)
        self.prof = None
        rows, total = [], 0.0
        for (file, line, func), (cc, nc, tt, ct, callers) in st.stats.items():
            total += tt
            if "endstone_lab_helper" in file:
                continue
            mine = _norm(file).startswith(SRC) if not file.startswith("~") else False
            rows.append((not mine, -tt, func, file, line, nc))
        rows.sort()
        out = ["PROF %.1fms in Python on the server thread" % (total * 1000)]
        for _, ntt, func, file, line, nc in rows[: int(req.get("n", 8))]:
            where = "%s:%d" % (rel(_norm(file)), line) if not file.startswith("~") else "(builtin)"
            out.append("  %.2fms %s %s x%d" % (-ntt * 1000, func, where, nc))
        self.say("\n".join(out))

    def op_perf(self, req):
        s = self.server
        samples = []

        def tick():
            try:
                samples.append(float(s.current_mspt))
            except Exception:
                pass

        task = s.scheduler.run_task(self, tick, delay=0, period=1)
        ms = int(req.get("ms", 3000))

        def done():
            try:
                task.cancel()
            except Exception:
                pass
            tps = getattr(s, "average_tps", getattr(s, "current_tps", "-"))
            mspt = ("avg %.2fms max %.2fms" % (sum(samples) / len(samples), max(samples))) if samples else "-"
            actors = "-"
            try:
                actors = len(s.level.actors)
            except Exception:
                pass
            self.say("PERF mspt %s | tps %s | players %d | actors %s" % (mspt, num(tps) if not isinstance(tps, str) else tps, len(list(s.online_players)), actors))
            self.logger.info("LAB_PY_DONE")

        s.scheduler.run_task(self, done, delay=max(1, ms // 50))
        self.logger.info("LAB_PY_WAIT")

    # ---- packets (Endstone only: PacketReceiveEvent / PacketSendEvent carry the raw payload and can be cancelled)
    # printed as LAB_PK <>|< player id hex; the lab decodes them on the host with the client's protocol tables
    def op_packets(self, req):
        pk = self.__dict__.setdefault("pk", {"on": False, "ids": None, "skip": set(), "drop": {}, "hooked": False})
        if req.get("drop") is not None:
            pk["drop"][int(req["drop"])] = [int(req.get("n", 1)), req.get("dir", "both")]
            self.say("packets drop %s x%d (%s)" % (req.get("label", req["drop"]), int(req.get("n", 1)), req.get("dir", "both")))
        else:
            pk["on"] = bool(req.get("on"))
            pk["ids"] = set(int(i) for i in req.get("ids") or []) or None
            pk["skip"] = set(int(i) for i in req.get("skip") or [])
            self.say("packets %s" % ("on" if pk["on"] else "off"))
        if not pk["hooked"]:
            pk["hooked"] = True
            import endstone.event as ev
            for name, arrow in (("PacketReceiveEvent", ">"), ("PacketSendEvent", "<")):
                cls = getattr(ev, name, None)
                if cls is None:
                    self.say("E packets: this Endstone has no %s" % name)
                    continue
                fn = (lambda e, a=arrow: self.on_packet(e, a))
                try:
                    self.server.plugin_manager.register_event(name, fn, EventPriority.HIGHEST, self, False)
                except Exception:
                    def h(_self, event, a=arrow):
                        self.on_packet(event, a)
                    h.__annotations__ = {"event": cls}
                    self.register_events(type("LabPk" + name, (), {"on_event": event_handler(priority=EventPriority.HIGHEST)(h)})())

    def on_packet(self, e, arrow):
        pk = self.pk
        pid = int(getattr(e, "packet_id", -1))
        d = pk["drop"].get(pid)
        if d and d[0] > 0 and d[1] in ("both", "in" if arrow == ">" else "out"):
            d[0] -= 1
            try:
                e.cancel()
            except Exception:
                e.is_cancelled = True
            self.say("PKDROP %s %s %d" % (arrow, getattr(getattr(e, "player", None), "name", "-"), pid))
            return
        if not pk["on"] or (pk["ids"] is not None and pid not in pk["ids"]) or (pk["ids"] is None and pid in pk["skip"]):
            return
        data = bytes(getattr(e, "payload", b"") or b"")
        self.say("LAB_PK %s %s %d %s" % (arrow, getattr(getattr(e, "player", None), "name", "-"), pid, data[:2048].hex()))

    # ---- fuzz: call a plugin command's handler with generated arguments (from its usages) and report what raises
    def op_fuzz(self, req):
        import random
        name = req.get("cmd", "").lstrip("/")
        cmd = None
        try:
            cmd = self.server.get_plugin_command(name)
        except Exception:
            cmd = None
        if cmd is None:
            self.say("E fuzz: no plugin command /%s" % name)
            return
        rnd = random.Random(int(req.get("seed", 1)))
        usages = list(getattr(cmd, "usages", None) or ["/" + name])
        VAL = {
            "int": ["0", "-1", "1", "2147483647", "-2147483648", "99999999999", "abc", ""],
            "float": ["0", "-0.5", "1e308", "nan", "inf", "x"],
            "bool": ["true", "false", "1", "yes"],
            "str": ["", " ", "a", "\u00e9\u6f22\u5b57", "x" * 300, "'\"", "%s", "\\n", "../"],
            "player": [], "target": ["@s", "@a", "@r", "@e", "nobody"],
            "pos": ["~ ~ ~", "0 -64 0", "1e9 0 0", "^ ^ ^1"],
        }
        players = [p.name for p in self.server.online_players] or ["nobody"]

        def gen(typ):
            t = typ.split("|") if "(" in typ or "|" in typ else None
            if t:
                return rnd.choice([x.strip("() ") for x in t] + ["notanoption"])
            k = typ.strip().lower()
            if k in ("int", "integer"): pool = VAL["int"]
            elif k in ("float", "double"): pool = VAL["float"]
            elif k in ("bool", "boolean"): pool = VAL["bool"]
            elif k in ("player", "target", "actor", "entity"): pool = VAL["target"] + players
            elif k in ("pos", "position", "block_pos", "vec3"): pool = VAL["pos"]
            else: pool = VAL["str"]
            return rnd.choice(pool)

        import re as _re
        errs, runs = {}, int(req.get("n", 60))
        console = getattr(self.server, "command_sender", None)
        senders = [console] + list(self.server.online_players)   # player-only branches get called too
        for _ in range(runs):
            sender = rnd.choice(senders)
            u = rnd.choice(usages)
            parts = _re.findall(r"[<\[]([^:>\]]+):\s*([^>\]]+)[>\]]|(\([^)]*\))", u)
            args = []
            for nm, typ, enum in parts:
                if enum:
                    args.append(gen(enum)); continue
                if u.find("[" + nm) >= 0 and rnd.random() < 0.3:
                    break   # optional: sometimes left out
                args.append(gen(typ))
            try:
                cmd.executor.on_command(sender, cmd, args)
            except Exception as x:
                tb = traceback.extract_tb(x.__traceback__)
                mine = [f for f in tb if _norm(f.filename).startswith(SRC)] or tb
                at = "%s:%d" % (rel(_norm(mine[-1].filename)), mine[-1].lineno) if mine else "?"
                key = (type(x).__name__, at)
                if key not in errs:
                    errs[key] = "/%s %s" % (name, " ".join(repr(a) if (" " in a or not a) else a for a in args))
                    self.say("E FUZZ %s: %s (%s) <- %s" % (type(x).__name__, str(x)[:160], at, errs[key]))
        self.say("FUZZ /%s %d runs, %d distinct failure(s)" % (name, runs, len(errs)))

    # ---- lag: stall the server thread (ms per tick, for n ticks): how does the plugin behave at low TPS?
    def op_lag(self, req):
        ms, n = int(req.get("ms", 100)), int(req.get("ticks", 40))
        left = [n]

        def stall():
            time.sleep(ms / 1000.0)
            left[0] -= 1
            if left[0] <= 0:
                t.cancel()
                self.say("lag done (%d ticks x %dms)" % (n, ms))
        t = self.server.scheduler.run_task(self, stall, delay=0, period=1)
        self.say("lag %dms x %d ticks" % (ms, n))

    # ---- watch: evaluate expressions every tick, print when a value changes (a live debugger watch window)
    def op_watch(self, req):
        w = self.__dict__.setdefault("watches", {"task": None, "exprs": {}})
        if req.get("off"):
            if w["task"] is not None:
                w["task"].cancel()
            w["task"], w["exprs"] = None, {}
            self.say("watch off")
            return
        expr = req.get("expr", "")
        try:
            w["exprs"][expr] = [compile(expr, "<watch>", "eval"), object()]
        except SyntaxError as x:
            self.say("E watch: %s" % x)
            return
        ns = self.namespace()

        def tick():
            for e, v in w["exprs"].items():
                try:
                    cur = fmt(eval(v[0], ns), 1)
                except Exception as x:
                    cur = "%s: %s" % (type(x).__name__, x)
                if cur != v[1]:
                    v[1] = cur
                    self.say("W %s = %s" % (e, cur))
        if w["task"] is None:
            w["task"] = self.server.scheduler.run_task(self, tick, delay=1, period=1)
        self.say("watch %s" % expr)
        tick()   # the value now, before the next command runs

    # ---- reload support: forget the plugin's modules so /reload imports the edited files
    def op_purge(self, req):
        pkg = CONF.get("package") or ""
        gone = [m for m in list(sys.modules) if pkg and (m == pkg or m.startswith(pkg + "."))]
        for m in gone:
            del sys.modules[m]
        self.say("purged %d module(s) of %s" % (len(gone), pkg))

