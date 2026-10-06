// Every player reads the server in their own game language (Player.langCode): the join greeting, /rules and operator
// announcements (/announce <key>: one broadcast, each player gets their language). /lang <code|auto> overrides it and is
// remembered across restarts. BDS scripts cannot see a player's language.
const TEXT: Record<string, Record<string, string>> = {
  en: { welcome: 'Welcome, {name}!', rules: 'Rules: 1. Be kind 2. No griefing 3. Have fun', restart: 'The server restarts in 5 minutes', event: 'Event starts at spawn now!', lang: 'Language: {lang}' },
  ja: { welcome: 'ようこそ、{name}さん！', rules: 'ルール: 1. やさしく 2. 荒らし禁止 3. 楽しもう', restart: '5分後にサーバーを再起動します', event: 'スポーン地点でイベント開始！', lang: '言語: {lang}' },
  es: { welcome: '¡Bienvenido, {name}!', rules: 'Reglas: 1. Sé amable 2. Nada de grief 3. Diviértete', restart: 'El servidor se reinicia en 5 minutos', event: '¡El evento empieza ahora en el spawn!', lang: 'Idioma: {lang}' },
  zh: { welcome: '欢迎，{name}！', rules: '规则：1. 友善 2. 禁止破坏 3. 玩得开心', restart: '服务器将在5分钟后重启', event: '活动现在在出生点开始！', lang: '语言：{lang}' },
  ko: { welcome: '환영합니다, {name}님!', rules: '규칙: 1. 친절하게 2. 테러 금지 3. 즐기기', restart: '5분 후 서버가 재시작됩니다', event: '스폰에서 이벤트가 시작됩니다!', lang: '언어: {lang}' },
  de: { welcome: 'Willkommen, {name}!', rules: 'Regeln: 1. Sei nett 2. Kein Griefing 3. Viel Spaß', restart: 'Der Server startet in 5 Minuten neu', event: 'Das Event beginnt jetzt am Spawn!', lang: 'Sprache: {lang}' },
  fr: { welcome: 'Bienvenue, {name} !', rules: 'Règles : 1. Soyez gentil 2. Pas de grief 3. Amusez-vous', restart: 'Le serveur redémarre dans 5 minutes', event: "L'événement commence au spawn !", lang: 'Langue : {lang}' },
};
const KEYS = ['restart', 'event'];
const FILE = './plugins/i18n/lang.json';
const chosen: Record<string, string> = JSON.parse(File.readFrom(FILE) ?? '{}');

const langOf = (pl: Player): string => { const c = chosen[pl.realName] ?? pl.langCode.split('_')[0].toLowerCase(); return TEXT[c] ? c : 'en'; };
const t = (pl: Player, key: string, kw: Record<string, string> = {}): string => TEXT[langOf(pl)][key].replace(/\{(\w+)\}/g, (_m, k: string) => kw[k] ?? '');

mc.listen('onJoin', (pl) => { if (!pl.isSimulatedPlayer()) pl.tell(t(pl, 'welcome', { name: pl.realName })); });

const rules = mc.newCommand('rules', 'Server rules in your language', PermType.Any);
rules.overload([]);
rules.setCallback((_c, o, output) => { if (!o.player) return output.error('players only'); output.success(t(o.player, 'rules')); });
rules.setup();

const lang = mc.newCommand('lang', 'Choose the server language for you', PermType.Any);
lang.optional('code', ParamType.String);
lang.overload(['code']);
lang.setCallback((_c, o, output, r: { code?: string }) => {
  const pl = o.player;
  if (!pl) return output.error('players only');
  if (r.code && r.code !== 'auto' && !TEXT[r.code]) return output.error(`languages: auto ${Object.keys(TEXT).join(' ')}`);
  if (r.code) { if (r.code === 'auto') delete chosen[pl.realName]; else chosen[pl.realName] = r.code; File.writeTo(FILE, JSON.stringify(chosen)); }
  output.success(t(pl, 'lang', { lang: `${langOf(pl)} (${pl.langCode})` }));
});
lang.setup();

const ann = mc.newCommand('announce', 'Tell everyone, each in their language', PermType.GameMasters);
ann.mandatory('key', ParamType.String);
ann.overload(['key']);
ann.setCallback((_c, _o, output, r: { key: string }) => {
  if (!KEYS.includes(r.key)) return output.error(`keys: ${KEYS.join(' ')}`);
  const all = mc.getOnlinePlayers().filter((p) => !p.isSimulatedPlayer());
  for (const pl of all) pl.tell(`§e${t(pl, r.key)}`);
  output.success(`announced ${r.key} to ${all.length} players`);
});
ann.setup();
