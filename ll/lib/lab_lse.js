// bds-lab helper for LeviLamina's LegacyScriptEngine (QuickJS). Lab servers only, never packed.
// Bundled first into a script mod's own file (so `lse` sees the mod's variables), or deployed alone as plugins/lab_lse/
// next to a native mod. The lab sends console lines `labjs <base64 json>` (caught with onConsoleCmd, never executed).
//   lse <code>        eval (async; `return x` works) with mc, ll, logger, p(name), run(cmd), inv(p), block(x,y,z), $
//   events on [..]    every LSE event with its arguments   (EV onJoin A ...)
//   states on [..]    each player's properties when they change (ST A key=value)
//   perf [ms]         tick time and TPS measured on onTick
(function () {
  var G = globalThis;
  if (G.__labLse) return;
  G.__labLse = true;
  var say = function (s) { String(s).split('\n').forEach(function (l) { logger.info(l); }); };
  var err = function (s) { logger.error(String(s)); };

  // base64 -> UTF-8 text (QuickJS in LSE has no atob/Buffer)
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function unb64(s) {
    var bytes = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s[i]);
      if (v < 0) continue;
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); }
    }
    var out = '', j = 0;
    while (j < bytes.length) {
      var c = bytes[j++];
      if (c < 128) out += String.fromCharCode(c);
      else if (c < 224) out += String.fromCharCode(((c & 31) << 6) | (bytes[j++] & 63));
      else if (c < 240) out += String.fromCharCode(((c & 15) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63));
      else { var cp = ((c & 7) << 18) | ((bytes[j++] & 63) << 12) | ((bytes[j++] & 63) << 6) | (bytes[j++] & 63); cp -= 0x10000; out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    }
    return out;
  }

  // short, stable text for LSE objects: Player -> name, Entity -> type, Block -> type@x,y,z, Item -> type*n, pos -> x,y,z
  function num(v) { return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000); }
  function has(o, k) { try { return o[k] !== undefined; } catch (e) { return false; } }
  function fmt(v, d) {
    d = d || 0;
    if (v === undefined || v === null) return '-';
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string') return d ? JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v) : v;
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'function') return '[fn]';
    if (Array.isArray(v)) return '[' + v.slice(0, 12).map(function (x) { return fmt(x, d + 1); }).join(',') + (v.length > 12 ? ',+' + (v.length - 12) : '') + ']';
    try {
      if (has(v, 'realName') && has(v, 'xuid')) return v.realName || v.name;
      if (has(v, 'type') && has(v, 'count') && has(v, 'aux')) return String(v.type).replace('minecraft:', '') + '*' + v.count;
      if (has(v, 'type') && has(v, 'pos') && has(v, 'tileData')) return String(v.type).replace('minecraft:', '') + '@' + v.pos.x + ',' + v.pos.y + ',' + v.pos.z;
      if (has(v, 'x') && has(v, 'y') && has(v, 'z') && has(v, 'dimid')) return num(v.x) + ',' + num(v.y) + ',' + num(v.z) + (v.dimid ? '@' + v.dimid : '');
      if (has(v, 'type') && has(v, 'uniqueId') && has(v, 'pos')) return String(v.type).replace('minecraft:', '');
    } catch (e) { /* fall through */ }
    if (d > 2) return '{..}';
    var ks = [];
    try { ks = Object.keys(v); } catch (e) { ks = []; }
    return '{' + ks.slice(0, 20).map(function (k) { var x; try { x = v[k]; } catch (e) { x = '?'; } return typeof x === 'function' ? null : k + '=' + fmt(x, d + 1); }).filter(Boolean).join(' ') + '}';
  }

  var $ = {};
  function p(name) { var ps = mc.getOnlinePlayers(); if (!name) return ps[ps.length - 1]; return mc.getPlayer(name) || ps.filter(function (q) { return q.realName === name; })[0]; }
  function run(cmd) { var r = mc.runcmdEx(cmd); return r && r.output !== undefined ? (r.success ? '' : 'FAILED ') + r.output : r; }
  function inv(q) { q = typeof q === 'string' || !q ? p(q) : q; var out = []; q.getInventory().getAllItems().forEach(function (it, i) { if (it && !it.isNull()) out.push(i + ':' + fmt(it)); }); return out; }
  function block(x, y, z, dim) { return mc.getBlock(x, y, z, dim || 0); }
  var AF = Object.getPrototypeOf(async function () {}).constructor;
  var ARGS = ['mc', 'll', 'logger', 'p', 'run', 'inv', 'block', 'fmt', '$'];

  function evalOp(code) {
    var f;
    // the mod's own top-level names (const/let/function in src/main.ts: the lab build puts getters on __labTop) are in scope too
    var top = G.__labTop || {}, A2 = ARGS.concat(['__labTop']).join(',');
    try { f = new AF(A2, 'with (__labTop) { return (' + code + '\n) }'); } catch (e) { f = new AF(A2, 'with (__labTop) { ' + code + '\n}'); }
    return f(mc, ll, logger, p, run, inv, block, fmt, $, top);
  }

  // ---- event tap (LSE cannot unlisten: listeners stay, a flag decides whether they print)
  var EVENTS = ['onPreJoin', 'onJoin', 'onLeft', 'onRespawn', 'onPlayerDie', 'onPlayerCmd', 'onChat', 'onChangeDim', 'onJump', 'onSneak',
    'onAttackEntity', 'onAttackBlock', 'onUseItem', 'onUseItemOn', 'onTakeItem', 'onDropItem', 'onEat', 'onConsumeTotem', 'onEffectAdded',
    'onEffectRemoved', 'onEffectUpdated', 'onStartDestroyBlock', 'onDestroyBlock', 'onPlaceBlock', 'afterPlaceBlock', 'onOpenContainer',
    'onCloseContainer', 'onInventoryChange', 'onChangeSprinting', 'onSetArmor', 'onUseRespawnAnchor', 'onOpenContainerScreen', 'onExperienceAdd',
    'onBedEnter', 'onPlayerInteractEntity', 'onMobDie', 'onMobHurt', 'onEntityExplode', 'onProjectileHitEntity', 'onRide', 'onStepOnPressurePlate',
    'onSpawnProjectile', 'onProjectileCreated', 'onNpcCmd', 'onEntityTransformation', 'onBlockInteracted', 'onBlockChanged', 'onBlockExplode',
    'onFireSpread', 'onCmdBlockExecute', 'onContainerChange', 'onProjectileHitBlock', 'onRedStoneUpdate', 'onHopperSearchItem', 'onHopperPushOut',
    'onPistonTryPush', 'onPistonPush', 'onFarmLandDecay', 'onUseFrameBlock', 'onLiquidFlow', 'onScoreChanged', 'onServerStarted'];
  var tap = { on: false, names: null, listened: false, st: null, prev: {}, keys: null };
  function listenAll() {
    var n = 0;
    EVENTS.forEach(function (name) {
      try {
        var ok = mc.listen(name, function () {
          if (!tap.on || (tap.names && tap.names.indexOf(name) < 0)) return;
          var a = Array.prototype.slice.call(arguments).map(function (x) { return fmt(x, 1); });
          say('EV ' + name + (a.length ? ' ' + a.join(' ') : ''));
        });
        if (ok !== false) n++;
      } catch (e) { /* not in this LSE version */ }
    });
    return n;
  }
  var PROPS = ['gameMode', 'health', 'maxHealth', 'permLevel', 'isOP', 'canFly', 'isFlying', 'isSneaking', 'isSprinting', 'isOnGround', 'inAir',
    'inWater', 'inLava', 'isRiding', 'isSleeping', 'isGliding', 'isOnFire', 'isHungry', 'isInvisible', 'isMoving', 'speed', 'langCode'];
  function readState(q) {
    var v = {};
    PROPS.forEach(function (k) { try { var x = q[k]; if (typeof x === 'function') x = x.call(q); if (x !== undefined && typeof x !== 'object') v[k] = typeof x === 'number' ? num(Math.round(x * 10) / 10) : String(x); } catch (e) { /* missing */ } });
    try { var bp = q.blockPos; v.pos = bp.x + ',' + bp.y + ',' + bp.z; v.dim = String(bp.dimid); } catch (e) { /* missing */ }
    try { v.yaw = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'][((Math.round(q.direction.yaw / 45) % 8) + 8) % 8]; v.pitch = String(Math.round(q.direction.pitch / 15) * 15); } catch (e) { /* missing */ }
    try { v.inventory = inv(q).join(',') || '-'; } catch (e) { /* missing */ }
    try { v.tags = q.getAllTags().sort().join(',') || '-'; } catch (e) { /* missing */ }
    try { v.hand = fmt(q.getHand()); } catch (e) { /* missing */ }
    if (tap.keys) Object.keys(v).forEach(function (k) { if (!tap.keys.some(function (w) { return k === w || k.indexOf(w + '.') === 0; })) delete v[k]; });
    return v;
  }
  function pollStates() {
    var here = {};
    mc.getOnlinePlayers().forEach(function (q) {
      var name = q.realName; here[name] = 1;
      var v; try { v = readState(q); } catch (e) { say('ST ' + name + ' (unreadable: ' + e + ')'); return; }
      var pv = tap.prev[name]; tap.prev[name] = v;
      if (!pv) { say('ST ' + name + ' init ' + Object.keys(v).map(function (k) { return k + '=' + v[k]; }).join(' ')); return; }
      Object.keys(Object.assign({}, pv, v)).sort().forEach(function (k) { if ((pv[k] || '-') !== (v[k] || '-')) say('ST ' + name + ' ' + k + '=' + (v[k] || '-')); });
    });
    Object.keys(tap.prev).forEach(function (n) { if (!here[n]) delete tap.prev[n]; });
  }

  // ---- perf: wall clock between onTick calls (LSE has no MSPT API)
  var perf = { on: false, last: 0, gaps: [], listened: false };
  function perfOp(ms, done) {
    if (!perf.listened) { perf.listened = true; mc.listen('onTick', function () { if (!perf.on) return; var t = Date.now(); if (perf.last) perf.gaps.push(t - perf.last); perf.last = t; }); }
    perf.on = true; perf.last = 0; perf.gaps = [];
    setTimeout(function () {
      perf.on = false;
      var g = perf.gaps, avg = g.length ? g.reduce(function (a, b) { return a + b; }, 0) / g.length : 0;
      say('PERF tick avg ' + num(avg) + 'ms max ' + (g.length ? Math.max.apply(null, g) : 0) + 'ms | tps ' + (avg ? num(Math.min(20, 1000 / avg)) : '-') + ' | players ' + mc.getOnlinePlayers().length);
      done();
    }, ms);
  }

  function handle(req, done) {
    if (req.op === 'eval') {
      evalOp(req.code).then(function (r) { if (r !== undefined) say(fmt(r)); done(); }, function (e) { err('lse: ' + (e && e.message ? e.message : e) + (e && e.stack ? ' ' + String(e.stack).split('\n')[0] : '')); done(); });
      return;
    }
    if (req.op === 'events') {
      tap.on = !!req.on; tap.names = req.names && req.names.length ? req.names : null;
      if (tap.on && !tap.listened) { tap.n = listenAll(); tap.listened = true; }
      say(tap.on ? 'events on: ' + tap.n : 'events off');
    } else if (req.op === 'states') {
      if (tap.st !== null) clearInterval(tap.st);
      tap.st = null; tap.prev = {}; tap.keys = req.keys && req.keys.length ? req.keys : null;
      if (req.on) tap.st = setInterval(pollStates, 50);
      say(req.on ? 'states on' + (tap.keys ? ': ' + tap.keys.join(' ') : '') : 'states off');
    } else if (req.op === 'perf') { perfOp(req.ms || 3000, done); return; }
    else if (req.op === 'bots') botsOp(req);
    else if (req.op === 'lag') {   // stall the server thread ms per tick for n ticks (how does the mod behave at low TPS?)
      var left = req.ticks || 40, ms = req.ms || 100;
      var t = setInterval(function () { var until = Date.now() + ms; while (Date.now() < until) { /* stall */ } if (--left <= 0) { clearInterval(t); say('lag done (' + (req.ticks || 40) + ' ticks x ' + ms + 'ms)'); } }, 50);
      say('lag ' + ms + 'ms x ' + (req.ticks || 40) + ' ticks');
    } else if (req.op === 'watch') {   // evaluate expressions every tick in the mod's context; print when a value changes
      if (req.off) { if (watch.t) clearInterval(watch.t); watch.t = null; watch.exprs = {}; say('watch off'); }
      else {
        var show = function (e, c) { if (watch.exprs[e] && c !== watch.exprs[e].v) { watch.exprs[e].v = c; say('W ' + e + ' = ' + c); } };
        var look = function (e) { return evalOp('return (' + e + ')').then(function (r) { show(e, fmt(r, 1)); }, function (x) { show(e, 'error: ' + (x && x.message)); }); };
        watch.exprs[req.expr] = { v: {} };
        if (!watch.t) watch.t = setInterval(function () { Object.keys(watch.exprs).forEach(look); }, 50);
        say('watch ' + req.expr);
        look(req.expr).then(done, done);   // the value now, before the next command runs
        return;
      }
    }
    done();
  }
  var watch = { t: null, exprs: {} };
  // ---- bots: LeviLamina's simulated players (server-side, no network): many players at once for load and multi-player logic
  var bots = { list: [], walk: null };
  function botsOp(req) {
    if (req.off) {
      if (bots.walk) clearInterval(bots.walk); bots.walk = null;
      bots.list.forEach(function (b) { try { b.simulateDisconnect(); } catch (e) { /* gone */ } }); bots.list = [];
      say('BOTS 0 online'); return;
    }
    var at = req.pos || (function () { var q = mc.getOnlinePlayers()[0]; return q ? [q.blockPos.x, q.blockPos.y, q.blockPos.z] : [0, -60, 0]; })();
    for (var i = 0; i < (req.n || 1); i++) {
      var k = bots.list.length + 1, sp = null;
      try { sp = mc.spawnSimulatedPlayer('Bot' + k, at[0] + (k % 8) * 2, at[1], at[2] + Math.floor(k / 8) * 2, 0); } catch (e) { err('bots: ' + e); break; }
      if (!sp) { err('bots: spawnSimulatedPlayer returned null'); break; }
      bots.list.push(sp);
    }
    if (req.walk && !bots.walk) bots.walk = setInterval(function () {
      bots.list.forEach(function (b) { try { b.simulateMoveTo(mc.newFloatPos ? mc.newFloatPos(at[0] + Math.random() * 16 - 8, at[1], at[2] + Math.random() * 16 - 8, 0) : { x: at[0] + Math.random() * 16 - 8, y: at[1], z: at[2] + Math.random() * 16 - 8, dimid: 0 }); } catch (e) { /* stuck */ } });
    }, 2000);
    say('BOTS ' + bots.list.length + ' online' + (bots.walk ? ' (walking)' : ''));
  }

  var parts = [];
  mc.listen('onConsoleCmd', function (cmd) {
    if (cmd.indexOf('labjsp ') === 0) { parts.push(cmd.slice(7).trim()); return false; }
    if (cmd.indexOf('labjs ') !== 0) return;
    var payload = parts.join('') + cmd.slice(6).trim(); parts = [];
    var req;
    try { req = JSON.parse(unb64(payload)); } catch (e) { err('lse: unreadable request (' + e + ')'); logger.info('LAB_LSE_DONE'); return false; }
    try { handle(req, function () { logger.info('LAB_LSE_DONE'); }); } catch (e) { err('lse: ' + e); logger.info('LAB_LSE_DONE'); }
    return false;
  });
  logger.info('LAB_LSE_READY');
})();
