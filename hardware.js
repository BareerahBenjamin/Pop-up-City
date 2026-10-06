import { validPlanetCheckins, configurePlanetEvent } from './planet-growth.js';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { planetSnapshotInTransaction } from './planet.js';

const require = createRequire(import.meta.url);
const { derivePixelProgress } = require('./vendor/planet/backend/pixel-planet/service.cjs');
const rules = require('./vendor/planet/backend/pixel-planet/rules.json');
const renderer = require('./vendor/planet/frontend/ui-design/pixel-planet-renderer.js');
const catalog = JSON.parse(readFileSync(new URL('./vendor/planet/backend/activity-config/activity-config.json', import.meta.url))).activities;
const now = () => Math.floor(Date.now() / 1000);
const hash = value => createHash('sha256').update(value).digest('hex');
export class HardwareError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HardwareError(status, code, message); };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
const id = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) fail(400, 'INVALID_ID', '需要小写 UUID');
  return value;
};
function transaction(db, fn) {
  db.raw.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.raw.exec('COMMIT'); return result; }
  catch (error) { db.raw.exec('ROLLBACK'); throw error; }
}
export function hardwareKind(db, deviceId) {
  return db.raw.prepare('SELECT device_kind FROM device_hardware_profiles WHERE device_id=?').get(deviceId)?.device_kind || 'user';
}
function device(db, deviceId, kind) {
  const d = db.raw.prepare(`SELECT d.* FROM devices d JOIN members m ON m.id=d.member_id
    WHERE d.id=? AND d.revoked_at IS NULL AND m.status!='disabled'`).get(id(deviceId));
  if (!d || hardwareKind(db, d.id) !== kind) fail(403, 'DEVICE_NOT_ALLOWED', '设备不存在、已停用或类型不符');
  return d;
}
function common(data) {
  id(data.interaction_id);
  if (!Number.isSafeInteger(data.occurred_at) || data.occurred_at < 1 || data.occurred_at > now() + 300) fail(400, 'INVALID_TIME', '设备时间无效');
  if (typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce) || typeof data.confirmation_code !== 'string' || !/^\d{4}$/.test(data.confirmation_code)) fail(400, 'INVALID_CONFIRMATION', '需要随机 nonce 与四位确认码');
}
// The board derives this key from its bearer token locally. It never sends the key over BLE.
function proof(d, message, signature) {
  const expected = createHmac('sha256', Buffer.from(d.token_hash, 'hex')).update(message).digest();
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail(403, 'INVALID_PROOF', '确认凭据验证失败');
}
function replay(db, data, payload) {
  const old = db.raw.prepare('SELECT payload_hash,receipt_json FROM hardware_interactions WHERE interaction_id=?').get(data.interaction_id);
  if (!old) return null;
  if (old.payload_hash !== hash(payload)) fail(409, 'EVENT_ID_CONFLICT', '同一交互 ID 不能对应不同内容');
  return JSON.parse(old.receipt_json);
}
function saveInteraction(db, data, type, reporter, a, b, activity, payload, receipt) {
  db.raw.prepare('INSERT INTO hardware_interactions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(data.interaction_id, type, reporter.id, a.id, b.id, activity, data.occurred_at, now(), hash(payload), JSON.stringify(receipt));
}
function checkin(db, reporter, data) {
  common(data);
  if (reporter.id !== id(data.station_device_id)) fail(403, 'WRONG_REPORTER', '只能由本次签到板提交');
  const station = device(db, data.station_device_id, 'checkin'), board = device(db, data.user_device_id, 'user');
  id(data.activity_id);
  if (data.user_confirmed !== true) fail(400, 'NOT_CONFIRMED', '用户尚未确认');
  const payload = JSON.stringify(['herstory-hardware-v1', 'checkin', data.interaction_id, station.id, board.id, data.activity_id, data.nonce, data.confirmation_code, data.occurred_at, true]);
  proof(board, payload, data.user_proof);
  return transaction(db, () => {
    const previous = replay(db, data, payload); if (previous) return previous;
    const stamp = now(), e = db.raw.prepare('SELECT * FROM events WHERE id=?').get(data.activity_id);
    const permission = db.raw.prepare('SELECT * FROM checkin_station_activities WHERE station_device_id=? AND activity_id=? AND revoked_at IS NULL').get(station.id, data.activity_id);
    if (!permission || stamp < permission.opens_at || stamp >= permission.closes_at) fail(403, 'STATION_NOT_AUTHORIZED', '签到板未获得该活动的当前授权');
    if (!e || e.status !== 'published' || stamp < e.starts_at - 3600 || stamp >= e.starts_at) fail(409, 'CHECKIN_CLOSED', '活动当前不可签到');
    // Online station submission: an old BLE confirmation cannot be reused as a new check-in.
    if (Math.abs(stamp - data.occurred_at) > 300) fail(409, 'CONFIRMATION_EXPIRED', '签到确认已过期，请重新碰一碰');
    if (!db.raw.prepare("SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=? AND kind='attendee'").get(e.id, board.member_id)) fail(403, 'NOT_REGISTERED', '尚未报名此活动');
    const inserted = db.raw.prepare('INSERT OR IGNORE INTO checkins VALUES(?,?,?,?,?)').run(e.id, board.member_id, board.id, stamp, 'hw:' + data.interaction_id).changes === 1;
    const record = db.raw.prepare('SELECT checked_at FROM checkins WHERE event_id=? AND member_id=?').get(e.id, board.member_id);
    if (inserted) {
      db.raw.prepare('INSERT INTO hardware_checkin_sources VALUES(?,?,?,?)').run(e.id, board.member_id, data.interaction_id, station.id);
      db.raw.prepare('INSERT OR IGNORE INTO planet_settlement_tasks(activity_id,member_id,created_at) VALUES(?,?,?)').run(e.id, board.member_id, stamp);
    }
    const snapshot = planetSnapshotInTransaction(db, board.member_id);
    const receipt = { receipt_id: randomUUID(), interaction_id: data.interaction_id, status: 'checked_in', user_id: board.member_id,
      activity_id: e.id, checked_at: record.checked_at, duplicate: !inserted, planet_revision: snapshot.revision, growth_status: db.raw.prepare('SELECT status FROM planet_settlement_tasks WHERE activity_id=? AND member_id=?').get(e.id,board.member_id)?.status || 'pending_rules' };
    // User board verifies the relay receipt independently of the station, then displays success.
    receipt.user_receipt_proof = createHmac('sha256', Buffer.from(board.token_hash, 'hex')).update(JSON.stringify([
      'herstory-receipt-v1', receipt.receipt_id, receipt.interaction_id, receipt.status, receipt.user_id,
      receipt.activity_id, receipt.checked_at, receipt.duplicate, receipt.planet_revision, receipt.growth_status
    ])).digest('hex');
    saveInteraction(db, data, 'checkin', reporter, board, station, e.id, payload, receipt);
    return receipt;
  });
}
function friend(db, reporter, data) {
  common(data);
  const a = device(db, data.device_a_id, 'user'), b = device(db, data.device_b_id, 'user');
  if (a.id >= b.id || a.member_id === b.member_id) fail(400, 'INVALID_PAIR', '设备 ID 必须排序且属于不同用户');
  if (![a.id, b.id].includes(reporter.id)) fail(403, 'WRONG_REPORTER', '只能由参与交友的用户板上传');
  if (data.a_confirmed !== true || data.b_confirmed !== true) fail(400, 'NOT_CONFIRMED', '需要双方确认');
  if (data.occurred_at < Math.max(a.created_at, b.created_at) - 300) fail(400, 'INVALID_TIME', '交友时间早于设备绑定');
  const payload = JSON.stringify(['herstory-hardware-v1', 'friend', data.interaction_id, a.id, b.id, data.nonce, data.confirmation_code, data.occurred_at, true, true]);
  proof(a, payload, data.a_proof); proof(b, payload, data.b_proof);
  return transaction(db, () => {
    const previous = replay(db, data, payload); if (previous) return previous;
    const [ma, mb] = [a.member_id, b.member_id].sort();
    let relationship = db.raw.prepare('SELECT * FROM friendships WHERE member_a_id=? AND member_b_id=?').get(ma, mb);
    const duplicate = Boolean(relationship);
    if (!relationship) {
      relationship = { id: randomUUID(), established_at: now() };
      db.raw.prepare('INSERT INTO friendships VALUES(?,?,?,?,?)').run(relationship.id, ma, mb, relationship.established_at, data.interaction_id);
    }
    const revisions = [ma, mb].map(member => ({ user_id: member, revision: planetSnapshotInTransaction(db, member).revision }));
    const receipt = { receipt_id: randomUUID(), interaction_id: data.interaction_id, status: 'connected', friendship_id: relationship.id,
      established_at: relationship.established_at, duplicate, planets: revisions };
    saveInteraction(db, data, 'friend', reporter, a, b, null, payload, receipt);
    return receipt;
  });
}

function pixelState(db, memberId, paletteId, connections) {
  const mappings = db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all();
  const activities = mappings.map(m => ({ ...catalog.find(a => a.activity_id === m.catalog_activity_id), canonical_session_id: m.activity_id,
    enabled: db.raw.prepare('SELECT status FROM events WHERE id=?').get(m.activity_id).status === 'published' }));
  const facts = validPlanetCheckins(db,memberId)
    .flatMap(f => mappings.filter(m => m.activity_id === f.event_id).map(m => ({ user_id: memberId, campaign_id: rules.campaignId,
      activity_id: m.catalog_activity_id, canonical_session_id: f.event_id, revision: 1, status: 'valid',
      checked_in_at: new Date(f.checked_at * 1000).toISOString(), updated_at: new Date(f.checked_at * 1000).toISOString() })));
  const { issues, ...progress } = derivePixelProgress({ userId: memberId, campaignId: rules.campaignId, activities, checkins: facts });
  const state = { paletteId, ...progress, friendIds: connections.map(f => f.id).sort() };
  const sourceHash = hash(JSON.stringify(state)), old = db.raw.prepare('SELECT * FROM hardware_pixel_states WHERE member_id=?').get(memberId);
  const stateVersion = (old?.state_version || 0) + Number(sourceHash !== old?.source_hash);
  if (!Number.isSafeInteger(stateVersion)) throw new Error('Pixel version overflow');
  const result = { ...state, stateVersion };
  if (sourceHash !== old?.source_hash) db.raw.prepare(`INSERT INTO hardware_pixel_states VALUES(?,?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET state_version=excluded.state_version,source_hash=excluded.source_hash,state_json=excluded.state_json,updated_at=excluded.updated_at`)
    .run(memberId, stateVersion, sourceHash, JSON.stringify(result), now());
  return result;
}
function frameMetadata(db, reporter) {
  const byteOrder = db.raw.prepare('SELECT rgb565_byte_order FROM device_hardware_profiles WHERE device_id=?').get(reporter.id)?.rgb565_byte_order;
  if (!byteOrder) fail(409, 'BYTE_ORDER_REQUIRED', '请先配置该硬件画面的 RGB565 字节序');
  return transaction(db, () => {
    const snapshot = planetSnapshotInTransaction(db, reporter.member_id), state = pixelState(db, reporter.member_id, snapshot.paletteId, snapshot.connections);
    let f = db.raw.prepare(`SELECT frame_version,sha256,planet_revision,state_version,byte_order,render_version
      FROM hardware_planet_frames WHERE member_id=? ORDER BY frame_version DESC LIMIT 1`).get(reporter.member_id);
    if (f && (f.planet_revision !== snapshot.revision || f.state_version !== state.stateVersion ||
      f.byte_order !== byteOrder || f.render_version !== renderer.RENDER_VERSION)) f = null;
    if (!f) {
      const encoded = renderer.encodeRGB565(state, { width: 240, height: 320, byteOrder }), bytes = Buffer.from(encoded.bytes);
      const version = db.raw.prepare('SELECT COALESCE(MAX(frame_version),0)+1 n FROM hardware_planet_frames WHERE member_id=?').get(reporter.member_id).n;
      if (!Number.isSafeInteger(version)) throw new Error('Frame version overflow');
      f = { frame_version: version, sha256: hash(bytes) };
      db.raw.prepare('INSERT INTO hardware_planet_frames VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(reporter.member_id, version, snapshot.revision, state.stateVersion, 240, 320, 'RGB565', byteOrder, renderer.RENDER_VERSION, f.sha256, 153600, bytes, now());
    }
    return { version: f.frame_version, planet_revision: snapshot.revision, state_version: state.stateVersion, width: 240, height: 320,
      format: 'RGB565', byte_order: byteOrder, sha256: f.sha256, byte_length: 153600, chunk_size: 4096,
      frame_url: '/api/device/planet/frames/' + f.frame_version, render_version: renderer.RENDER_VERSION };
  });
}
function frameChunk(db, reporter, version, url) {
  const offset = Number(url.searchParams.get('offset') || 0), length = Number(url.searchParams.get('length') || 4096);
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset >= 153600 || offset % 2 ||
    !Number.isSafeInteger(length) || length < 2 || length > 16384 || length % 2) fail(416, 'INVALID_RANGE', '像素分块需要偶数偏移和 2–16384 字节长度');
  const f = db.raw.prepare(`SELECT sha256,byte_order,substr(frame,?,?) chunk FROM hardware_planet_frames WHERE member_id=? AND frame_version=?`)
    .get(offset + 1, Math.min(length, 153600 - offset), reporter.member_id, version);
  if (!f) fail(404, 'FRAME_NOT_FOUND', '该用户的指定版本画面不存在，请查询版本');
  return new Response(f.chunk, { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
    'Content-Range': `bytes ${offset}-${offset + f.chunk.length - 1}/153600`, 'Content-Length': String(f.chunk.length),
    'X-Frame-SHA256': f.sha256, 'X-Frame-Version': String(version), 'X-RGB565-Byte-Order': f.byte_order } });
}
export async function hardwareRoute(request, env, url, reporter, readBody) {
  const p = url.pathname, db = env.DB;
  if (request.method === 'POST' && p === '/api/device/checkin-events') return json(checkin(db, reporter, await readBody(request)));
  if (hardwareKind(db, reporter.id) !== 'user') fail(403, 'STATION_PERSONAL_API_FORBIDDEN', '签到板不能调用用户接口或上传交友关系');
  if (request.method === 'POST' && p === '/api/device/friend-events') return json(friend(db, reporter, await readBody(request)));
  if (request.method === 'GET' && p === '/api/device/planet/version') return json(frameMetadata(db, reporter));
  const frame = /^\/api\/device\/planet\/frames\/(\d+)$/.exec(p);
  if (request.method === 'GET' && frame) return frameChunk(db, reporter, Number(frame[1]), url);
  if (request.method === 'POST' && p === '/api/device/planet/displayed') {
    const data = await readBody(request);
    return json(transaction(db, () => {
      const f = db.raw.prepare('SELECT sha256 FROM hardware_planet_frames WHERE member_id=? AND frame_version=?').get(reporter.member_id, Number.isSafeInteger(data.version) ? data.version : -1);
      if (!f || f.sha256 !== data.sha256) fail(409, 'HASH_MISMATCH', '画面版本或校验值不一致');
      const old = db.raw.prepare('SELECT frame_version FROM device_planet_displays WHERE device_id=?').get(reporter.id);
      if (old && old.frame_version > data.version) fail(409, 'STALE_DISPLAY', '不能回退已显示版本');
      db.raw.prepare(`INSERT INTO device_planet_displays VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
        frame_version=excluded.frame_version,sha256=excluded.sha256,displayed_at=excluded.displayed_at`).run(reporter.id, reporter.member_id, data.version, data.sha256, now());
      return { status: 'displayed', version: data.version };
    }));
  }
  return null;
}

