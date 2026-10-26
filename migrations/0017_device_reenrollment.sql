-- A new logical identity keeps historical device receipts owned by their original member.
CREATE TABLE device_reenrollment (
 old_device_id TEXT PRIMARY KEY REFERENCES devices(id),
 new_device_id TEXT NOT NULL UNIQUE REFERENCES device_inventory(id),
 created_at INTEGER NOT NULL,
 acknowledged_at INTEGER
);
