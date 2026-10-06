#!/usr/bin/env python3
# bds-lab's changes to TS REPL, applied the same way to the shipped bundle (bp/scripts/main.js) and its split (source/src/*.ts),
# so the two stay byte-for-byte parallel (upstream rule: README.md "src/ は出荷物の割り戻し"). Idempotent: run it again after
# taking a newer TS REPL; each change is skipped when already there and fails loudly when its anchor moved.
import glob, os, sys
U = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [os.path.join(U, 'bp', 'scripts', 'main.js')] + sorted(glob.glob(os.path.join(U, 'source', 'src', '**', '*.ts'), recursive=True))
P = [
 # 1. the server console is the owner: /scriptevent typed at BDS's console reaches the AI bridge with no switch and no token
 ('console-trust-a', '    if (ev.id !== WIRE_EVENT) return;\n    noteInbound();\n    void handle(ev.message);',
  '    if (ev.id !== WIRE_EVENT) return;\n    noteInbound();\n    void handle(ev.message, fromConsole(ev));'),
 ('console-trust-b', '      noteInbound("net");\n      void handle(whole);', '      noteInbound("net");\n      void handle(whole, fromConsole(ev));'),
 ('console-trust-c', 'function install4() {',
  '// bds-lab: a request typed at the server console (source "Server", no entity, no block) comes from whoever runs the server:\n// trusted like the owner (no bridge switch, no token). Players and command blocks still need both.\nfunction fromConsole(ev) {\n  return ev.sourceType === "Server" && !ev.sourceEntity && !ev.sourceBlock;\n}\nfunction install4() {'),
 ('console-trust-d', 'async function handle(raw) {', 'async function handle(raw, trusted = false) {'),
 ('console-trust-e', '  if (!enabled) {\n    reply(false, void 0, "AI', '  if (!enabled && !trusted) {\n    reply(false, void 0, "AI'),
 ('console-trust-f', '  if (token && req.token !== token) {', '  if (token && req.token !== token && !trusted) {'),
 # 2. eval with nobody online runs as the server; `slot` = its own set of resident handlers (a re-run replaces only those);
 #    what they log later goes to the content log as [tsrepl:<slot>]
 ('eval-noplayer', '        const player = resolvePlayer(req.as);\n        if (!player) return reply(false, void 0, "\\u5B9F\\u884C\\u3067\\u304D\\u308B\\u30D7\\u30EC\\u30A4\\u30E4\\u30FC\\u304C\\u3044\\u307E\\u305B\\u3093");',
  '        const player = resolvePlayer(req.as);   // (bds-lab: nobody online: it runs as the server)'),
 ('eval-audit', 'p: "ai:" + player.name,', 'p: "ai:" + (player ? player.name : "server"),'),
 ('eval-slot', '          keepSession: false,\n          isModule: out.isModule\n        });',
  '          keepSession: false,\n          isModule: out.isModule,\n          liveKey: req.slot ? "slot:" + String(req.slot).slice(0, 80) : void 0,\n          lateLogs: true\n        });'),
 ('live-key-a', 'function liveKeyOf(player) {\n  return player && player.id ? player.id : "__server__";', 'function liveKeyOf(player, slot) {\n  return slot ? slot : player && player.id ? player.id : "__server__";'),
 ('live-key-b', 'function beginLiveRun(player) {\n  const key = liveKeyOf(player);', 'function beginLiveRun(player, slot) {\n  const key = liveKeyOf(player, slot);'),
 ('live-key-c', '  const live = beginLiveRun(player);', '  const late = { on: false, key: liveKeyOf(player, options.liveKey) };\n  const live = beginLiveRun(player, options.liveKey);'),
 ('late-a', '    mcOverride: mcShim\n  });\n  if (live.cleared > 0) {', '    mcOverride: mcShim,\n    late: options.lateLogs ? late : void 0\n  });\n  if (live.cleared > 0) {'),
 ('late-b', '  } finally {\n    if (options.trace) end2();\n  }', '  } finally {\n    if (options.trace) end2();\n    late.on = true;\n  }'),
 ('late-c', '  const capture2 = (level) => (...args) => {\n    if (logChars > options.maxOutputChars) return;',
  '  const capture2 = (level) => (...args) => {\n    if (options.late && options.late.on) {\n      const late = [];\n      for (const a of args) late.push(inspect(a, 2));\n      console.warn("[tsrepl:" + options.late.key + "] " + (level === "log" ? "" : "[" + level + "] ") + late.join(" "));\n      return;\n    }\n    if (logChars > options.maxOutputChars) return;'),
 # 3. the bridge's save / trigger / delete wire the triggers at once (as the in-game screen does): no /reload
 ('wire-save', '        if (!r.ok) return reply(false, void 0, r.error);\n        reply(true, { saved: name });', '        if (!r.ok) return reply(false, void 0, r.error);\n        reinstall();\n        reply(true, { saved: name });'),
 ('wire-delete', '        deleteScript(name);\n        reply(true, { deleted: name });', '        deleteScript(name);\n        reinstall();\n        reply(true, { deleted: name });'),
 ('wire-trigger', '        setTrigger(name, req.trigger ?? { kind: "manual" });', '        setTrigger(name, req.trigger ?? { kind: "manual" });\n        reinstall();'),
 # 4. every save (in-game or not) stamps the script, and list says it: a workspace sync sees what changed in the world
 ('stamp-save', '    disabled: existing ? existing.disabled : false,\n    updated: 0', '    disabled: existing ? existing.disabled : false,\n    updated: Date.now()'),
 ('stamp-list', '            trigger: m.trigger,\n            disabled: !!m.disabled\n          }))', '            trigger: m.trigger,\n            disabled: !!m.disabled,\n            updated: m.updated || 0\n          }))'),
 # 5. the shields (what lets a re-run remove the last run's handlers) are proxies; on BDS 1.26.52 world.afterEvents is an own
 #    read-only property, so a proxy over world itself must return it unchanged ("TypeError: proxy: inconsistent get" for every
 #    import { world } ... world.afterEvents.x.subscribe). The proxies now stand on an empty object of the same prototype.
 ('shield-world', '  const before = shieldEvents(base.beforeEvents, reg);\n  return new Proxy(base, {\n    get(target, prop) {', '  const before = shieldEvents(base.beforeEvents, reg);\n  return new Proxy(Object.create(Object.getPrototypeOf(base)), {\n    get(_, prop) {\n      const target = base;'),
 ('shield-system', '    return id;\n  };\n  return new Proxy(base, {\n    get(target, prop) {', '    return id;\n  };\n  return new Proxy(Object.create(Object.getPrototypeOf(base)), {\n    get(_, prop) {\n      const target = base;'),
 # 6. stop: drop the resident handlers of one slot (or the server's)
 ('stop', '      case "save": {\n        const name = String(req.name ?? "");',
  '      case "stop": {\n        reply(true, { cleared: releaseRun(req.slot ? "slot:" + String(req.slot).slice(0, 80) : "__server__") });\n        return;\n      }\n      case "save": {\n        const name = String(req.name ?? "");'),
]
texts = {f: open(f, encoding='utf8').read() for f in FILES}
bad = 0
for tag, old, new in P:
    for group in [g for g in (FILES[:1], FILES[1:]) if g]:   # the bundle, then the split (a copy without source/ has only the bundle)
        if any(new in texts[f] for f in group): continue   # (already there)
        hit = [f for f in group if old in texts[f]]
        if len(hit) != 1 or texts[hit[0]].count(old) != 1:
            print(f'E {tag}: anchor found {sum(texts[f].count(old) for f in group)}x in {"main.js" if group is FILES[:1] else "source/src"}'); bad += 1; continue
        texts[hit[0]] = texts[hit[0]].replace(old, new, 1)
if bad: sys.exit(1)
for f, t in texts.items():
    if open(f, encoding='utf8').read() != t: open(f, 'w', encoding='utf8').write(t); print('patched', os.path.relpath(f, U))
print('OK TS REPL: bds-lab changes in place (%d)' % len(P))
