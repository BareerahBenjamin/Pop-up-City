-- Durable logical batches and server-generated registration snapshots.
-- Existing members, bindings, registrations and checkins are preserved.
CREATE TABLE hardware_host_batches (
  id TEXT PRIMARY KEY,
  host_device_id TEXT NOT NULL REFERENCES devices(id),
  activity_id TEXT NOT NULL REFERENCES events(id),
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','completed','partial','failed','stopped')),
  total INTEGER NOT NULL CHECK(total>=0),
  group_size INTEGER NOT NULL CHECK(group_size BETWEEN 1 AND 16),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt>=1),
  stop_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX hardware_one_live_batch_per_activity ON hardware_host_batches(activity_id)
  WHERE state IN ('queued','running');
CREATE INDEX hardware_batches_pending ON hardware_host_batches(state,updated_at,id);
CREATE TABLE hardware_host_batch_items (
  batch_id TEXT NOT NULL REFERENCES hardware_host_batches(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  device_id TEXT REFERENCES devices(id),
  position INTEGER NOT NULL CHECK(position>=0),
  group_index INTEGER NOT NULL CHECK(group_index>=0),
  interaction_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','checked_in','already_signed','failed')),
  error_code TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(batch_id,member_id),
  UNIQUE(batch_id,position)
);
CREATE INDEX hardware_batch_items_pending ON hardware_host_batch_items(batch_id,state,position);
-- Retrying the same signed retry request must not retry newly failed items again.
CREATE TABLE hardware_host_batch_retries (
  request_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES hardware_host_batches(id),
  payload_hash TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
