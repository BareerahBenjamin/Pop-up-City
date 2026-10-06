-- Planet ownership is global to the existing member account; no new member IDs.
CREATE TABLE member_planets (
  member_id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),
  planet_id TEXT NOT NULL UNIQUE,
  palette_id TEXT NOT NULL CHECK(palette_id IN ('green','pink','blue','apricot')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  snapshot_hash TEXT NOT NULL DEFAULT '',
  onboarded_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER member_planets_immutable_identity BEFORE UPDATE ON member_planets
WHEN NEW.member_id != OLD.member_id OR NEW.planet_id != OLD.planet_id OR NEW.palette_id != OLD.palette_id
BEGIN SELECT RAISE(ABORT, 'planet ownership and palette are permanent'); END;
