const GAME_TYPES = ["男双", "女双", "混双", "男单", "女单", "3v3A(2男1女)", "3v3B(2女1男)"];
const GAME_KEYS  = ["MD", "WD", "XD", "MS", "WS", "3v3A", "3v3B"];

// 4队大循环固定 6 场： (1-2)(3-4), (1-3)(2-4), (1-4)(2-3)
function roundRobin4(teamIds) {
  const [a,b,c,d] = teamIds;
  return [
    [a,b],[c,d],
    [a,c],[b,d],
    [a,d],[b,c],
  ];
}

// 积分榜：总积分=赢局数；同分看胜负关系（两队交手赢局差）
function computeStandings(db) {
  const teams = db.prepare("SELECT id,name FROM teams ORDER BY id").all();

  const points = new Map(teams.map(t => [t.id, 0]));
  db.prepare("SELECT winner_team_id FROM games WHERE winner_team_id IS NOT NULL").all()
    .forEach(r => points.set(r.winner_team_id, (points.get(r.winner_team_id) || 0) + 1));

  // head-to-head
  const h2h = new Map();
  const matches = db.prepare("SELECT id, teamA_id, teamB_id FROM matches").all();
  const gamesByMatch = db.prepare("SELECT winner_team_id FROM games WHERE match_id=?").all;

  for (const m of matches) {
    const a = m.teamA_id, b = m.teamB_id;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let aw = 0, bw = 0;
    for (const g of gamesByMatch(m.id)) {
      if (g.winner_team_id === a) aw++;
      if (g.winner_team_id === b) bw++;
    }
    h2h.set(key, { a, b, aw, bw });
  }

  function headToHeadCompare(xId, yId) {
    const key = xId < yId ? `${xId}-${yId}` : `${yId}-${xId}`;
    const r = h2h.get(key);
    if (!r) return 0;
    if (r.a === xId) return r.aw - r.bw;
    return r.bw - r.aw;
  }

  const table = teams.map(t => ({
    id: t.id,
    name: t.name,
    points: points.get(t.id) || 0
  }));

  table.sort((p, q) => {
    if (q.points !== p.points) return q.points - p.points;
    const diff = headToHeadCompare(p.id, q.id);
    if (diff !== 0) return -diff; // diff>0 表示 p更好
    return p.id - q.id;
  });

  return { table, GAME_TYPES, GAME_KEYS };
}

module.exports = { roundRobin4, computeStandings, GAME_TYPES, GAME_KEYS };
