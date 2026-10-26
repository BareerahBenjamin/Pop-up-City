-- Website presentation metadata only; device/event tables are unchanged.
CREATE TABLE website_event_pins (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  pinned_by TEXT NOT NULL REFERENCES members(id),
  pinned_at INTEGER NOT NULL
);
