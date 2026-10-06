// Every JSON UI screen the lab can bring up in the real app, and how (`app ui`): an addon's rp/ui files → the screens that
// draw them → app.txt sections (lib/scenario.mjs) that open each screen in the world, take its picture and close it again.
// The client's content log is read at every section boundary, so a JSON UI error is tied to the screen that raised it.
//
// How a screen is opened, from outside the game:
//   - the server: commands and scripts (`do`): titles, the sidebar, forms (`do js` with @minecraft/server-ui), kill / kick
//   - the player's hands: the camera is pointed at a block or a mob placed in front (tp … facing), and the centre of the
//     screen is tapped (touch: a tap on a block or a mob uses it, on air uses the item in the hand)
//   - the keyboard: E (inventory), T (chat), BACK (pause, and closing any screen)
//   - the screen's own words: tap text (OCR) for buttons like Respawn or Settings
// The world is the lab's flat one: the player stands at 0 -60 0, blocks go 2 ahead (0 -60 2), mobs 2.5 ahead.
import fs from 'node:fs';
import path from 'node:path';

const AT = { x: 0, y: -60, z: 2 };
const face = (y = -59.5) => `do tp @a 0 -60 0 facing 0.5 ${y} 2.5`;
/** a block in front of the player, used (tapped) to open its screen, shot, closed, removed */
const block = (id, blockId, { state = '', wait = 2500 } = {}) => [
  face(), `do setblock ${AT.x} ${AT.y} ${AT.z} ${blockId}${state ? ` ${state}` : ''}`, 'wait 1200', 'tap 0.5 0.5', `wait ${wait}`, `shot ui-${id}`, 'changed', 'key BACK', 'wait 1500', `do setblock ${AT.x} ${AT.y} ${AT.z} air`,
];
const mob = (id, type, { y = -59, wait = 3000 } = {}) => [
  face(y), `do summon ${type} 0.5 -60 2.5`, 'wait 1500', 'tap 0.5 0.5', `wait ${wait}`, `shot ui-${id}`, 'changed', 'key BACK', 'wait 1500', `do kill @e[type=${type.replace(/^minecraft:/, '')}]`,
];
// a form for the app's player, built in the addon's own script context (the lab's `js`: needs @minecraft/server-ui).
// Not awaited: show() resolves only when the form is closed, which is the step after the picture
const form = (id, build) => [`do js (() => { const q = world.getAllPlayers()[0]; ${build}.show(q); return 'FORM ${id} shown'; })()`, 'wait 3000', `shot ui-${id}`, 'changed', 'key BACK', 'wait 1500'];

