// generated from kit.ts by tests/kit-offline.mjs --fix (new --js copies it when no TypeScript is at hand)
// kit: small helpers tested on the real BDS (bds-lab selftest). Import what you use; the build drops the rest.
// API: cmd cmdAny onItem onBlock ready | ask menu confirm input | inv count take give item | once load save | score every cooldown | getState setState | feature
import { world, system, Player, ItemStack, CommandPermissionLevel, CustomCommandStatus, CustomCommandParamType, DisplaySlotId, } from '@minecraft/server';
import { ActionFormData, ModalFormData, MessageFormData, FormCancelationReason } from '@minecraft/server-ui';
// ---- startup (custom commands and components can only be registered here) ----
const early = [];
let hooked = false;
function atStartup(fn) {
    early.push(fn);
    if (!hooked) {
        hooked = true;
        system.beforeEvents.startup.subscribe((e) => { for (const f of early)
            f(e); });
    }
}
const PT = {
    int: CustomCommandParamType.Integer, float: CustomCommandParamType.Float, string: CustomCommandParamType.String,
    bool: CustomCommandParamType.Boolean, player: CustomCommandParamType.PlayerSelector, entity: CustomCommandParamType.EntitySelector,
    loc: CustomCommandParamType.Location, item: CustomCommandParamType.ItemType, block: CustomCommandParamType.BlockType,
};
/** `/ns:name` command run by a player. params: {count: 'int', 'mode?': ['a','b']} ('?' = optional, array = enum). fn (may be
 *  async) runs in system.run (world edits allowed); a returned string is sent to the player. op: operators only.
 *  From the console / a command block it answers "players only" (cmdAny: p may be undefined there). */
export function cmd(name, description, params, fn, op = false) {
    cmdAny(name, description, params, (p, a, o) => (p ? fn(p, a, o) : 'players only'), op);
}
/** like cmd, also from the console or command blocks (p undefined there; a returned string is logged) */
export function cmdAny(name, description, params, fn, op = false) {
    const ns = name.split(':')[0];
    atStartup((e) => {
        const list = Object.entries(params).map(([k, t]) => {
            const opt = k.endsWith('?'), key = opt ? k.slice(0, -1) : k;
            if (Array.isArray(t)) {
                const en = `${ns}:${key}`;
                e.customCommandRegistry.registerEnum(en, [...t]);
                return { key, opt, p: { name: en, type: CustomCommandParamType.Enum } };
            }
            return { key, opt, p: { name: key, type: PT[t] } };
        });
        e.customCommandRegistry.registerCommand({
            name, description, permissionLevel: op ? CommandPermissionLevel.GameDirectors : CommandPermissionLevel.Any,
            mandatoryParameters: list.filter((x) => !x.opt).map((x) => x.p), optionalParameters: list.filter((x) => x.opt).map((x) => x.p),
        }, (o, ...v) => {
            const order = [...list.filter((x) => !x.opt), ...list.filter((x) => x.opt)];
            const a = {};
            order.forEach((x, i) => { a[x.key] = v[i]; });
            const who = o.initiator ?? o.sourceEntity, p = who instanceof Player ? who : undefined;
            const tell = (r) => { if (typeof r === 'string') {
                if (!p)
                    console.warn(r);
                else if (p.isValid)
                    p.sendMessage(r);
            } }; // (a player who left meanwhile: no reply)
            system.run(() => { const r = fn(p, a, o); r instanceof Promise ? r.then(tell) : tell(r); });
            return { status: CustomCommandStatus.Success };
        });
    });
}
/** item custom component: bp item json gets "<name>": {} in components. def: {onUse(e){...}, onConsume, onHitEntity, onMineBlock...} */
export function onItem(name, def) { atStartup((e) => e.itemComponentRegistry.registerCustomComponent(name, def)); }
/** block custom component: bp block json gets "<name>": {} in components. def: {onPlayerInteract(e){...}, onTick, onStepOn...} */
export function onBlock(name, def) { atStartup((e) => e.blockComponentRegistry.registerCustomComponent(name, def)); }
/** run once the world is loaded (world.* is not usable at the top level) */
export function ready(fn) { world.afterEvents.worldLoad.subscribe(() => fn()); }
/** show a form; retries up to `tries` x 5 ticks while the player is busy. undefined = closed, left or refused (never throws) */
export async function ask(p, form, tries = 60) {
    for (let i = 0; i < tries && p.isValid; i++) {
        let r;
        try {
            r = await form.show(p);
        }
        catch {
            return undefined;
        } // the player left, or the client refused it
        if (!r.canceled)
            return r;
        if (r.cancelationReason !== FormCancelationReason.UserBusy)
            return undefined;
        await system.waitTicks(5);
    }
    return undefined;
}
/** buttons; the chosen one's fn runs. → its index. menu(p, 'Shop', [['Diamond', (p) => buy(p)], ['Close']], 'body text') */
export async function menu(p, title, buttons, body) {
    const f = new ActionFormData().title(title);
    if (body)
        f.body(body);
    for (const [label] of buttons)
        f.button(label);
    const r = await ask(p, f);
    if (r?.selection === undefined)
        return undefined;
    await buttons[r.selection]?.[1]?.(p);
    return r.selection;
}
/** yes / no → true / false (undefined = closed) */
export async function confirm(p, text, title = '', yes = 'Yes', no = 'No') {
    const r = await ask(p, new MessageFormData().title(title).body(text).button1(yes).button2(no));
    return r?.selection === undefined ? undefined : r.selection === 0;
}
/** fields by label → {label: value}. 'text' 'number' 'toggle', ['a','b'] dropdown (→ the chosen string), [min,max(,step)] slider.
 *  input(p, 'Send', { To: 'text', Amount: [1, 64], Mode: ['gift', 'sell'], Anonymous: 'toggle' }) */
