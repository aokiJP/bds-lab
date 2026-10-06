class EventPriority:
    LOWEST, LOW, NORMAL, HIGH, HIGHEST, MONITOR = range(6)
def event_handler(func=None, *, priority=EventPriority.NORMAL, ignore_cancelled=False):
    def mark(f):
        f._es_handler = True; return f
    return mark(func) if func is not None else mark
class Event:
    is_cancelled = False
class ServerLoadEvent(Event):
    def __init__(self, t): self.type = t
class ScriptMessageEvent(Event):
    def __init__(self, mid, msg): self.message_id = mid; self.message = msg; self.sender = "Server"
class PlayerEvent(Event): pass
class PlayerJoinEvent(PlayerEvent):
    def __init__(self, p): self.player = p; self.join_message = "%s joined" % p.name
class PlayerChatEvent(PlayerEvent):
    def __init__(self, p, m): self.player = p; self.message = m
class _Cancellable(Event):
    def cancel(self): self.is_cancelled = True
class PacketReceiveEvent(_Cancellable):
    def __init__(self, p, pid, payload): self.player = p; self.packet_id = pid; self.payload = payload; self.is_cancelled = False
class PacketSendEvent(_Cancellable):
    def __init__(self, p, pid, payload): self.player = p; self.packet_id = pid; self.payload = payload; self.is_cancelled = False
