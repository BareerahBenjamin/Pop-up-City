-- Additive growth storage only. No historical rewards or production rules are seeded.
-- events.id is the activity/session identifier; sessions remains the login-session table.
CREATE TABLE programs (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE activity_types (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 50),
  world_area TEXT NOT NULL CHECK(length(trim(world_area)) BETWEEN 1 AND 50),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE growth_rules (
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL CHECK(typeof(rule_version)='integer' AND rule_version>0),
  type_id TEXT NOT NULL REFERENCES activity_types(id),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('activity','long_term_project','opening','closing')),
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json) AND json_type(definition_json)='object'),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(rule_id,rule_version),
  UNIQUE(rule_id,rule_version,type_id,event_kind)
);
CREATE TRIGGER growth_rules_no_update BEFORE UPDATE ON growth_rules
BEGIN SELECT RAISE(ABORT,'growth rule versions are immutable'); END;
CREATE TRIGGER growth_rules_no_delete BEFORE DELETE ON growth_rules
BEGIN SELECT RAISE(ABORT,'growth rule versions are immutable'); END;
CREATE TABLE event_growth_config (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  type_id TEXT NOT NULL REFERENCES activity_types(id),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('activity','long_term_project','opening','closing')),
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  configured_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(rule_id,rule_version,type_id,event_kind) REFERENCES growth_rules(rule_id,rule_version,type_id,event_kind),
  UNIQUE(event_id,program_id,rule_id,rule_version)
);
CREATE INDEX event_growth_program ON event_growth_config(program_id,type_id,event_kind);
CREATE TABLE host_completions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),
  member_id TEXT NOT NULL REFERENCES members(id),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),
  verified_by TEXT REFERENCES members(id),
  verified_at INTEGER,
  review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)
    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),
  UNIQUE(event_id,member_id),
  UNIQUE(id,event_id,member_id)
);
CREATE INDEX host_completions_review ON host_completions(status,event_id);
CREATE TRIGGER host_completions_identity BEFORE UPDATE ON host_completions
WHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id

OR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))
OR (OLD.status='revoked' AND NEW.status!='revoked')
BEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;
CREATE TRIGGER host_completions_review_insert BEFORE INSERT ON host_completions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id)
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TRIGGER host_completions_review_update BEFORE UPDATE ON host_completions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id)
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TABLE volunteer_completions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),
  member_id TEXT NOT NULL REFERENCES members(id),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),
  verified_by TEXT REFERENCES members(id),
  verified_at INTEGER,
  review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)
    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),
  UNIQUE(event_id,member_id),
  UNIQUE(id,event_id,member_id)
);
CREATE INDEX volunteer_completions_review ON volunteer_completions(status,event_id);
CREATE TRIGGER volunteer_completions_identity BEFORE UPDATE ON volunteer_completions
WHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id

OR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))
OR (OLD.status='revoked' AND NEW.status!='revoked')
BEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;
CREATE TRIGGER volunteer_completions_review_insert BEFORE INSERT ON volunteer_completions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_registrations WHERE event_id=NEW.event_id AND member_id=NEW.member_id AND kind='volunteer')
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TRIGGER volunteer_completions_review_update BEFORE UPDATE ON volunteer_completions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_registrations WHERE event_id=NEW.event_id AND member_id=NEW.member_id AND kind='volunteer')
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TABLE project_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),
  member_id TEXT NOT NULL REFERENCES members(id),
  contribution_key TEXT NOT NULL CHECK(length(trim(contribution_key)) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),
  verified_by TEXT REFERENCES members(id),
  verified_at INTEGER,
  review_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)
    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),
  UNIQUE(event_id,member_id,contribution_key),
  UNIQUE(id,event_id,member_id)
);
CREATE INDEX project_submissions_review ON project_submissions(status,event_id);
CREATE TRIGGER project_submissions_identity BEFORE UPDATE ON project_submissions
WHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id
OR NEW.contribution_key!=OLD.contribution_key
OR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))
OR (OLD.status='revoked' AND NEW.status!='revoked')
BEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;
CREATE TRIGGER project_submissions_review_insert BEFORE INSERT ON project_submissions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_growth_config WHERE event_id=NEW.event_id AND event_kind='long_term_project')
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TRIGGER project_submissions_review_update BEFORE UPDATE ON project_submissions
WHEN NEW.status!='pending'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'review requires an active administrator') END;
  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_growth_config WHERE event_id=NEW.event_id AND event_kind='long_term_project')
    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;
