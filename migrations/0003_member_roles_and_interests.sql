-- Preserve the existing admin role; the first enabled administrator owns delegation.
ALTER TABLE members ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0
  CHECK (is_super_admin IN (0,1) AND (is_super_admin=0 OR role='admin'));
UPDATE members SET is_super_admin=1 WHERE id=(
  SELECT id FROM members WHERE role='admin' AND status!='disabled' ORDER BY created_at,id LIMIT 1
);
CREATE TABLE member_role_audit (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  previous_role TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE event_interests (
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,member_id)
);
CREATE INDEX event_interests_member ON event_interests(member_id,event_id);
