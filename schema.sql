-- Run this once against your local Postgres database:
--   psql -U yourusername -d your_db_name -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT ,  -- removed NOT NULL for google auth wala BT
  google_id     VARCHAR(200),   -- added dis for gmail se login wala peeps k liye .. they'll have this instead of pwd
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per user: their current in-progress game, so they can close
-- the tab and resume later. Overwritten on every save (no history).
CREATE TABLE IF NOT EXISTS game_saves (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grid_state     JSONB NOT NULL,
  building_queue JSONB NOT NULL,
  score          INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per completed/ended game, kept permanently, for the leaderboard.
CREATE TABLE IF NOT EXISTS high_scores (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_high_scores_score ON high_scores (score DESC);

-- One row per user, accumulated across every game they've ever finished.
-- Updated whenever a game ends (see POST /api/game/score).
CREATE TABLE IF NOT EXISTS player_stats (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played          INTEGER NOT NULL DEFAULT 0,
  total_score           BIGINT  NOT NULL DEFAULT 0, -- sum of every finished game's score
  best_score            INTEGER NOT NULL DEFAULT 0,
  highest_tier_reached  INTEGER NOT NULL DEFAULT 0,  -- highest building tier ever reached, any game
  total_merges          INTEGER NOT NULL DEFAULT 0,  -- lifetime count of merge events
  total_buildings_placed INTEGER NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