END;
CREATE TABLE asset_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK(length(trim(asset_kind))>0),
  slot_key TEXT NOT NULL CHECK(length(trim(slot_key))>0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json)='object'),
  created_at INTEGER NOT NULL
);
CREATE TABLE reward_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  event_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('checkin','host','volunteer','project')),
  checkin_event_id TEXT,
  host_completion_id TEXT,
  volunteer_completion_id TEXT,
  project_submission_id TEXT,
  metric TEXT CHECK(metric IN ('P','H','V','M')),
  asset_id TEXT REFERENCES asset_definitions(id),
  asset_level INTEGER,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount!=0),
  reversal_of TEXT UNIQUE REFERENCES reward_ledger(id),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) BETWEEN 1 AND 200),
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  calculation_json TEXT NOT NULL CHECK(json_valid(calculation_json) AND json_type(calculation_json)='object'),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(event_id,program_id,rule_id,rule_version) REFERENCES event_growth_config(event_id,program_id,rule_id,rule_version),
  FOREIGN KEY(checkin_event_id,member_id) REFERENCES checkins(event_id,member_id),
  FOREIGN KEY(host_completion_id,event_id,member_id) REFERENCES host_completions(id,event_id,member_id),
  FOREIGN KEY(volunteer_completion_id,event_id,member_id) REFERENCES volunteer_completions(id,event_id,member_id),
  FOREIGN KEY(project_submission_id,event_id,member_id) REFERENCES project_submissions(id,event_id,member_id),
  CHECK((source_kind='checkin' AND checkin_event_id IS NOT NULL AND checkin_event_id=event_id AND host_completion_id IS NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NULL)
    OR (source_kind='host' AND checkin_event_id IS NULL AND host_completion_id IS NOT NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NULL)
    OR (source_kind='volunteer' AND checkin_event_id IS NULL AND host_completion_id IS NULL AND volunteer_completion_id IS NOT NULL AND project_submission_id IS NULL)
    OR (source_kind='project' AND checkin_event_id IS NULL AND host_completion_id IS NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NOT NULL)),
  CHECK((metric IS NOT NULL AND asset_id IS NULL AND asset_level IS NULL)
    OR (metric IS NULL AND asset_id IS NOT NULL AND typeof(asset_level)='integer' AND asset_level>0 AND abs(amount)=1)),
  CHECK((reversal_of IS NULL AND amount>0) OR (reversal_of IS NOT NULL AND amount<0)),
  CHECK(NOT(source_kind='checkin' AND metric='P') OR abs(amount)=1),
  UNIQUE(id,member_id,program_id,asset_id,asset_level)
);
-- Business-level deduplication does not include rule_version: a rule upgrade must not award twice.
CREATE UNIQUE INDEX reward_metric_once ON reward_ledger(event_id,member_id,source_kind,coalesce(project_submission_id,''),metric) WHERE reversal_of IS NULL AND metric IS NOT NULL;
CREATE UNIQUE INDEX reward_asset_once ON reward_ledger(event_id,member_id,source_kind,coalesce(project_submission_id,''),asset_id,asset_level) WHERE reversal_of IS NULL AND asset_id IS NOT NULL;
CREATE INDEX reward_member_program ON reward_ledger(member_id,program_id,created_at);
CREATE TRIGGER reward_ledger_no_update BEFORE UPDATE ON reward_ledger
BEGIN SELECT RAISE(ABORT,'reward ledger is append only'); END;
CREATE TRIGGER reward_ledger_no_delete BEFORE DELETE ON reward_ledger
BEGIN SELECT RAISE(ABORT,'reward ledger is append only'); END;
CREATE TRIGGER reward_ledger_validate BEFORE INSERT ON reward_ledger
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.created_by AND role='admin' AND status='active')
    THEN RAISE(ABORT,'settlement requires an active administrator') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND status='active')
    THEN RAISE(ABORT,'recipient must be active') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND status='published')
    THEN RAISE(ABORT,'event must be published') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='checkin' AND NOT EXISTS(
    SELECT 1 FROM checkins c JOIN events e ON e.id=c.event_id WHERE c.event_id=NEW.event_id AND c.member_id=NEW.member_id AND c.checked_at>=e.starts_at-3600 AND c.checked_at<e.starts_at)
    THEN RAISE(ABORT,'checkin is outside the valid window') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='host' AND NOT EXISTS(SELECT 1 FROM host_completions WHERE id=NEW.host_completion_id AND status='verified')
    THEN RAISE(ABORT,'host completion is not verified') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='volunteer' AND NOT EXISTS(SELECT 1 FROM volunteer_completions WHERE id=NEW.volunteer_completion_id AND status='verified')
    THEN RAISE(ABORT,'volunteer completion is not verified') END;
  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='project' AND NOT EXISTS(SELECT 1 FROM project_submissions WHERE id=NEW.project_submission_id AND status='verified')
    THEN RAISE(ABORT,'project contribution is not verified') END;
  SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM reward_ledger r WHERE r.id=NEW.reversal_of AND r.reversal_of IS NULL
      AND r.member_id=NEW.member_id AND r.event_id=NEW.event_id AND r.program_id=NEW.program_id
      AND r.rule_id=NEW.rule_id AND r.rule_version=NEW.rule_version AND r.source_kind=NEW.source_kind
      AND r.checkin_event_id IS NEW.checkin_event_id AND r.host_completion_id IS NEW.host_completion_id
      AND r.volunteer_completion_id IS NEW.volunteer_completion_id AND r.project_submission_id IS NEW.project_submission_id
      AND r.metric IS NEW.metric AND r.asset_id IS NEW.asset_id AND r.asset_level IS NEW.asset_level AND r.amount=-NEW.amount)
    THEN RAISE(ABORT,'reversal must exactly negate its original reward') END;