export async function hardwareAdminRoute(request, env, url, admin, readBody) {
  const db = env.DB, p = url.pathname;
  if (request.method === 'GET' && p === '/api/admin/planet/activity-mappings') return json({ catalog: catalog.map(a => ({ id: a.activity_id, title: a.title, category: a.category })), mappings: db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all() });
  if (request.method === 'PUT' && p === '/api/admin/planet/activity-mappings') {
    const data = await readBody(request);
    if (!catalog.some(a => a.activity_id === data.catalog_activity_id)) fail(400, 'UNKNOWN_CATALOG_ACTIVITY', '星球目录活动不存在');
    if (!db.raw.prepare('SELECT 1 FROM events WHERE id=?').get(id(data.activity_id))) fail(404, 'ACTIVITY_NOT_FOUND', '网站活动不存在');
    if (db.raw.prepare('SELECT 1 FROM planet_growth_release').get()) return json(configurePlanetEvent(db,admin,data));
    db.raw.prepare(`INSERT INTO planet_activity_catalog_map VALUES(?,?,?,?) ON CONFLICT(catalog_activity_id) DO UPDATE SET
      activity_id=excluded.activity_id,configured_by=excluded.configured_by,updated_at=excluded.updated_at`).run(data.catalog_activity_id, data.activity_id, admin.id, now());
    return json({ status: 'mapped' });
  }
  const config = /^\/api\/admin\/devices\/([a-f0-9-]{36})\/hardware$/.exec(p);
  if (request.method === 'PUT' && config) {
    const data = await readBody(request), deviceId = id(config[1]);
    if (!['user', 'checkin'].includes(data.device_kind) || data.rgb565_byte_order != null && !['little', 'big'].includes(data.rgb565_byte_order)) fail(400, 'INVALID_CONFIGURATION', '设备类型或字节序不合法');
    if (!db.raw.prepare('SELECT 1 FROM devices WHERE id=? AND revoked_at IS NULL').get(deviceId)) fail(404, 'DEVICE_NOT_FOUND', '设备不存在或已停用');
    const old = db.raw.prepare('SELECT device_kind FROM device_hardware_profiles WHERE device_id=?').get(deviceId);
    if (old && old.device_kind !== data.device_kind) fail(409, 'DEVICE_KIND_PERMANENT', '已配置设备的类型不能修改');
    if (!old && data.device_kind === 'checkin' && (db.raw.prepare('SELECT 1 FROM checkins WHERE device_id=? UNION ALL SELECT 1 FROM connections WHERE device_id=? UNION ALL SELECT 1 FROM hardware_interactions WHERE device_a_id=? OR device_b_id=?').get(deviceId, deviceId, deviceId, deviceId))) fail(409, 'DEVICE_ALREADY_USED', '请为签到板绑定新设备');
    db.raw.prepare(`INSERT INTO device_hardware_profiles VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
      rgb565_byte_order=excluded.rgb565_byte_order,configured_by=excluded.configured_by,updated_at=excluded.updated_at`).run(deviceId, data.device_kind, data.rgb565_byte_order || null, admin.id, now());
    return json({ status: 'configured' });
  }
  if (request.method === 'PUT' && p === '/api/admin/checkin-stations/activities') {
    const data = await readBody(request); device(db, data.station_device_id, 'checkin'); id(data.activity_id);
    if (!db.raw.prepare('SELECT 1 FROM events WHERE id=?').get(data.activity_id)) fail(404, 'ACTIVITY_NOT_FOUND', '活动不存在');
    if (!Number.isSafeInteger(data.opens_at) || !Number.isSafeInteger(data.closes_at) || data.opens_at < 1 || data.closes_at <= data.opens_at || data.revoked !== undefined && typeof data.revoked !== 'boolean') fail(400, 'INVALID_WINDOW', '授权时间或撤销设置无效');
    db.raw.prepare(`INSERT INTO checkin_station_activities VALUES(?,?,?,?,?,?) ON CONFLICT(station_device_id,activity_id) DO UPDATE SET
      opens_at=excluded.opens_at,closes_at=excluded.closes_at,authorized_by=excluded.authorized_by,revoked_at=excluded.revoked_at`).run(data.station_device_id, data.activity_id, data.opens_at, data.closes_at, admin.id, data.revoked === true ? now() : null);
    return json({ status: data.revoked === true ? 'revoked' : 'authorized' });
  }
  return null;
}
