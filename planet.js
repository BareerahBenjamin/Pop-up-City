import { randomInt, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { settlePlanetGrowth } from './planet-growth.js';

const palettes = ['green', 'pink', 'blue', 'apricot'];
const template = readFileSync(new URL('./vendor/planet/frontend/ui-design/Herstory-星域-H5.html', import.meta.url), 'utf8');
const iso = seconds => new Date(seconds * 1000).toISOString();

// No awaited work inside this transaction: the identity, facts and revision are coherent.
export function planetSnapshot(db, memberId) {
  const sql = db.raw;
  sql.exec('BEGIN IMMEDIATE');
  try {
    const result = planetSnapshotInTransaction(db, memberId);
    sql.exec('COMMIT');
    return result;
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
}

export function planetSnapshotInTransaction(db, memberId) {
  const sql = db.raw;
    const member = sql.prepare("SELECT id,nickname FROM members WHERE id=? AND status!='disabled'").get(memberId);
    if (!member) throw new Error('Planet owner unavailable');
    let identity = sql.prepare('SELECT * FROM member_planets WHERE member_id=?').get(memberId);
    if (!identity) {
      sql.prepare('INSERT INTO member_planets(member_id,planet_id,palette_id,created_at) VALUES(?,?,?,?)')
        .run(memberId, randomUUID(), palettes[randomInt(palettes.length)], Math.floor(Date.now() / 1000));
      identity = sql.prepare('SELECT * FROM member_planets WHERE member_id=?').get(memberId);
    }
    // Existing authenticated social-code exchanges are the only current relation source.
    // No attendance-based friendship inference, no emails, no repeat-exchange time reset.
    const connections = sql.prepare(`SELECT m.id,m.nickname name,MIN(c.connected_at) established
      FROM (SELECT from_member_id,to_member_id,connected_at FROM connections
        UNION ALL SELECT member_a_id,member_b_id,established_at FROM friendships) c JOIN members m ON m.id=CASE WHEN c.from_member_id=? THEN c.to_member_id ELSE c.from_member_id END
      WHERE (c.from_member_id=? OR c.to_member_id=?) AND m.id!=? AND m.status!='disabled'
      GROUP BY m.id,m.nickname ORDER BY established,m.id`).all(memberId, memberId, memberId, memberId)
      .map(({ id, name, established }) => ({ id, name, exchanged: true, established_at: iso(established) }));
    const population = sql.prepare("SELECT COUNT(*) n FROM members WHERE status!='disabled'").get().n;
    const records = sql.prepare(`SELECT COUNT(*) n,MAX(c.checked_at) latest FROM checkins c
      JOIN events e ON e.id=c.event_id WHERE c.member_id=? AND e.status='published'`).get(memberId);
    const growth = settlePlanetGrowth(db, memberId);
    const data = {
      userId: memberId, planetId: identity.planet_id, paletteId: identity.palette_id,
      activated: true, // Identity assigned; not a grant of opening-event assets.
      day: 0, // Keep the upstream date-driven growth demo OFF until real entitlements exist.
      residentCount: Math.max(1, Number(population)), connections, growth,
      integration: { growthStatus: growth.status, checkinCount: growth.checkinCount,
        latestCheckinAt: records.latest == null ? null : iso(records.latest),
        relationshipSource: 'verified-social-code-and-hardware', displayName: member.nickname }
    };
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const revision = identity.revision + Number(hash !== identity.snapshot_hash);
    if (!Number.isSafeInteger(revision)) throw new Error('Planet revision overflow');
    if (revision !== identity.revision) sql.prepare('UPDATE member_planets SET revision=?,snapshot_hash=? WHERE member_id=?').run(revision, hash, memberId);
    return { ...data, revision };
}

export function completePlanetOnboarding(db, memberId) {
  planetSnapshot(db, memberId);
  db.raw.prepare('UPDATE member_planets SET onboarded_at=COALESCE(onboarded_at,?) WHERE member_id=?')
    .run(Math.floor(Date.now() / 1000), memberId);
}

export function loginDestination(db, memberId) {
  if (db.raw.prepare('SELECT profile_completed_at FROM members WHERE id=?').get(memberId)?.profile_completed_at != null) return '/#me';
  const seen = db.raw.prepare('SELECT onboarded_at FROM member_planets WHERE member_id=?').get(memberId);
  return seen?.onboarded_at ? '/#setup' : '/#planet/welcome';
}

export function planetDocument(snapshot, view) {
  // Only server-derived identity enters bootstrap; escape HTML/script delimiters.
  const safe = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const bootstrap = `<script>window.HERSTORY_INITIAL_STATE=${safe(snapshot)};window.HERSTORY_CONFIG=${safe({ endpoint: '/api/herstory/planet-state', userId: snapshot.userId, initialTab: view === 'field' ? 'field' : 'mine', pollIntervalMs: 15000, reportSchedule: {} })};window.HERSTORY_PHOTO_CONFIG=${safe({checkedIn:null,planetName:snapshot.integration.displayName+'的星球',day:0})};</script>`;
  return template.replace('<!-- HOST_BOOTSTRAP -->', bootstrap);
}