END;
CREATE TABLE user_assets (
  member_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_level INTEGER NOT NULL,
  source_ledger_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(member_id,program_id,asset_id),
  FOREIGN KEY(source_ledger_id,member_id,program_id,asset_id,asset_level) REFERENCES reward_ledger(id,member_id,program_id,asset_id,asset_level)
);
CREATE TRIGGER user_assets_insert_guard BEFORE INSERT ON user_assets
WHEN NOT EXISTS(SELECT 1 FROM reward_ledger r WHERE r.id=NEW.source_ledger_id AND r.reversal_of IS NULL AND r.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))
BEGIN SELECT RAISE(ABORT,'asset must reference an unreversed grant'); END;
CREATE TRIGGER user_assets_update_guard BEFORE UPDATE ON user_assets
WHEN NOT EXISTS(SELECT 1 FROM reward_ledger r WHERE r.id=NEW.source_ledger_id AND r.reversal_of IS NULL AND r.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))
BEGIN SELECT RAISE(ABORT,'asset must reference an unreversed grant'); END;
-- Projection changes are in the same SQLite statement/transaction as the grant or reversal.
CREATE TRIGGER reward_asset_project AFTER INSERT ON reward_ledger WHEN NEW.asset_id IS NOT NULL
BEGIN
  DELETE FROM user_assets WHERE member_id=NEW.member_id AND program_id=NEW.program_id AND asset_id=NEW.asset_id;
  INSERT INTO user_assets(member_id,program_id,asset_id,asset_level,source_ledger_id,updated_at)
    SELECT r.member_id,r.program_id,r.asset_id,r.asset_level,r.id,NEW.created_at FROM reward_ledger r
    WHERE r.member_id=NEW.member_id AND r.program_id=NEW.program_id AND r.asset_id=NEW.asset_id AND r.reversal_of IS NULL
      AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id)
    ORDER BY r.asset_level DESC,r.created_at,r.id LIMIT 1;
END;
CREATE VIEW member_growth_totals AS
  SELECT member_id,program_id,metric,SUM(amount) total FROM reward_ledger WHERE metric IS NOT NULL GROUP BY member_id,program_id,metric;
CREATE TRIGGER host_completions_revoke_guard BEFORE UPDATE OF status ON host_completions
WHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(
  SELECT 1 FROM reward_ledger r WHERE r.host_completion_id=OLD.id AND r.reversal_of IS NULL
    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))
BEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;
CREATE TRIGGER volunteer_completions_revoke_guard BEFORE UPDATE OF status ON volunteer_completions
WHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(
  SELECT 1 FROM reward_ledger r WHERE r.volunteer_completion_id=OLD.id AND r.reversal_of IS NULL
    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))
BEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;
CREATE TRIGGER project_submissions_revoke_guard BEFORE UPDATE OF status ON project_submissions
WHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(
  SELECT 1 FROM reward_ledger r WHERE r.project_submission_id=OLD.id AND r.reversal_of IS NULL
    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))
BEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;

CREATE TRIGGER host_completions_no_verified_delete BEFORE DELETE ON host_completions
WHEN OLD.status IN ('verified','revoked')
BEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;

CREATE TRIGGER volunteer_completions_no_verified_delete BEFORE DELETE ON volunteer_completions
WHEN OLD.status IN ('verified','revoked')
BEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;

CREATE TRIGGER project_submissions_no_verified_delete BEFORE DELETE ON project_submissions
WHEN OLD.status IN ('verified','revoked')
BEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;
