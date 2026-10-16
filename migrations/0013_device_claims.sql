CREATE TABLE device_inventory (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  claim_code TEXT UNIQUE CHECK(claim_code IS NULL OR length(claim_code)=4),
  expires_at INTEGER NOT NULL DEFAULT 0,
  request_id TEXT UNIQUE,
  requested_member_id TEXT REFERENCES members(id),
  requested_by TEXT REFERENCES members(id),
  bound_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE device_claim_attempts (
  admin_id TEXT NOT NULL REFERENCES members(id),
  attempted_at INTEGER NOT NULL
);
CREATE INDEX device_claim_attempts_admin ON device_claim_attempts(admin_id,attempted_at);
CREATE TABLE device_claim_audit (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES device_inventory(id),
  member_id TEXT REFERENCES members(id),
  admin_id TEXT REFERENCES members(id),
  action TEXT NOT NULL CHECK(action IN ('requested','rejected','bound','cancelled')),
  created_at INTEGER NOT NULL
);
