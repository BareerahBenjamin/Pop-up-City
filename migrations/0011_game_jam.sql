CREATE TABLE game_jam_apps (
  app_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE game_jam_projects (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES game_jam_apps(app_id),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('互动游戏','随身工具','城市社交','实验作品')),
  manifest_json TEXT NOT NULL,
  firmware_name TEXT NOT NULL,
  firmware_bytes INTEGER NOT NULL CHECK(firmware_bytes > 0 AND firmware_bytes < 6881280),
  firmware_sha256 TEXT NOT NULL CHECK(length(firmware_sha256)=64),
  firmware BLOB NOT NULL,
  cover BLOB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(app_id,version),
  CHECK(length(firmware)=firmware_bytes)
);
CREATE INDEX game_jam_project_status ON game_jam_projects(status,created_at);
CREATE TABLE game_jam_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES game_jam_projects(id),
  reviewer_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK(status IN ('published','rejected')),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
