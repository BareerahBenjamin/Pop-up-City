-- Preserve confirmed avatars and timestamps; release only ordinary profile fields.
DROP TRIGGER member_profile_final;
CREATE TRIGGER member_avatar_final BEFORE UPDATE ON members
WHEN OLD.profile_completed_at IS NOT NULL AND (
  NEW.profile_completed_at IS NOT OLD.profile_completed_at OR
  NEW.avatar_json IS NOT OLD.avatar_json)
BEGIN SELECT RAISE(ABORT, 'avatar has been finalized'); END;
