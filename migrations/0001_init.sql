CREATE TABLE IF NOT EXISTS game_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 0),
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_end INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS game_limits_expiry ON game_limits (window_end);
