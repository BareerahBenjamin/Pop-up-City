-- Versioned asset entitlement ledger; PHVM metric rewards remain governed by 0004.
CREATE TABLE planet_growth_release (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  rule_version TEXT NOT NULL, model_version TEXT NOT NULL,
  rule_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
  configured_by TEXT NOT NULL REFERENCES members(id), activated_at INTEGER NOT NULL
);
CREATE TRIGGER planet_release_no_update BEFORE UPDATE ON planet_growth_release
BEGIN SELECT RAISE(ABORT,'published planet rules are immutable'); END;
CREATE TRIGGER planet_release_no_delete BEFORE DELETE ON planet_growth_release
BEGIN SELECT RAISE(ABORT,'published planet rules are immutable'); END;
CREATE TABLE planet_growth_events (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  milestone TEXT CHECK(milestone IN ('opening','host')),
  halloween INTEGER NOT NULL DEFAULT 0 CHECK(halloween IN (0,1)),
  configured_by TEXT NOT NULL REFERENCES members(id), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX planet_opening_once ON planet_growth_events(milestone) WHERE milestone='opening';
CREATE TRIGGER planet_growth_events_no_update BEFORE UPDATE ON planet_growth_events
BEGIN SELECT RAISE(ABORT,'planet event mappings are immutable'); END;
CREATE TRIGGER planet_growth_events_no_delete BEFORE DELETE ON planet_growth_events
BEGIN SELECT RAISE(ABORT,'planet event mappings are immutable'); END;
CREATE TRIGGER planet_catalog_mapping_guard BEFORE UPDATE ON planet_activity_catalog_map
WHEN EXISTS(SELECT 1 FROM planet_growth_release) AND NEW.activity_id IS NOT OLD.activity_id
BEGIN SELECT RAISE(ABORT,'published catalog mapping is immutable'); END;
CREATE TRIGGER planet_catalog_mapping_no_delete BEFORE DELETE ON planet_activity_catalog_map
WHEN EXISTS(SELECT 1 FROM planet_growth_release)
BEGIN SELECT RAISE(ABORT,'published catalog mapping is immutable'); END;
CREATE TABLE planet_role_reviews (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('volunteer','host')),
  event_id TEXT REFERENCES events(id),
  evidence_note TEXT NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 1000),
  reviewed_by TEXT NOT NULL REFERENCES members(id) CHECK(reviewed_by!=member_id),
  reviewed_at INTEGER NOT NULL,
  CHECK((kind='volunteer' AND event_id IS NULL) OR (kind='host' AND event_id IS NOT NULL))
);
CREATE UNIQUE INDEX planet_volunteer_once ON planet_role_reviews(member_id) WHERE kind='volunteer';
CREATE UNIQUE INDEX planet_host_once ON planet_role_reviews(member_id,event_id) WHERE kind='host';
CREATE TRIGGER planet_role_reviews_authority BEFORE INSERT ON planet_role_reviews
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.reviewed_by AND status='active' AND role='admin') THEN RAISE(ABORT,'active administrator required') END;
 SELECT CASE WHEN NEW.kind='host' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id AND status='published' AND ends_at<=NEW.reviewed_at) THEN RAISE(ABORT,'completed host event required') END;
END;
CREATE TRIGGER planet_role_reviews_no_update BEFORE UPDATE ON planet_role_reviews
BEGIN SELECT RAISE(ABORT,'planet role reviews are immutable'); END;
CREATE TRIGGER planet_role_reviews_no_delete BEFORE DELETE ON planet_role_reviews
BEGIN SELECT RAISE(ABORT,'planet role reviews are immutable'); END;
CREATE TABLE planet_fact_corrections (
  id INTEGER PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('checkin','role')),event_id TEXT REFERENCES events(id),review_id TEXT REFERENCES planet_role_reviews(id),
  valid INTEGER NOT NULL CHECK(valid IN (0,1)), reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  corrected_by TEXT NOT NULL REFERENCES members(id),corrected_at INTEGER NOT NULL,
  CHECK((kind='checkin' AND event_id IS NOT NULL AND review_id IS NULL) OR (kind='role' AND event_id IS NULL AND review_id IS NOT NULL))
);
CREATE INDEX planet_corrections_latest ON planet_fact_corrections(member_id,kind,event_id,review_id,id);
CREATE TRIGGER planet_corrections_authority BEFORE INSERT ON planet_fact_corrections
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.corrected_by AND role='admin' AND status='active') THEN RAISE(ABORT,'active administrator required') END;
 SELECT CASE WHEN NEW.kind='checkin' AND NOT EXISTS(SELECT 1 FROM checkins WHERE event_id=NEW.event_id AND member_id=NEW.member_id) THEN RAISE(ABORT,'checkin fact required') END;
 SELECT CASE WHEN NEW.kind='role' AND NOT EXISTS(SELECT 1 FROM planet_role_reviews WHERE id=NEW.review_id AND member_id=NEW.member_id) THEN RAISE(ABORT,'role fact required') END;
END;
CREATE TRIGGER planet_corrections_no_update BEFORE UPDATE ON planet_fact_corrections
BEGIN SELECT RAISE(ABORT,'planet corrections are immutable'); END;
CREATE TRIGGER planet_corrections_no_delete BEFORE DELETE ON planet_fact_corrections
BEGIN SELECT RAISE(ABORT,'planet corrections are immutable'); END;
CREATE TABLE planet_asset_grants (
  id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES member_planets(member_id),
  rule_version TEXT NOT NULL, model_version TEXT NOT NULL,
  reward_key TEXT NOT NULL,label TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  unit_ids_json TEXT NOT NULL CHECK(json_valid(unit_ids_json)),
  content_hash TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX planet_grants_owner ON planet_asset_grants(member_id,reward_key);
CREATE TABLE planet_asset_reversals (
  grant_id TEXT PRIMARY KEY REFERENCES planet_asset_grants(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TRIGGER planet_grants_no_update BEFORE UPDATE ON planet_asset_grants
BEGIN SELECT RAISE(ABORT,'planet grants are immutable'); END;
CREATE TRIGGER planet_grants_no_delete BEFORE DELETE ON planet_asset_grants
BEGIN SELECT RAISE(ABORT,'planet grants are immutable'); END;
CREATE TRIGGER planet_reversals_no_update BEFORE UPDATE ON planet_asset_reversals
BEGIN SELECT RAISE(ABORT,'planet reversals are immutable'); END;
CREATE TRIGGER planet_reversals_no_delete BEFORE DELETE ON planet_asset_reversals
BEGIN SELECT RAISE(ABORT,'planet reversals are immutable'); END;
