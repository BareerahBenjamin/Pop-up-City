ALTER TABLE members ADD COLUMN profile_completed_at INTEGER;
-- Previously saved avatar configurations remain the final configuration.
UPDATE members SET profile_completed_at=updated_at
WHERE json_valid(avatar_json) AND json_type(avatar_json,'$.selection')='object'
  AND json_type(avatar_json,'$.release')='text';
CREATE TRIGGER member_profile_final BEFORE UPDATE ON members
WHEN OLD.profile_completed_at IS NOT NULL AND (
  NEW.profile_completed_at IS NOT OLD.profile_completed_at OR
  NEW.nickname IS NOT OLD.nickname OR NEW.bio IS NOT OLD.bio OR
  NEW.skills IS NOT OLD.skills OR NEW.needs IS NOT OLD.needs OR
  NEW.avatar_json IS NOT OLD.avatar_json OR NEW.card_public IS NOT OLD.card_public)
BEGIN SELECT RAISE(ABORT, 'profile and avatar have been finalized'); END;
