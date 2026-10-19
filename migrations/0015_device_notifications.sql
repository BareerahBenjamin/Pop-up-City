CREATE TABLE device_feedback_sessions (
 device_id TEXT PRIMARY KEY REFERENCES devices(id),
 session_id TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE device_notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 device_id TEXT NOT NULL REFERENCES devices(id),
 session_id TEXT NOT NULL,
 interaction_id TEXT NOT NULL UNIQUE,
 activity_id TEXT NOT NULL REFERENCES events(id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 acked_at INTEGER
);
CREATE INDEX device_notifications_delivery ON device_notifications(device_id,session_id,id);
-- Retired session IDs cannot be replayed to replace a newer connection.
CREATE TABLE device_feedback_session_ids (
 session_id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL REFERENCES devices(id)
);
