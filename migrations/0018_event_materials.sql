-- Website courseware only; no changes to existing event or device tables.
CREATE TABLE event_materials (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('html','ppt','pptx')),
  content BLOB NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 20971520),
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX event_materials_event ON event_materials(event_id,created_at,id);
CREATE TABLE event_material_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  material_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL CHECK(action IN ('upload','edit','delete')),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