/** {id, what, files: the vanilla files that draw it, steps, needs?: 'server-ui', order?: (late = last)} */
export const SCREENS = [
  { id: 'hud', what: 'HUD（タイトル・アクションバー・サイドバー・チャットの行・効果）', files: ['hud_screen.json', 'scoreboards.json', 'toast_screen.json', 'mob_effect_screen.json'], steps: [
    'do title @a times 0 200 0', 'do title @a title §lLAB title', 'do title @a subtitle LAB subtitle', 'do title @a actionbar LAB actionbar',
    'do scoreboard objectives add lab_ui dummy LAB sidebar', 'do scoreboard objectives setdisplay sidebar lab_ui', 'do scoreboard players set @a lab_ui 7',
    'do say LAB chat line', 'do effect @a speed 60 1 true', 'wait 2500', 'shot ui-hud', 'changed 0.01', 'do title @a clear', 'do scoreboard objectives remove lab_ui', 'do effect @a clear'] },
  { id: 'chat', what: 'チャット', files: ['chat_screen.json', 'chat_settings_menu_screen.json'], steps: ['key T', 'wait 2000', 'text LAB typed in the chat', 'wait 800', 'shot ui-chat', 'changed', 'key BACK', 'wait 1200'] },
  { id: 'inventory', what: 'インベントリ（クリエイティブ）', files: ['inventory_screen.json', 'inventory_screen_pocket.json', 'crafting_screen_pocket.json'], steps: ['key E', 'wait 3000', 'shot ui-inventory', 'changed', 'key BACK', 'wait 1500'] },
  { id: 'inventory-survival', what: 'インベントリ（サバイバル）', files: ['inventory_screen.json', 'inventory_screen_pocket.json'], steps: ['do gamemode survival @a', 'wait 1000', 'key E', 'wait 3000', 'shot ui-inventory-survival', 'changed', 'key BACK', 'wait 1500', 'do gamemode creative @a'] },
  { id: 'pause', what: '一時停止', files: ['pause_screen.json'], steps: ['key BACK', 'wait 2500', 'shot ui-pause', 'changed', 'key BACK', 'wait 1500'] },
  { id: 'settings', what: '設定（一時停止から）', files: ['settings_screen.json', 'settings_common.json'], steps: ['key BACK', 'wait 2500', 'tap text (?i)^settings$', 'wait 4000', 'shot ui-settings', 'changed', 'key BACK', 'wait 2000', 'key BACK', 'wait 1500'] },
  { id: 'form-action', what: 'サーバーのフォーム（ActionFormData）', files: ['server_form.json'], needs: 'server-ui', steps: form('form-action', "new ui.ActionFormData().title('LAB action').body('LAB body: a long line of text to see how the body wraps in this form.').button('LAB one').button('LAB two', 'textures/items/diamond').button('LAB three')") },
  { id: 'form-modal', what: 'サーバーのフォーム（ModalFormData: ドロップダウン・スライダー・テキスト・トグル）', files: ['server_form.json'], needs: 'server-ui', steps: form('form-modal', "const f = new ui.ModalFormData().title('LAB modal').dropdown('LAB dropdown', ['a', 'b', 'c']); try { f.slider('LAB slider', 0, 10, { valueStep: 1, defaultValue: 5 }); } catch { f.slider('LAB slider', 0, 10, 1, 5); } try { f.textField('LAB text', 'placeholder', { defaultValue: 'value' }); } catch { f.textField('LAB text', 'placeholder', 'value'); } f.toggle('LAB toggle'); f") },
  { id: 'form-message', what: 'サーバーのフォーム（MessageFormData）', files: ['server_form.json'], needs: 'server-ui', steps: form('form-message', "new ui.MessageFormData().title('LAB message').body('LAB body').button1('LAB yes').button2('LAB no')") },
  { id: 'chest', what: 'チェスト', files: ['chest_screen.json'], steps: block('chest', 'chest') },
  { id: 'barrel', what: '樽', files: ['chest_screen.json'], steps: block('barrel', 'barrel') },
  { id: 'shulker', what: 'シュルカーボックス', files: ['chest_screen.json'], steps: block('shulker', 'white_shulker_box') },
  { id: 'ender-chest', what: 'エンダーチェスト', files: ['chest_screen.json'], steps: block('ender-chest', 'ender_chest') },
  { id: 'crafting', what: '作業台', files: ['inventory_screen.json', 'inventory_screen_pocket.json', 'crafting_screen_pocket.json'], steps: block('crafting', 'crafting_table') },
  { id: 'furnace', what: 'かまど', files: ['furnace_screen.json', 'furnace_screen_pocket.json'], steps: block('furnace', 'furnace') },
  { id: 'blast-furnace', what: '溶鉱炉', files: ['blast_furnace_screen.json', 'furnace_screen.json', 'furnace_screen_pocket.json'], steps: block('blast-furnace', 'blast_furnace') },
  { id: 'smoker', what: '燻製器', files: ['smoker_screen.json', 'furnace_screen.json', 'furnace_screen_pocket.json'], steps: block('smoker', 'smoker') },
  { id: 'anvil', what: '金床', files: ['anvil_screen.json', 'anvil_screen_pocket.json'], steps: block('anvil', 'anvil') },
  { id: 'enchanting', what: 'エンチャントテーブル', files: ['enchanting_screen.json', 'enchanting_screen_pocket.json'], steps: block('enchanting', 'enchanting_table') },
  { id: 'brewing', what: '醸造台', files: ['brewing_stand_screen.json', 'brewing_stand_screen_pocket.json'], steps: block('brewing', 'brewing_stand') },
  { id: 'beacon', what: 'ビーコン', files: ['beacon_screen.json', 'beacon_screen_pocket.json'], steps: block('beacon', 'beacon') },
  { id: 'grindstone', what: '砥石', files: ['grindstone_screen.json', 'grindstone_screen_pocket.json'], steps: block('grindstone', 'grindstone') },
  { id: 'loom', what: '機織り機', files: ['loom_screen.json', 'loom_screen_pocket.json'], steps: block('loom', 'loom') },
  { id: 'cartography', what: '製図台', files: ['cartography_screen.json', 'cartography_screen_pocket.json'], steps: block('cartography', 'cartography_table') },
  { id: 'stonecutter', what: '石切台', files: ['stonecutter_screen.json', 'stonecutter_screen_pocket.json'], steps: block('stonecutter', 'stonecutter_block') },
  { id: 'smithing', what: '鍛冶台', files: ['smithing_table_screen.json', 'smithing_table_2_screen.json', 'smithing_table_screen_pocket.json', 'smithing_table_2_screen_pocket.json'], steps: block('smithing', 'smithing_table') },
  { id: 'dispenser', what: 'ディスペンサー・ドロッパー', files: ['redstone_screen.json'], steps: block('dispenser', 'dispenser') },
  { id: 'hopper', what: 'ホッパー', files: ['hopper_screen.json', 'redstone_screen.json'], steps: block('hopper', 'hopper') },
  { id: 'crafter', what: 'クラフター', files: ['crafter_screen_pocket.json'], steps: block('crafter', 'crafter') },
  { id: 'command-block', what: 'コマンドブロック', files: ['command_block_screen.json'], steps: block('command-block', 'command_block') },
  { id: 'structure-block', what: 'ストラクチャーブロック', files: ['structure_editor_screen.json'], steps: block('structure-block', 'structure_block') },
  { id: 'jigsaw', what: 'ジグソーブロック', files: ['jigsaw_editor_screen.json'], steps: block('jigsaw', 'jigsaw') },
  { id: 'sign', what: '看板の編集', files: ['sign_screen.json'], steps: block('sign', 'oak_standing_sign', { state: '["ground_sign_direction"=8]' }) },
  // a bed (foot in front, head behind it) at night, used: the screen of lying in bed. No monsters (peaceful), or the game refuses
  { id: 'bed', what: 'ベッドで寝ている画面', files: ['in_bed_screen.json'], steps: [face(), 'do difficulty peaceful', 'do time set night', 'do setblock 0 -60 2 bed ["direction"=0,"head_piece_bit"=false]', 'do setblock 0 -60 3 bed ["direction"=0,"head_piece_bit"=true]',
    'wait 1200', 'tap 0.5 0.5', 'wait 3000', 'shot ui-bed', 'changed', 'key BACK', 'wait 1500', 'do setblock 0 -60 3 air', 'do setblock 0 -60 2 air', 'do time set day'] },
  { id: 'book', what: '本と羽根ペン', files: ['book_screen.json'], steps: ['do replaceitem entity @a slot.weapon.mainhand 0 writable_book', 'do tp @a 0 -60 0 facing 0 -40 40', 'wait 1500', 'tap 0.5 0.5', 'wait 3000', 'shot ui-book', 'changed', 'key BACK', 'wait 1500', 'do replaceitem entity @a slot.weapon.mainhand 0 air'] },
  { id: 'npc', what: 'NPC', files: ['npc_interact_screen.json'], steps: mob('npc', 'npc') },
  { id: 'trade', what: '取引（行商人）', files: ['trade_screen.json', 'trade2_screen.json', 'trade_screen_pocket.json', 'trade2_screen_pocket.json'], steps: mob('trade', 'wandering_trader') },
  { id: 'death', what: '死んだときの画面', files: ['death_screen.json'], order: 1, steps: ['do kill @a', 'wait 3000', 'shot ui-death', 'changed', 'tap text (?i)respawn', 'wait 4000'] },
  { id: 'disconnect', what: '切断されたときの画面', files: ['disconnect_screen.json'], order: 2, steps: ['do kick @a LAB kicked to see the disconnect screen', 'wait 4000', 'shot ui-disconnect', 'changed'] },
];
/** the title screen (before the join; not a section of the world) */
export const START = { id: 'start', what: 'タイトル画面', files: ['start_screen.json', 'play_screen.json'] };

