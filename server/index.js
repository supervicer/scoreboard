const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");

const { initDb } = require("./db");
const { roundRobin4, computeStandings, GAME_KEYS } = require("./rules");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());

// DB
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");
const db = initDb(DB_PATH);

// Config (local file)
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.local.json"), "utf8"));

function isAuthed(req) {
  return req.cookies && req.cookies.referee === "1";
}

function teamName(teams, id){
  return (teams.find(t=>t.id===id)||{}).name || ("队伍"+id);
}

const TYPE_MAP = {MD:"男双",WD:"女双",XD:"混双",MS:"男单",WS:"女单","3v3A":"3v3A(2男1女)","3v3B":"3v3B(2女1男)"};

// Static web
app.use(express.static(path.join(__dirname, "..", "web")));

// Pages
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"..","web","public.html")));
app.get("/referee", (req,res)=>res.sendFile(path.join(__dirname,"..","web","referee.html")));

// Auth
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === cfg.referee.username && password === cfg.referee.password) {
    res.cookie("referee", "1", { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, msg: "账号或密码错误" });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("referee");
  res.json({ ok: true });
});

// State
app.get("/api/state", (req, res) => {
  const teams = db.prepare("SELECT id,name FROM teams ORDER BY id").all();
  const matches = db.prepare("SELECT * FROM matches ORDER BY id").all();
  const games = db.prepare("SELECT * FROM games ORDER BY match_id, game_no").all();
  const standings = computeStandings(db);
  res.json({ teams, matches, games, standings });
});

// Init teams
app.post("/api/init-teams", (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false });
  const { names } = req.body || {};
  if (!Array.isArray(names) || names.length !== 4) return res.status(400).json({ ok:false, msg:"需要4个队名" });

  const existing = db.prepare("SELECT id,name FROM teams ORDER BY id").all();
  if (existing.length === 0) {
    const ins = db.prepare("INSERT OR IGNORE INTO teams(name) VALUES (?)");
    names.forEach(n => ins.run(n || ""));
  } else {
    const upd = db.prepare("UPDATE teams SET name=? WHERE id=?");
    existing.slice(0,4).forEach((t,i)=>upd.run(names[i] || t.name, t.id));
  }

  io.emit("refresh");
  res.json({ ok:true });
});

// Generate schedule (round robin)
app.post("/api/generate-schedule", (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false });

  const teams = db.prepare("SELECT id FROM teams ORDER BY id").all().map(x=>x.id);
  if (teams.length !== 4) return res.status(400).json({ ok:false, msg:"请先初始化4支队伍" });

  db.prepare("DELETE FROM games").run();
  db.prepare("DELETE FROM matches").run();

  const pairs = roundRobin4(teams);
  const insM = db.prepare("INSERT INTO matches(teamA_id, teamB_id, status) VALUES (?,?, 'scheduled')");
  const insG = db.prepare("INSERT INTO games(match_id, game_no, game_type) VALUES (?,?,?)");

  for (const [a,b] of pairs) {
    const info = insM.run(a,b);
    const matchId = info.lastInsertRowid;
    for (let i=0;i<7;i++) insG.run(matchId, i+1, GAME_KEYS[i]);
  }

  io.emit("refresh");
  res.json({ ok:true });
});

// Match status
app.post("/api/match/:id/status", (req,res)=>{
  if (!isAuthed(req)) return res.status(401).json({ ok:false });
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!["scheduled","live","finished"].includes(status)) return res.status(400).json({ ok:false });

  const now = Date.now();
  if (status === "live") {
    db.prepare("UPDATE matches SET status='live', started_at=COALESCE(started_at, ?) WHERE id=?").run(now,id);
  } else if (status === "finished") {
    db.prepare("UPDATE matches SET status='finished', finished_at=? WHERE id=?").run(now,id);
  } else {
    db.prepare("UPDATE matches SET status='scheduled' WHERE id=?").run(id);
  }

  io.emit("refresh");
  res.json({ ok:true });
});

// Set winner for one game
app.post("/api/match/:id/game/:no/winner", (req,res)=>{
  if (!isAuthed(req)) return res.status(401).json({ ok:false });
  const matchId = Number(req.params.id);
  const gameNo = Number(req.params.no);
  const { winnerTeamId } = req.body || {};
  if (!winnerTeamId) return res.status(400).json({ ok:false, msg:"winnerTeamId required" });

  db.prepare("UPDATE games SET winner_team_id=? WHERE match_id=? AND game_no=?")
    .run(Number(winnerTeamId), matchId, gameNo);

  io.emit("refresh");
  res.json({ ok:true });
});

// Clear one game winner (undo)
app.post("/api/match/:id/game/:no/clear", (req,res)=>{
  if (!isAuthed(req)) return res.status(401).json({ ok:false });
  const matchId = Number(req.params.id);
  const gameNo = Number(req.params.no);
  db.prepare("UPDATE games SET winner_team_id=NULL WHERE match_id=? AND game_no=?").run(matchId, gameNo);
  io.emit("refresh");
  res.json({ ok:true });
});

// Clear all games in a match
app.post("/api/match/:id/clear-all", (req,res)=>{
  if (!isAuthed(req)) return res.status(401).json({ ok:false });
  const matchId = Number(req.params.id);
  db.prepare("UPDATE games SET winner_team_id=NULL WHERE match_id=?").run(matchId);
  io.emit("refresh");
  res.json({ ok:true });
});

// Export CSV (needs auth) — with UTF-8 BOM for Excel
app.get("/api/export.csv", (req,res)=>{
  if (!isAuthed(req)) return res.status(401).send("Unauthorized");

  const teams = db.prepare("SELECT id,name FROM teams ORDER BY id").all();
  const matches = db.prepare("SELECT * FROM matches ORDER BY id").all();
  const games = db.prepare("SELECT * FROM games ORDER BY match_id, game_no").all();
  const standings = computeStandings(db);

  const rows = [];
  rows.push(["积分榜"]);
  rows.push(["排名","队伍","总积分(赢局数)"]);
  standings.table.forEach((r,i)=>rows.push([String(i+1), r.name, String(r.points)]));

  rows.push([]);
  rows.push(["赛程与比分"]);
  rows.push(["场次ID","状态","队伍A","队伍B","A得分","B得分"]);

  for (const m of matches) {
    const g = games.filter(x=>x.match_id===m.id);
    let aw=0,bw=0;
    for(const x of g){
      if(x.winner_team_id===m.teamA_id) aw++;
      if(x.winner_team_id===m.teamB_id) bw++;
    }
    rows.push([String(m.id), m.status, teamName(teams,m.teamA_id), teamName(teams,m.teamB_id), String(aw), String(bw)]);
  }

  rows.push([]);
  rows.push(["逐局明细"]);
  rows.push(["场次ID","局号","项目","胜方"]);
  for(const x of games){
    const w = x.winner_team_id ? teamName(teams,x.winner_team_id) : "";
    rows.push([String(x.match_id), String(x.game_no), TYPE_MAP[x.game_type]||x.game_type, w]);
  }

  const esc = (s)=> `"${String(s??"").replace(/"/g,'""')}"`;
  const csv = "\uFEFF" + rows.map(r=>r.map(esc).join(",")).join("\n");

  res.setHeader("content-type","text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="羽毛球战报_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// Socket
io.on("connection", (socket)=>{
  socket.emit("hello", { ok:true });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log("Server on :" + PORT));
