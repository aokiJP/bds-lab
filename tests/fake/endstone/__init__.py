"""Stub of the `endstone` package for the lab's offline tests (tests/offline.mjs). Only what the lab and its scaffolds touch."""
import sys, time
__version__ = "0.11.11"

def _ts():
    t = time.time()
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) + ".%03d" % int((t % 1) * 1000)

class Logger:
    def __init__(self, name): self.name = name
    def _p(self, lv, m):
        for line in str(m).split("\n"):
            sys.stdout.write("[%s %s] [%s] %s\n" % (_ts(), lv, self.name, line)); sys.stdout.flush()
    def info(self, m): self._p("INFO", m)
    def warning(self, m): self._p("WARNING", m)
    def error(self, m): self._p("ERROR", m)
    def debug(self, m): pass

class Vector:
    def __init__(self, x, y, z): self.x, self.y, self.z = x, y, z

class Location(Vector):
    def __init__(self, x, y, z, dim=None): super().__init__(x, y, z); self.pitch = 0.0; self.yaw = 0.0; self.dimension = dim

class Dimension:
    def __init__(self, i): self.id = i; self.name = i

class FakePlayer:
    def __init__(self, name):
        self.name = name; self.xuid = "0"; self.health = 20; self.is_sneaking = False
        self.location = Location(0.5, 64, 0.5, Dimension("overworld")); self.velocity = Vector(0, 0, 0); self.messages = []
    def send_message(self, m):
        self.messages.append(m); sys.stdout.write("[%s INFO] [Server] (to %s) %s\n" % (_ts(), self.name, m)); sys.stdout.flush()

class Task:
    def __init__(self, fn, delay, period): self.fn, self.at, self.period, self.cancelled = fn, delay, period, False
    def cancel(self): self.cancelled = True

class Scheduler:
    def __init__(self): self.tasks = []; self.tick = 0
    def run_task(self, plugin, fn, delay=0, period=0):
        t = Task(fn, self.tick + delay, period); self.tasks.append(t); return t
    def step(self):
        self.tick += 1
        for t in list(self.tasks):
            if t.cancelled: self.tasks.remove(t); continue
            if self.tick >= t.at:
                try: t.fn()
                except Exception as e: Logger("Scheduler").error("task error: %r" % e)
                if t.period: t.at = self.tick + t.period
                else: self.tasks.remove(t)