/** an addon's JSON UI files: rp/ui/*.json and what _ui_defs.json lists (pure but for reading), relative to rp/ */
export function addonUiFiles(addonDir) {
  const ui = path.join(addonDir, 'rp', 'ui'), out = new Set();
  if (!fs.existsSync(ui)) return [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.json$/i.test(e.name)) out.add(path.relative(path.join(addonDir, 'rp'), f).split(path.sep).join('/')); } };
  walk(ui);
  try {
    const defs = JSON.parse(fs.readFileSync(path.join(ui, '_ui_defs.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    for (const f of defs.ui_defs ?? []) out.add(String(f));
  } catch { /* none, or not plain JSON */ }
  return [...out].sort();
}
/** which screens show those files (pure): {screens, start: boolean, own: files only the addon has (its own screens or
 *  templates: checked through the content log of every screen), unknown: vanilla-looking files with no screen here} */
export function screensFor(files) {
  const base = files.map((f) => path.posix.basename(f));
  const screens = SCREENS.filter((s) => s.files.some((f) => base.includes(f)));
  const start = START.files.some((f) => base.includes(f));
  const known = new Set([...SCREENS, START].flatMap((s) => s.files)), meta = /^_(ui_defs|global_variables)\.json$/;
  const loose = files.filter((f) => !known.has(path.posix.basename(f)) && !meta.test(path.posix.basename(f)));
  return { screens, start, own: loose.filter((f) => !/_screen(_pocket)?\.json$/.test(f)), unknown: loose.filter((f) => /_screen(_pocket)?\.json$/.test(f)) };
}
/** shard k of n (1-based): the screens dealt round robin, the late ones (death, disconnect) kept last (pure) */
export function shard(screens, k = 1, n = 1) {
  const mine = screens.filter((_, i) => i % n === k - 1);
  return [...mine.filter((s) => !s.order), ...mine.filter((s) => s.order).sort((a, b) => a.order - b.order)];
}
// the other shapes a screen is drawn on (only the real app, on a device, shows these): sizes (aspect ratios: a 4:3 tablet,
// a long phone) and Android's cutouts (notch / punch hole: the game's safe area). Each is a variant: every screen again
/** "1024x768,2400x1080" / "tall,hole" → variants (pure): [{id, steps}] */
export function variants({ sizes = '', cutouts = '' } = {}) {
  const v = [];
  for (const sz of String(sizes).split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!/^\d{3,4}x\d{3,4}$/.test(sz)) throw new Error(`画面の大きさ ${sz} は 幅x高さ で（例 1024x768）`);
    v.push({ id: sz, on: [`size ${sz}`], off: ['size reset'] });
  }
  for (const c of String(cutouts).split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!['corner', 'double', 'hole', 'tall', 'waterfall'].includes(c)) throw new Error(`切り欠き ${c} は corner / double / hole / tall / waterfall のどれか`);
    v.push({ id: `cutout-${c}`, on: [`cutout ${c}`], off: ['cutout none'] });
  }
  return v;
}
/** a screen's steps for a variant (pure): its pictures named after the variant */
const renamed = (steps, id) => steps.map((x) => x.replace(/^shot (ui-[\w.-]+)$/, `shot $1--${id}`));
/** the app.txt for those screens (pure): title screen, join, the world as it is (the baseline `recover` goes back to),
 *  each screen as a section, the content log checked at the end. serverUi: the addon can show forms (`do js` + ui).
 *  vars (variants()): after the screens as they are, every screen again on each other shape */
