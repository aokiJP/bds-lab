// A real SQL database (SQLite through DBSession): blocks broken and joins per player, /stats and /top.
// BDS scripts have only small dynamic properties: no queries, no sorting, no file other programs can read.
File.mkdir('./plugins/sqlstats');
const db = new DBSession('sqlite3', { path: './plugins/sqlstats/stats.db' });
db.exec('CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, blocks INT DEFAULT 0, joins INT DEFAULT 0)');
function bump(name: string, col: 'blocks' | 'joins'): void {
  const st = db.prepare(`INSERT INTO stats (name, ${col}) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET ${col} = ${col} + 1`);
  st.bind(name);
  st.execute();
}
mc.listen('onJoin', (pl) => { if (!pl.isSimulatedPlayer()) bump(pl.realName, 'joins'); });
mc.listen('onDestroyBlock', (pl) => { bump(pl.realName, 'blocks'); });
const stats = mc.newCommand('stats', 'A player\'s statistics', PermType.Any);
stats.optional('name', ParamType.String);
stats.overload(['name']);
stats.setCallback((_c, origin, output, r: { name?: string }) => {
  const name = r.name ?? origin.name;
  const rows = db.query(`SELECT blocks, joins FROM stats WHERE name = '${name.replace(/'/g, "''")}'`);
  output.success(rows.length > 1 ? `${name}: blocks ${rows[1][0]} joins ${rows[1][1]}` : `${name}: no data`);
});
stats.setup();
const top = mc.newCommand('top', 'Leaderboard of blocks broken', PermType.Any);
top.overload([]);
top.setCallback((_c, _o, output) => {
  const rows = db.query('SELECT name, blocks FROM stats ORDER BY blocks DESC, name LIMIT 5').slice(1);
  output.success('top blocks: ' + (rows.map((r, i) => `${i + 1}. ${r[0]} ${r[1]}`).join(' | ') || 'empty'));
});
top.setup();
