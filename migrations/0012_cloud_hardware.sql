-- Ephemeral state contains confirmation proofs, never raw device tokens.
CREATE TABLE hardware_cloud_sessions (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE hardware_cloud_settings (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  station_device_id TEXT REFERENCES devices(id)
);
-- Explicit authorization for a user's board to act as its owner's event station.
CREATE TABLE hardware_host_grants (
  device_id TEXT NOT NULL REFERENCES devices(id),
  activity_id TEXT NOT NULL REFERENCES events(id),
  authorized_by TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY(device_id, activity_id)
);
CREATE TABLE hardware_host_receipts (
  interaction_id TEXT PRIMARY KEY,
  host_device_id TEXT NOT NULL REFERENCES devices(id),
  user_device_id TEXT NOT NULL REFERENCES devices(id),
  activity_id TEXT NOT NULL REFERENCES events(id),
  payload_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  created_at INTEGER NOT NULL
);
