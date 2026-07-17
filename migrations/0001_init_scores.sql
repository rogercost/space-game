-- The persistent leaderboard. `time` is survival time in seconds; the board is
-- the top 10 by time (ties broken by who got there first).
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  time REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scores_time ON scores (time DESC);

-- Seed the hall of fame (mirrors the client's in-memory seeds) so a fresh
-- board reads as a real scoreboard rather than an empty list.
INSERT INTO scores (name, time) VALUES
  ('PINPOINT', 240),
  ('NOVA', 185),
  ('ORION', 140),
  ('VESPER', 95),
  ('ROOKIE', 45);
