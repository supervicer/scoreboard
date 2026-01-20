PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teamA_id INTEGER NOT NULL,
  teamB_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|live|finished
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY(teamA_id) REFERENCES teams(id),
  FOREIGN KEY(teamB_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  game_no INTEGER NOT NULL,                -- 1..7
  game_type TEXT NOT NULL,                 -- MD WD XD MS WS 3v3A 3v3B
  winner_team_id INTEGER,                  -- nullable until decided
  UNIQUE(match_id, game_no),
  FOREIGN KEY(match_id) REFERENCES matches(id),
  FOREIGN KEY(winner_team_id) REFERENCES teams(id)
);
