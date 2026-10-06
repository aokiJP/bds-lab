import endstone
class Plugin:
    api_version = None
    def __init__(self): self.server = None; self.logger = None; self.is_enabled = False; self.name = None
    def on_load(self): pass
    def on_enable(self): pass
    def on_disable(self): pass
    def register_events(self, listener): endstone._SERVER.plugin_manager.register_events(listener, self)