export async function input(p, title, fields) {
    const f = new ModalFormData().title(title), keys = Object.keys(fields), kind = (t) => (typeof t === 'string' ? t : typeof t[0] === 'number' ? 'slider' : 'dropdown');
    for (const k of keys) {
        const t = fields[k], c = kind(t);
        if (c === 'text' || c === 'number')
            f.textField(k, c === 'number' ? '0' : '');
        else if (c === 'toggle')
            f.toggle(k);
        else if (c === 'slider')
            f.slider(k, t[0], t[1], { valueStep: t[2] ?? 1 });
        else
            f.dropdown(k, [...t]);
    }
    const r = await ask(p, f);
    if (!r?.formValues)
        return undefined;
    const o = {};
    keys.forEach((k, i) => { const t = fields[k], c = kind(t), v = r.formValues[i]; o[k] = c === 'number' ? Number(v) : c === 'dropdown' ? t[v] : v; });
    return o;
}
// ---- inventory ----
/** an ItemStack with a shown name and lore lines: give(p, item('minecraft:diamond_sword', 'Excalibur', ['Legendary'])) */
export function item(id, name, lore, n = 1) {
    const s = new ItemStack(id, n);
    if (name)
        s.nameTag = name;
    if (lore?.length)
        s.setLore(lore);
    return s;
}
export const inv = (e) => e.getComponent('minecraft:inventory').container;
const full = (id) => (id.includes(':') ? id : 'minecraft:' + id); // 'emerald' = 'minecraft:emerald', as give() takes it
/** how many `id` the entity carries ('emerald' or 'minecraft:emerald') */
export function count(e, id) {
    const c = inv(e);
    let n = 0;
    id = full(id);
    for (let i = 0; i < c.size; i++) {
        const s = c.getItem(i);
        if (s?.typeId === id)
            n += s.amount;
    }
    return n;
}
/** remove n of `id`, all or nothing: false (nothing taken) when it has fewer */
export function take(e, id, n = 1) {
    id = full(id);
    if (count(e, id) < n)
        return false;
    const c = inv(e);
    for (let i = c.size - 1; i >= 0 && n > 0; i--) {
        const s = c.getItem(i);
        if (s?.typeId !== id)
            continue;
        const t = Math.min(n, s.amount);
        n -= t;
        if (t === s.amount)
            c.setItem(i);
        else {
            s.amount -= t;
            c.setItem(i, s);
        }
    }
    return true;
}
/** give n of an item (id or ItemStack); what does not fit drops at the entity's feet (at most 64 stacks: a typo'd huge n must not hang the server) */
export function give(e, item, n) {
    const base = typeof item === 'string' ? new ItemStack(item) : item;
    let left = Math.min(Math.floor(n ?? base.amount), 64 * base.maxAmount);
    const c = inv(e);
    while (left > 0) {
        const s = base.clone();
        s.amount = Math.min(left, s.maxAmount);
        left -= s.amount;
        const rest = c.addItem(s);
        if (rest)
            e.dimension.spawnItem(rest, e.location);
    }
}
/** true only the first time for this holder+key, ever (first join, one-time rewards) */
export function once(h, key) {
    const k = 'kit:once:' + key;
    if (h.getDynamicProperty(k))
        return false;
    h.setDynamicProperty(k, true);
    return true;
}
/** JSON value saved under key (default when unset or unreadable) */
export function load(h, key, def) {
    const s = h.getDynamicProperty(key);
    if (typeof s !== 'string')
        return def;
    try {
        return JSON.parse(s);
    }
    catch {
        return def;
    }
}
/** save a JSON value (at most 32767 characters) */
export function save(h, key, v) { h.setDynamicProperty(key, JSON.stringify(v)); }
// ---- scoreboard, time ----
/** get or create an objective; show: 'Sidebar' | 'List' | 'BelowName'. Call after load (not at the top level) */
export function score(id, name = id, show) {
    const o = world.scoreboard.getObjective(id) ?? world.scoreboard.addObjective(id, name);
    if (show)
        world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId[show], { objective: o });
    return o;
}
/** fn(player) for every online player every `ticks` ticks (20 = 1 s); returns the run id (system.clearRun) */
export function every(ticks, fn) {
    return system.runInterval(() => { for (const p of world.getAllPlayers())
        fn(p); }, ticks);
}
const cds = new Map();
/** true (and restarts the wait) when `ticks` have passed since the last true for this entity+key */
export function cooldown(e, key, ticks) {
    const k = e.id + '|' + key, now = system.currentTick;
    if ((cds.get(k) ?? -Infinity) > now)
        return false;
    cds.set(k, now + ticks);
    return true;
}
// ---- block states ----
/** a block's state, custom ('ns:lit') or vanilla (custom names are not in the typings: this avoids the type error) */
export function getState(b, name) { return b.permutation.getState(name); }
/** set one state of a block (the others stay) */
export function setState(b, name, v) { b.setPermutation(b.permutation.withState(name, v)); }
const offList = () => (typeof LAB_FEATURES_OFF !== 'undefined' ? LAB_FEATURES_OFF : globalThis.LAB_FEATURES_OFF) ?? [];
/** feature('ml') → false when features.json has it off. feature('ml', () => {...}): runs the set-up only when on, and if it throws
 *  (an API this Minecraft no longer has) logs it and carries on without that part instead of stopping the whole addon. */
export function feature(name, setup) {
    if (offList().includes(name))
        return false;
    if (setup)
        try {
            setup();
        }
        catch (e) {
            console.warn(`[lab] feature ${name} disabled: ${e}`);
            return false;
        }
    return true;
}
