import { randomUUID } from 'node:crypto';

function reject(status, message) { const error = new Error(message); error.status = status; throw error; }

// Re-read both users under the write lock; a stale session cannot authorize a change.
export function changeMemberRole(db, actorId, memberId, role) {
  if (!['member', 'admin'].includes(role)) reject(400, '只能设置为成员或管理员');
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    const actor = db.raw.prepare('SELECT * FROM members WHERE id=?').get(actorId);
    if (!actor?.is_super_admin || actor.role !== 'admin' || actor.status === 'disabled') reject(403, '仅超级管理员可设置管理员');
    const member = db.raw.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    if (!member) reject(404, '成员不存在');
    if (member.is_super_admin || member.id === actorId) reject(409, '不能修改超级管理员身份');
    if (member.status === 'disabled' && role === 'admin') reject(409, '请先启用该成员再设置管理员');
    if (member.role !== role) {
      const stamp = Math.floor(Date.now() / 1000);
      db.raw.prepare('UPDATE members SET role=?,updated_at=? WHERE id=?').run(role, stamp, memberId);
      db.raw.prepare('INSERT INTO member_role_audit VALUES(?,?,?,?,?,?)').run(randomUUID(), memberId, actorId, member.role, role, stamp);
    }
    const result = db.raw.prepare('SELECT * FROM members WHERE id=?').get(memberId);
    db.raw.exec('COMMIT');
    return result;
  } catch (error) { db.raw.exec('ROLLBACK'); throw error; }
}
