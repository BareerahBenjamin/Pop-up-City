-- 封面与活动保存在同一独立数据库；不修改旧迁移或既有活动记录。
CREATE TABLE event_covers (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  image BLOB NOT NULL
);
