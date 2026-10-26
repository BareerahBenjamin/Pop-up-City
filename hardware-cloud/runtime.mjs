import {visualForReceipt} from './avatar-visual.mjs';
import { createHash } from 'node:crypto';
import { sign } from './checkin-session.mjs';
import { HardwareError, hardwareKind } from '../hardware.js';
import { planetSnapshotInTransaction } from '../planet.js';
import { personalNameBitmap,activityTitleBitmap,NAME_BITMAP_STYLE,NAME_FONT_SHA256 } from './name-bitmap.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (status, code, message) => { throw new HardwareError(status, code, message); };
const wrap = (board, data) => {
  const payload = JSON.stringify({ ...data, recipient_device_id: board.id });
  return new Response(JSON.stringify({ payload, signature: sign(board.token_hash, payload) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
function transaction(db, fn) {
  db.raw.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.raw.exec('COMMIT'); return result; }
  catch (error) { db.raw.exec('ROLLBACK'); throw error; }
}
function currentBoard(db, reporter) {
  const board = db.raw.prepare(`SELECT d.*,m.nickname FROM devices d JOIN members m ON m.id=d.member_id
    WHERE d.id=? AND d.token_hash=? AND d.revoked_at IS NULL AND m.status!='disabled'`).get(reporter.id, reporter.token_hash);
  if (!board) fail(401, 'INVALID_DEVICE', '设备身份无效或已撤销');
  if (hardwareKind(db, board.id) !== 'user') fail(403, 'STATION_PERSONAL_API_FORBIDDEN', '此接口仅供成员绑定板子使用');
  return board;
}
function describeActivity(db, event, time) {
  const roster = db.raw.prepare(`SELECT r.member_id,r.kind,r.created_at,c.checked_at FROM event_registrations r
    LEFT JOIN checkins c ON c.event_id=r.event_id AND c.member_id=r.member_id
    WHERE r.event_id=? ORDER BY r.member_id,r.kind`).all(event.id);
  const registered = new Set(roster.map(r => r.member_id));
  const signed = new Set(roster.filter(r => r.checked_at != null).map(r => r.member_id));
  const activity = { id: event.id, title: event.title, starts_at: event.starts_at, ends_at: event.ends_at,
    status: event.status, phase: event.status !== 'published' ? event.status : time < event.starts_at ? 'upcoming' : time < event.ends_at ? 'active' : 'ended',
    updated_at: event.updated_at, registration_count: registered.size, checked_count: signed.size,
    roster_version: hash(roster) };
  return { ...activity, version: hash(activity) };
}
/** Atomic, authenticated facts for startup/reconnect. Does not select a firmware UI page. */
export function runtimeState(db, reporter, { knownActivityId = null, compact = false, time = Math.floor(Date.now() / 1000) } = {}) {
  if (knownActivityId != null && !uuid(knownActivityId)) fail(400, 'INVALID_ACTIVITY_ID', '活动编号不合法');
  return transaction(db, () => {
    const board = currentBoard(db, reporter);
    // Reuse existing ownership and settlement; no frame encoding or full roster download on each poll.
    const snapshot = planetSnapshotInTransaction(db, board.member_id);
    const activeRows = db.raw.prepare(`SELECT * FROM events WHERE host_id=? AND status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)
      AND starts_at<=? AND ends_at>? ORDER BY starts_at,id`).all(board.member_id, time, time);
    const upcomingRows = db.raw.prepare(`SELECT * FROM events WHERE host_id=? AND status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)
      AND starts_at>? AND starts_at<=? ORDER BY starts_at,id LIMIT 17`).all(board.member_id, time, time + 7 * 86400);
    const active = (compact ? activeRows.slice(0, 2) : activeRows).map(e => describeActivity(db, e, time));
    const upcoming = upcomingRows.slice(0, compact ? 1 : 16).map(e => describeActivity(db, e, time));
    const registrations = db.raw.prepare(`SELECT e.id,e.title,e.starts_at,e.ends_at,e.status,r.kind,c.checked_at
      FROM event_registrations r JOIN events e ON e.id=r.event_id
      LEFT JOIN checkins c ON c.event_id=e.id AND c.member_id=r.member_id
      WHERE r.member_id=? AND e.status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) AND e.ends_at>? AND e.starts_at<=?
      ORDER BY e.starts_at,e.id,r.kind LIMIT 33`).all(board.member_id, time, time + 7 * 86400);
    let known = null;
    if (knownActivityId) {
      const event = db.raw.prepare(`SELECT e.* FROM events e WHERE e.id=? AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) AND
        (e.host_id=? OR EXISTS(SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.member_id=?))`).get(knownActivityId, board.member_id, board.member_id);
      // Null covers both missing and unauthorized IDs: no disclosure of others' activities.
      if (event) {
        const hosting = event.host_id === board.member_id;
        if (hosting) known = { ...describeActivity(db, event, time), role: 'host' };
        else {
          const rows = db.raw.prepare('SELECT kind FROM event_registrations WHERE event_id=? AND member_id=? ORDER BY kind').all(event.id, board.member_id);
          const checked = db.raw.prepare('SELECT checked_at FROM checkins WHERE event_id=? AND member_id=?').get(event.id, board.member_id);
          known = { id: event.id, title: event.title, starts_at: event.starts_at, ends_at: event.ends_at, status: event.status,
            phase: event.status !== 'published' ? event.status : time < event.starts_at ? 'upcoming' : time < event.ends_at ? 'active' : 'ended',
            updated_at: event.updated_at, role: 'participant', registration_kinds: rows.map(r => r.kind), checked_at: checked?.checked_at ?? null };
          known.version = hash(known);
        }
      }
    }
    const identity = { device_id: board.id, member_id: board.member_id, member_name: board.nickname,
      binding_version: hash([board.id, board.member_id, board.created_at]), name_version: hash([board.nickname,NAME_BITMAP_STYLE,NAME_FONT_SHA256]), device_kind: 'user' };
    const planet = { planet_id: snapshot.planetId, palette_id: snapshot.paletteId, revision: snapshot.revision,
      state_version: snapshot.pixelPlanet.stateVersion, ai_stage: snapshot.pixelPlanet.aiStage,
      house_unlocked: snapshot.pixelPlanet.aiStage >= 1, lake_unlocked: snapshot.pixelPlanet.lakeUnlocked };
    const host = { active_activities: active, upcoming_activities: upcoming, upcoming_truncated: upcomingRows.length > (compact ? 1 : 16),
      active_truncated: compact && activeRows.length > 2, schedule_conflict: activeRows.length > 1, can_check_in: active.length === 1, active_activity_id: active.length === 1 ? active[0].id : null };
    const memberEvents = { items: registrations.slice(0, compact ? 4 : 32), truncated: registrations.length > (compact ? 4 : 32) };
    const facts = { identity, planet, host, registrations: memberEvents, known_activity: known };
    return { protocol_version: 1, server_time: time, poll_after_ms: 5000, facts_version: hash(facts), ...facts,
      recovery: { reconcile_pending_before_new_submit: true, historical_checkins_trigger_feedback: false,
        feedback_session_url: '/api/device/feedback/session', feedback_poll_url: '/api/device/feedback', feedback_ack_url: '/api/device/feedback/ack',
        operation_lookup_url: '/api/device/operations/{interaction_id}', batch_lookup_url: '/api/device/host/batches/{batch_id}' } };
  });
}
/** A missing durable receipt is UNKNOWN, not proof of failure or permission to resubmit. */
export function operationResult(db, reporter, interactionId) {
  if (!uuid(interactionId)) fail(400, 'INVALID_INTERACTION_ID', '操作编号不合法');
  return transaction(db, () => {
    const board = currentBoard(db, reporter);
    const host = db.raw.prepare('SELECT * FROM hardware_host_receipts WHERE interaction_id=? AND (host_device_id=? OR user_device_id=?)').get(interactionId, board.id, board.id);
    const interaction = host ? null : db.raw.prepare('SELECT * FROM hardware_interactions WHERE interaction_id=? AND (device_a_id=? OR device_b_id=?)').get(interactionId, board.id, board.id);
    const row = host || interaction;
    if (!row) return { interaction_id: interactionId, state: 'unknown', may_retry_as_new: false, feedback: 'none' };
    const receipt=JSON.parse(row.receipt_json);
    return { interaction_id: interactionId, state: receipt.status==='cancelled'?'cancelled':'saved', operation_type: host ? 'host_checkin' : interaction.interaction_type,
      activity_id: row.activity_id ?? null, receipt, ...(visualForReceipt(receipt,board.id)?{visual:visualForReceipt(receipt,board.id)}:{}), may_retry_as_new: false, feedback: 'none' };
  });
}
export async function runtimeRoute(request, env, url, reporter) {
  const match = /^\/api\/device\/operations\/([^/]+)$/.exec(url.pathname);
  if (url.pathname !== '/api/device/runtime' && !match) return null;
  if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '此接口仅支持查询');
  const data = match ? operationResult(env.DB, reporter, match[1]) : runtimeState(env.DB, reporter, { knownActivityId: url.searchParams.get('known_activity_id'), compact: url.searchParams.get('view') === 'board' });
  if (!match) { const bitmap=await personalNameBitmap(data.identity.member_name); data.identity.name_bitmap=bitmap.hex; data.identity.name_bitmap_style=NAME_BITMAP_STYLE; data.identity.name_bitmap_width=bitmap.width; if(data.host.can_check_in)data.host.active_title_bitmap=await activityTitleBitmap(data.host.active_activities[0].title); }
  return wrap(reporter, data);
}
