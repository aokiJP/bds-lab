// 実測データ: データ駆動の UI

// ---- server-ui: データ駆動の UI（CustomForm / MessageBox / Observable） -----------------------------
const observableImpl = (kind) => ({
  ctor(data, options) { return { kind, value: data, clientWritable: Boolean(options?.clientWritable), subs: [] }; },
  fns: {
    getData: (h) => h.value,
    setData(h, v) {
      h.value = v;
      for (const fn of [...h.subs]) call(`Observable${kind}.subscribe`, fn, [v]);
    },
    subscribe: (h, fn) => { h.subs.push(fn); return fn; },
    unsubscribe: (h, fn) => { const i = h.subs.indexOf(fn); if (i < 0) return false; h.subs.splice(i, 1); return true; },
    getFilteredText: (h) => $Promise.resolve(h.value),
  },
});
IMPL.ObservableString = observableImpl('String');
IMPL.ObservableNumber = observableImpl('Number');
IMPL.ObservableBoolean = observableImpl('Boolean');
IMPL.ObservableUIRawMessage = observableImpl('UIRawMessage');
const labelOf = (v) => { const oh = v && typeof v === 'object' ? H.get(v) : null; return oh?.kind ? oh.value : v; };
function takeUi(who) {
  const idx = uiQueue.findIndex((r) => !r.player || r.player === who);
  return idx >= 0 ? uiQueue.splice(idx, 1)[0] : null;
}
function ddui(kind) {
  return {
    ctor(player, title) { return { kind, player, title, items: [], showing: false }; },
    fns: new Proxy({}, {
      get(_, name) {
        if (name === 'isShowing') return (h) => h.showing;
        if (name === 'close') {
          return (h) => {
            if (!h.showing) throw fail('FormVisibilityError', 'The form is not showing.');
            h.finish?.('ServerClosed');
          };
        }
        if (name === 'show') {
          return function show(h) {
            if (h.showing) throw fail('FormVisibilityError', 'The form is already showing.');
            const who = H.get(h.player)?.e?.name;
            const r = takeUi(who) ?? { closeReason: 'ClientClosed' };
            h.showing = true;
            forms.push({ tick: S.tick, to: who, kind, title: labelOf(h.title), items: h.items.map((i) => ({ type: i.type, label: labelOf(i.label) })), response: r });
            return new $Promise((resolve) => {
              h.finish = (reason, selection) => {
                if (!h.showing) return;
                h.showing = false;
                h.finish = null;
                resolve(kind === 'MessageBox' ? { closeReason: reason, ...(selection !== undefined ? { selection } : {}) } : reason);
              };
              waits.push({
                due: S.tick + (r.afterTicks ?? 1),
                resolve: () => {
                  if (!h.showing) return;
                  // 値を持つ部品（textField / slider / toggle / dropdown）に、答えを順に入れる
                  const valued = h.items.filter((i) => i.value);
                  (r.values ?? []).forEach((v, i) => { if (valued[i] && v !== undefined) IMPL[`Observable${valued[i].value.kind}`].fns.setData(valued[i].value, v); });
                  const buttons = h.items.filter((i) => i.type === 'button');
                  for (const b of r.clicks ?? []) if (buttons[b]) call(`${kind}.button`, buttons[b].onClick, []);
                  h.finish(r.closeReason ?? (r.clicks?.length || r.selection !== undefined ? 'ClientClosed' : 'ClientClosed'), r.selection);
                },
              });
            });
          };
        }
        return function builder(h, ...args) {
          if (h.showing) throw fail('InvalidFormModificationError', 'The form cannot be modified while it is showing.');
          const item = { type: $String(name), label: args[0] };
          if (name === 'button') item.onClick = args[1];
          if (['textField', 'slider', 'toggle', 'dropdown'].includes(name)) {
            const obs = H.get(args[1]);
            if (!obs?.kind) throw fail('InvalidObservableError', 'Invalid observable.');
            item.value = obs;
          }
          if (name === 'button1' || name === 'button2') item.type = 'button';
          h.items.push(item);
          return this;
        };
      },
    }),
  };
}
IMPL.CustomForm = ddui('CustomForm');
IMPL.MessageBox = ddui('MessageBox');