export function suiteScenario({ screens, start = true, serverUi = true, extra = [], vars = [] }) {
  const L = ['# app ui が作った手順（lib/uicatalog.mjs）。区切り（section）ごとに画面を開いて撮り、閉じる', 'section start', 'launch', 'until title 600000'];
  if (start) L.push('shot ui-start');
  L.push('section join', 'join', 'until joined 300000', 'wait 4000', 'do gamemode creative @a', 'do tp @a 0 -60 0 facing 0 -60 8', 'wait 2500', 'shot world');
  const usable = screens.filter((s) => {
    if (s.needs === 'server-ui' && !serverUi) { L.push(`# ${s.id}: このアドオンは @minecraft/server-ui を使っていないので、フォームはアドオン自身の app.txt で開いてください`); return false; }
    return true;
  });
  // (death and disconnect leave the world: on another shape they come last of all, after its other screens)
  for (const s of usable.filter((x) => !x.order || !vars.length)) L.push(`section ${s.id}`, ...s.steps);
  for (const v of vars) {
    L.push(`section shape--${v.id}`, ...v.on, 'wait 3000', `shot world--${v.id}`);
    for (const s of usable.filter((x) => !x.order)) L.push(`section ${s.id}--${v.id}`, ...renamed(s.steps, v.id));
    L.push(`section shape-off--${v.id}`, ...v.off, 'wait 3000', 'shot world');
  }
  if (vars.length) for (const s of usable.filter((x) => x.order)) L.push(`section ${s.id}`, ...s.steps);
  L.push(...extra);
  return L.join('\n') + '\n';
}
