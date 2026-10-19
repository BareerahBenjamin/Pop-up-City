-- Keep event facts and growth history intact; remove deleted events from discovery.
CREATE TABLE event_deletions (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
  deleted_by TEXT NOT NULL REFERENCES members(id),
  deleted_at INTEGER NOT NULL
);
CREATE TRIGGER event_deletions_no_update BEFORE UPDATE ON event_deletions
BEGIN SELECT RAISE(ABORT,'event deletion is immutable'); END;
CREATE TRIGGER event_deletions_no_delete BEFORE DELETE ON event_deletions
BEGIN SELECT RAISE(ABORT,'event deletion is immutable'); END;
