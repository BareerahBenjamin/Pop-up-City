import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../database.js';
import api from '../api.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const sign = (token, fields) => createHmac('sha256', createHash('sha256').update(token).digest()).update(JSON.stringify(fields)).digest('hex');
function fixture(t, persistent = false) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'hardware-frame-storage-')) : null;
  const filename = directory ? join(directory, 'app.sqlite') : ':memory:';
  let db = openDatabase(filename); migrate(db);
  t.after(() => { db.close(); if (directory) rmSync(directory, {recursive:true,force:true}); });
  const stamp = Math.floor(Date.now() / 1000), origin = 'http://localhost:3334';
  const env = { DB: db, AUTH_PEPPER: 'isolated-hardware-test-pepper-000000000000', PUBLIC_ORIGIN: origin };
  function member(role = 'member') {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)").run(id, id + '@example.test', '测试成员', role, stamp, stamp);
    db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token), id, stamp + 3600, stamp);
    return { id, token, admin: true };
  }
  const admin = member('admin'), a = member(), b = member(), c = member();
  function board(owner) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(id, owner.id, sha(token), stamp - 86400);
    return { id, token, member: owner };
  }
  const ba = board(a), bb = board(b), bc = board(c), station = board(admin);
  async function call(path, actor, data, method = data ? 'POST' : 'GET') {
    const r = await api.fetch(new Request(origin + path, { method, headers: { Origin: origin,
      ...(actor ? actor.admin ? { Cookie: 'popup_city_session=' + actor.token } : { Authorization: 'Bearer ' + actor.token } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }), env);
    return { status: r.status, headers: r.headers, data: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  }
  function event() {
    const id = randomUUID();
    db.raw.prepare(`INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at)
      VALUES(?,'测试活动','介绍','learning','测试场地',?,?,20,?,'published',?,?)`).run(id, stamp + 1800, stamp + 3600, admin.id, stamp, stamp);
    db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(id, a.id, stamp);
    return id;
  }
  async function configure(actor, kind, order) {
    return call('/api/admin/devices/' + actor.id + '/hardware', admin, { device_kind: kind, ...(order ? { rgb565_byte_order: order } : {}) }, 'PUT');
  }
  function checkin(activityId, changes = {}) {
    const data = { interaction_id: randomUUID(), activity_id: activityId, station_device_id: station.id, user_device_id: ba.id,
      nonce: randomBytes(16).toString('hex'), confirmation_code: '0007', occurred_at: stamp, user_confirmed: true, ...changes };
    data.user_proof = sign(ba.token, ['herstory-hardware-v1', 'checkin', data.interaction_id, data.station_device_id, data.user_device_id, data.activity_id, data.nonce, data.confirmation_code, data.occurred_at, data.user_confirmed]);
    return data;
  }
  function friendship(changes = {}) {
    const [x, y] = [ba, bb].sort((x, y) => x.id.localeCompare(y.id));
    const data = { interaction_id: randomUUID(), device_a_id: x.id, device_b_id: y.id, nonce: randomBytes(16).toString('hex'), confirmation_code: '0831', occurred_at: stamp - 7200,
      a_confirmed: true, b_confirmed: true, ...changes };
    const fields = ['herstory-hardware-v1', 'friend', data.interaction_id, data.device_a_id, data.device_b_id, data.nonce, data.confirmation_code, data.occurred_at, data.a_confirmed, data.b_confirmed];
    data.a_proof = sign(x.token, fields); data.b_proof = sign(y.token, fields);
    return data;
  }
  return { get db() { return db; }, reopen() { db.close(); db = openDatabase(filename); env.DB = db; }, stamp, admin, a, b, c, ba, bb, bc, station, call, event, configure, checkin, friendship };
}
test('station checks permission, enrollment and signed confirmation; replay and duplicate stay atomic', async t => {
  const f = fixture(t), activity = f.event();
  assert.equal((await f.configure(f.station, 'checkin')).status, 200);
  const data = f.checkin(activity);
  assert.equal((await f.call('/api/device/checkin-events', f.station, data)).data.code, 'STATION_NOT_AUTHORIZED');
  assert.equal((await f.call('/api/admin/checkin-stations/activities', f.admin, { station_device_id: f.station.id, activity_id: activity, opens_at: f.stamp - 100, closes_at: f.stamp + 2000 }, 'PUT')).status, 200);
  assert.equal((await f.call('/api/device/checkin-events', f.ba, data)).status, 403);
  assert.equal((await f.call('/api/device/checkin-events', f.station, { ...data, user_proof: '0'.repeat(64) })).status, 403);
  assert.equal((await f.call('/api/device/checkin-events', f.station, f.checkin(activity, { user_confirmed: false }))).status, 400);
  f.db.raw.prepare('DELETE FROM event_registrations WHERE event_id=?').run(activity);
  assert.equal((await f.call('/api/device/checkin-events', f.station, data)).data.code, 'NOT_REGISTERED');
  f.db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(activity, f.a.id, f.stamp);
  const saved = await f.call('/api/device/checkin-events', f.station, data);
  assert.equal(saved.status, 200); assert.equal(saved.data.status, 'checked_in'); assert.equal(saved.data.duplicate, false);
  const { user_receipt_proof, ...receipt } = saved.data;
  assert.equal(user_receipt_proof, sign(f.ba.token, ['herstory-receipt-v1', receipt.receipt_id, receipt.interaction_id, receipt.status,
    receipt.user_id, receipt.activity_id, receipt.checked_at, receipt.duplicate, receipt.planet_revision, receipt.growth_status]));
  const again = await f.call('/api/device/checkin-events', f.station, data); assert.deepEqual(again.data, saved.data);
  const duplicate = await f.call('/api/device/checkin-events', f.station, f.checkin(activity)); assert.equal(duplicate.data.duplicate, true);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n, 1);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM planet_settlement_tasks').get().n, 1);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM hardware_checkin_sources').get().n, 1);
  assert.equal((await f.call('/api/device/checkin-events', f.station, f.checkin(activity, { interaction_id: data.interaction_id, confirmation_code: '0011' }))).data.code, 'EVENT_ID_CONFLICT');
  // A saved receipt remains retrievable after the activity closes.
  f.db.raw.prepare('UPDATE events SET starts_at=?,ends_at=? WHERE id=?').run(f.stamp - 100, f.stamp + 100, activity);
  assert.deepEqual((await f.call('/api/device/checkin-events', f.station, data)).data, saved.data);
  assert.equal((await f.call('/api/device/checkin-events', f.station, f.checkin(activity))).data.code, 'CHECKIN_CLOSED');
  assert.equal((await f.call('/api/device/social-code', f.station, {})).status, 403);
  assert.equal((await f.configure(f.station, 'user')).status, 409);
  assert.throws(() => f.db.raw.prepare('UPDATE devices SET member_id=? WHERE id=?').run(f.b.id, f.ba.id), /permanent/);
});
test('offline bilateral friend event can be uploaded by either user; event and pair deduplicate and rollback', async t => {
  const f = fixture(t), data = f.friendship();
  assert.equal((await f.call('/api/device/friend-events', f.bc, data)).status, 403);
  assert.equal((await f.call('/api/device/friend-events', f.ba, { ...data, b_proof: '0'.repeat(64) })).status, 403);
  assert.equal((await f.call('/api/device/friend-events', f.ba, f.friendship({ b_confirmed: false }))).status, 400);
  const first = await f.call('/api/device/friend-events', f.ba, data); assert.equal(first.status, 200);
  assert.deepEqual((await f.call('/api/device/friend-events', f.bb, data)).data, first.data);
  const retry = await f.call('/api/device/friend-events', f.bb, f.friendship()); assert.equal(retry.data.duplicate, true);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM friendships').get().n, 1);
  const a = (await f.call('/api/herstory/planet-state', f.a)).data, b = (await f.call('/api/herstory/planet-state', f.b)).data;
  assert.equal(a.connections[0].id, f.b.id); assert.equal(b.connections[0].id, f.a.id);
  assert.equal((await f.call('/api/me/records', f.a)).data.connections.length, 1);
  assert.equal((await f.call('/api/device/friend-events', f.bb, f.friendship({ interaction_id: data.interaction_id, confirmation_code: '7777' }))).data.code, 'EVENT_ID_CONFLICT');
  // Simulate failure at the receipt write: facts and both revisions must roll back.
  const total = f.db.raw.prepare('SELECT COUNT(*) n FROM hardware_interactions').get().n;
  f.db.raw.exec("CREATE TRIGGER simulated_failure BEFORE INSERT ON hardware_interactions BEGIN SELECT RAISE(ABORT,'test interruption'); END");
  assert.equal((await f.call('/api/device/friend-events', f.ba, f.friendship())).status, 500);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM hardware_interactions').get().n, total);
  assert.equal((await f.call('/api/herstory/planet-state', f.a)).data.revision, a.revision);
  f.db.raw.exec('DROP TRIGGER simulated_failure');
  f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(f.stamp, f.bb.id);
  assert.equal((await f.call('/api/device/friend-events', f.ba, data)).status, 403);
});
test('hardware frame is explicit-endian, immutable and version pinned; all chunks match metadata SHA256', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/device/planet/version', f.ba)).data.code, 'BYTE_ORDER_REQUIRED');
  assert.equal((await f.configure(f.ba, 'user', 'little')).status, 200);
  const first = (await f.call('/api/device/planet/version', f.ba)).data;
  assert.equal(first.byte_length, 153600); assert.equal(first.width, 240); assert.equal(first.height, 320); assert.equal(first.byte_order, 'little');
  assert.deepEqual((await f.call('/api/device/planet/version', f.ba)).data, first);
  const chunks = [];
  for (let offset = 0; offset < first.byte_length; offset += first.chunk_size) {
    const r = await f.call(first.frame_url + '?offset=' + offset + '&length=' + first.chunk_size, f.ba);
    assert.equal(r.status, 206); assert.equal(r.headers.get('x-frame-sha256'), first.sha256); chunks.push(r.data);
  }
  const original = Buffer.concat(chunks); assert.equal(original.length, 153600); assert.equal(sha(original), first.sha256);
  assert.equal((await f.call(first.frame_url + '?offset=1', f.ba)).status, 416);
  assert.equal((await f.call(first.frame_url, f.bc)).status, 404);
  const activity = f.event();
  assert.equal((await f.call('/api/admin/planet/activity-mappings', f.admin, { catalog_activity_id: 'a2', activity_id: activity }, 'PUT')).status, 200);
  f.db.raw.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(activity, f.a.id, f.ba.id, f.stamp, 'frame-test');
  const next = (await f.call('/api/device/planet/version', f.ba)).data; assert.ok(next.version > first.version);
  const state = JSON.parse(f.db.raw.prepare('SELECT state_json FROM hardware_pixel_states WHERE member_id=?').get(f.a.id).state_json);
  assert.equal(state.aiCheckinCount, 1); assert.equal(state.aiStage, 1);
  assert.deepEqual((await f.call(first.frame_url + '?length=16384', f.ba)).data, original.subarray(0, 16384));
  assert.equal((await f.call('/api/device/planet/displayed', f.ba, { version: next.version, sha256: '0'.repeat(64) })).status, 409);
  assert.equal((await f.call('/api/device/planet/displayed', f.ba, { version: next.version, sha256: next.sha256 })).status, 200);
  assert.equal((await f.call('/api/device/planet/displayed', f.ba, { version: first.version, sha256: first.sha256 })).status, 409);
  assert.throws(() => f.db.raw.prepare('UPDATE hardware_planet_frames SET sha256=?').run('0'.repeat(64)), /immutable/);
  // A byte-order change creates a distinct pinned frame, and an unchanged read never renders again.
  await f.configure(f.ba, 'user', 'big');
  const big = (await f.call('/api/device/planet/version', f.ba)).data; assert.ok(big.version > next.version); assert.equal(big.byte_order, 'big');
  const littleBytes = f.db.raw.prepare('SELECT frame FROM hardware_planet_frames WHERE member_id=? AND frame_version=?').get(f.a.id, next.version).frame;
  const bigBytes = f.db.raw.prepare('SELECT frame FROM hardware_planet_frames WHERE member_id=? AND frame_version=?').get(f.a.id, big.version).frame;
  assert.deepEqual(Buffer.from(littleBytes).swap16(), Buffer.from(bigBytes));
  await f.configure(f.ba, 'user', 'little');
  const restored = (await f.call('/api/device/planet/version', f.ba)).data;
  assert.ok(restored.version > big.version); assert.equal(restored.sha256, next.sha256);
  assert.equal(f.db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('mapped attendance settles assets in the receipt transaction; settlement failure rolls back facts and can retry', async t => {
  const f=fixture(t),activity=f.event();
  assert.equal((await f.call('/api/admin/planet/growth/activate',f.admin,{})).status,200);
  assert.equal((await f.call('/api/admin/planet/growth/events',f.admin,{activity_id:activity,catalog_activity_id:'a2'})).status,200);
  await f.configure(f.station,'checkin');
  await f.call('/api/admin/checkin-stations/activities',f.admin,{station_device_id:f.station.id,activity_id:activity,opens_at:f.stamp-100,closes_at:f.stamp+2000},'PUT');
  f.db.raw.exec("CREATE TRIGGER injected_growth_failure BEFORE INSERT ON planet_asset_grants BEGIN SELECT RAISE(ABORT,'isolated settlement failure'); END");
  const data=f.checkin(activity),failed=await f.call('/api/device/checkin-events',f.station,data);
  assert.equal(failed.status,500);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,0);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM hardware_interactions').get().n,0);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM planet_settlement_tasks').get().n,0);
  f.db.raw.exec('DROP TRIGGER injected_growth_failure');
  const saved=await f.call('/api/device/checkin-events',f.station,data);assert.equal(saved.status,200);assert.equal(saved.data.growth_status,'settled');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM planet_asset_grants').get().n,1);
  assert.deepEqual((await f.call('/api/device/checkin-events',f.station,data)).data,saved.data);
});


test('240x320 RGB565 BLOB survives database reopen and serves identical authenticated chunks', async t => {
  const f=fixture(t,true);
  await f.configure(f.ba,'user','big');
  const before=(await f.call('/api/device/planet/version',f.ba)).data;
  const saved=Buffer.from(f.db.raw.prepare('SELECT frame FROM hardware_planet_frames WHERE member_id=? AND frame_version=?').get(f.a.id,before.version).frame);
  assert.equal(saved.length,240*320*2);assert.equal(sha(saved),before.sha256);
  f.reopen();
  const after=(await f.call('/api/device/planet/version',f.ba)).data;assert.deepEqual(after,before);
  const chunks=[];for(let offset=0;offset<after.byte_length;offset+=4096){const r=await f.call(after.frame_url+'?offset='+offset+'&length=4096',f.ba);assert.equal(r.status,206);chunks.push(r.data);}
  assert.deepEqual(Buffer.concat(chunks),saved);assert.equal((await f.call(after.frame_url,f.bc)).status,404);
  assert.equal(f.db.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
