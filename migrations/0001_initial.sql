CREATE TABLE members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  bio TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  avatar_json TEXT NOT NULL DEFAULT '{}',
  card_public INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  code_hash TEXT NOT NULL,
  link_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_challenges_member ON login_challenges(member_id,created_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_member ON sessions(member_id);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 150),
  volunteer_capacity INTEGER NOT NULL DEFAULT 0 CHECK(volunteer_capacity BETWEEN 0 AND 30),
  host_id TEXT NOT NULL REFERENCES members(id),
  official INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  venue_pin_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX events_status_time ON events(status,starts_at);
CREATE TABLE event_registrations (
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('attendee','volunteer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,member_id,kind)
);
CREATE TABLE event_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 150),
  host_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE task_claims (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id,member_id)
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE checkins (
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  checked_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY(event_id,member_id),
  UNIQUE(device_id,request_id)
);
CREATE TABLE social_codes (
  code_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  from_member_id TEXT NOT NULL REFERENCES members(id),
  to_member_id TEXT NOT NULL REFERENCES members(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  connected_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  UNIQUE(device_id,request_id)
);
CREATE TABLE device_failed_codes (
  device_id TEXT NOT NULL REFERENCES devices(id),
  attempted_at INTEGER NOT NULL
);
CREATE INDEX device_failed_codes_recent ON device_failed_codes(device_id,attempted_at);
