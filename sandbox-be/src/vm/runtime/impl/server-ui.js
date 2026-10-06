// 実装: @minecraft/server-ui

// ---- server-ui ------------------------------------------------------------

const uiQueue = [...(CFG.ui ?? [])];
const forms = [];
function formImpl(kind) {
  return {
    ctor() { return { kind, calls: [] }; },
    fns: new Proxy({}, {
      get(_, name) {
        if (name === 'show') {
          return function show(h, player) {
            const ph = H.get(player);
            const who = ph?.e?.name;
            const idx = uiQueue.findIndex((r) => !r.player || r.player === who);
            const r = idx >= 0 ? uiQueue.splice(idx, 1)[0] : { canceled: 'UserClosed' };
            forms.push({ tick: S.tick, to: who, kind, calls: h.calls, response: r });
            const resCls = { ActionFormData: 'ActionFormResponse', ModalFormData: 'ModalFormResponse', MessageFormData: 'MessageFormResponse' }[kind];
            const data = {
              canceled: Boolean(r.canceled),
              cancelationReason: r.canceled ? (r.canceled === true ? 'UserClosed' : r.canceled) : undefined,
              selection: r.selection,
              formValues: r.formValues,
            };
            const delay = r.afterTicks ?? 1;
            return new $Promise((resolve) => { waits.push({ due: S.tick + delay, resolve: () => resolve(inst(resCls, { data })) }); });
          };
        }
        return function builder(h, ...args) {
          h.calls.push({ method: $String(name), args: args.map((a) => (typeof a === 'object' && a !== null && H.get(a) ? '[object]' : a)) });
          return this;
        };
      },
    }),
  };
}
IMPL.ActionFormData = formImpl('ActionFormData');
IMPL.ModalFormData = formImpl('ModalFormData');
IMPL.MessageFormData = formImpl('MessageFormData');
IMPL.UIManager = { fns: { closeAllForms(h, p) { forms.push({ tick: S.tick, to: H.get(p)?.e?.name, kind: 'closeAllForms' }); } } };
IMPL.FormResponse = { get: { canceled: (h) => h.data.canceled, cancelationReason: (h) => h.data.cancelationReason } };
IMPL.ActionFormResponse = { get: { selection: (h) => h.data.selection } };
IMPL.MessageFormResponse = { get: { selection: (h) => h.data.selection } };
IMPL.ModalFormResponse = { get: { formValues: (h) => h.data.formValues } };
