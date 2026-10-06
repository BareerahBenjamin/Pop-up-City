CREATE TABLE device_hardware_profiles (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  device_kind TEXT NOT NULL CHECK(device_kind IN ('user','checkin')),
  rgb565_byte_order TEXT CHECK(rgb565_byte_order IN ('little','big')),
  configured_by TEXT NOT NULL REFERENCES members(id),
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER device_kind_permanent BEFORE UPDATE ON device_hardware_profiles
WHEN NEW.device_kind IS NOT OLD.device_kind
BEGIN SELECT RAISE(ABORT,'device kind is permanent'); END;
CREATE TRIGGER device_binding_permanent BEFORE UPDATE ON devices
WHEN NEW.id IS NOT OLD.id OR NEW.member_id IS NOT OLD.member_id OR NEW.token_hash IS NOT OLD.token_hash
BEGIN SELECT RAISE(ABORT,'device binding is permanent; revoke and enroll a replacement'); END;
CREATE TABLE checkin_station_activities (
  station_device_id TEXT NOT NULL REFERENCES device_hardware_profiles(device_id),
  activity_id TEXT NOT NULL REFERENCES events(id),
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL CHECK(closes_at>opens_at),
  authorized_by TEXT NOT NULL REFERENCES members(id),
  revoked_at INTEGER,
  PRIMARY KEY(station_device_id,activity_id)
);
CREATE TABLE hardware_interactions (
  interaction_id TEXT PRIMARY KEY,
  interaction_type TEXT NOT NULL CHECK(interaction_type IN ('checkin','friend')),
  reporter_device_id TEXT NOT NULL REFERENCES devices(id),
  device_a_id TEXT NOT NULL REFERENCES devices(id),
  device_b_id TEXT NOT NULL REFERENCES devices(id),
  activity_id TEXT REFERENCES events(id),
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
);
CREATE TRIGGER hardware_interactions_no_update BEFORE UPDATE ON hardware_interactions
BEGIN SELECT RAISE(ABORT,'hardware receipts are immutable'); END;
CREATE TABLE hardware_checkin_sources (
  activity_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE REFERENCES hardware_interactions(interaction_id) DEFERRABLE INITIALLY DEFERRED,
  station_device_id TEXT NOT NULL REFERENCES devices(id),
  PRIMARY KEY(activity_id,member_id),
  FOREIGN KEY(activity_id,member_id) REFERENCES checkins(event_id,member_id)
);
CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  member_a_id TEXT NOT NULL REFERENCES members(id),
  member_b_id TEXT NOT NULL REFERENCES members(id),
  established_at INTEGER NOT NULL,
  source_interaction_id TEXT NOT NULL REFERENCES hardware_interactions(interaction_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(member_a_id<member_b_id),
  UNIQUE(member_a_id,member_b_id)
);
CREATE INDEX friendships_other ON friendships(member_b_id,member_a_id);
-- Explicit upstream catalog ID -> website UUID mapping, never guessed from title/date.
CREATE TABLE planet_activity_catalog_map (
  catalog_activity_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES events(id),
  configured_by TEXT NOT NULL REFERENCES members(id),
  updated_at INTEGER NOT NULL
);
CREATE TABLE planet_settlement_tasks (
  activity_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_rules' CHECK(status IN ('pending_rules','settled','failed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(activity_id,member_id),
  FOREIGN KEY(activity_id,member_id) REFERENCES checkins(event_id,member_id)
);
CREATE TABLE hardware_pixel_states (
  member_id TEXT PRIMARY KEY REFERENCES member_planets(member_id),
  state_version INTEGER NOT NULL CHECK(state_version>0),
  source_hash TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE hardware_planet_frames (
  member_id TEXT NOT NULL REFERENCES member_planets(member_id),
  frame_version INTEGER NOT NULL CHECK(frame_version>0),
  planet_revision INTEGER NOT NULL,
  state_version INTEGER NOT NULL,
  width INTEGER NOT NULL CHECK(width=240),
  height INTEGER NOT NULL CHECK(height=320),
  format TEXT NOT NULL CHECK(format='RGB565'),
  byte_order TEXT NOT NULL CHECK(byte_order IN ('little','big')),
  render_version TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK(byte_length=153600),
  frame BLOB NOT NULL CHECK(length(frame)=153600),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(member_id,frame_version)
);
CREATE TRIGGER hardware_frames_no_update BEFORE UPDATE ON hardware_planet_frames
BEGIN SELECT RAISE(ABORT,'planet frames are immutable'); END;
CREATE TABLE device_planet_displays (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  member_id TEXT NOT NULL,
  frame_version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  displayed_at INTEGER NOT NULL,
  FOREIGN KEY(member_id,frame_version) REFERENCES hardware_planet_frames(member_id,frame_version)
);
