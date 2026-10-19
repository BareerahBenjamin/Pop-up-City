import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../database.js';
import api from '../api.js';
import {friend as submitFriend} from '../hardware.js';
import { createApplication } from '../server.js';
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

const unwrap=(r,board)=>{assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.signature,createHmac('sha256',Buffer.from(sha(board.token),'hex')).update(r.data.payload).digest('hex'));const payload=JSON.parse(r.data.payload);assert.equal(payload.recipient_device_id,board.id);return payload;};
async function grant(f,activity){await f.configure(f.station,'checkin');await f.call('/api/admin/checkin-stations/activities',f.admin,{station_device_id:f.station.id,activity_id:activity,opens_at:f.stamp-100,closes_at:f.stamp+1800},'PUT');}
test('cloud check-in persists confirmation, submits once and validates revoked peers',async t=>{
 const f=fixture(t,true),event=f.event();await grant(f,event);
 const request=unwrap(await f.call('/local/checkin/request',f.ba,{station_device_id:f.station.id}),f.ba);
 assert.equal(request.state,'waiting');f.reopen();
 const proof=sign(f.ba.token,['herstory-hardware-v1','checkin',request.interaction_id,request.station_device_id,request.user_device_id,request.activity_id,request.nonce,request.confirmation_code,request.occurred_at,true]);
 assert.equal(unwrap(await f.call('/local/checkin/confirm',f.ba,{interaction_id:request.interaction_id,user_proof:proof}),f.ba).state,'confirmed');
 assert.notEqual((await f.call('/local/checkin/submit',f.bb,{interaction_id:request.interaction_id})).status,200);
 const receipt=unwrap(await f.call('/local/checkin/submit',f.station,{interaction_id:request.interaction_id}),f.station);
 assert.equal(receipt.state,'done');assert.equal(receipt.receipt.status,'checked_in');
 assert.deepEqual(unwrap(await f.call('/local/checkin/submit',f.station,{interaction_id:request.interaction_id}),f.station),receipt);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,1);
 f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(f.stamp,f.ba.id);
 assert.equal((await f.call('/local/checkin/session',f.ba)).status,401);
});
test('cloud friend pairing needs fresh mutual presence and both proofs; list follows saved relation',async t=>{
 const f=fixture(t,true);
 for(const b of [f.ba,f.bb])unwrap(await f.call('/local/friend/request',b,{}),b);
 const observation=(peer)=>({peer_device_id:peer.id,presence_epoch:f.stamp,presence_tag:sign(peer.token,['herstory-presence-v1',peer.id,f.stamp]).slice(0,12),rssi:-45,age_ms:0});
 unwrap(await f.call('/local/friend/nearby',f.ba,{observations:[observation(f.bb)]}),f.ba);
 let session=unwrap(await f.call('/local/friend/session',f.ba),f.ba);assert.equal(session.state,'searching');
 unwrap(await f.call('/local/friend/nearby',f.bb,{observations:[observation(f.ba)]}),f.bb);
 session=unwrap(await f.call('/local/friend/session',f.ba),f.ba);assert.equal(session.state,'waiting');f.reopen();
 for(const b of [f.ba,f.bb]){
  const fields=['herstory-hardware-v1','friend',session.interaction_id,session.device_a_id,session.device_b_id,session.nonce,session.confirmation_code,session.occurred_at,true,true];
  session=unwrap(await f.call('/local/friend/confirm',b,{interaction_id:session.interaction_id,user_proof:sign(b.token,fields)}),b);
 }
 assert.equal(session.state,'done');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM friendships').get().n,1);
 const list=unwrap(await f.call('/local/friend/list',f.ba),f.ba);assert.equal(list.total,1);assert.equal(list.friends[0].member_id,f.b.id);
 assert.equal(unwrap(await f.call('/local/friend/request',f.ba,{}),f.ba).state,'searching');
 assert.equal(unwrap(await f.call('/local/friend/session',f.ba),f.ba).state,'searching');
 assert.ok(!f.db.raw.prepare('SELECT state_json FROM hardware_cloud_sessions').all().some(r=>r.state_json.includes(f.ba.token)));
});
test('event owner hosts automatically during event; signed presence, replay and user result persist',async t=>{
 const f=fixture(t,true),activity=f.event();
 const host=f.bc;f.db.raw.prepare('UPDATE events SET host_id=? WHERE id=?').run(f.c.id,activity);
 let state=unwrap(await f.call('/local/host/state',host),host);assert.equal(state.activities.length,0);
 f.db.raw.prepare('UPDATE events SET starts_at=?,ends_at=? WHERE id=?').run(f.stamp-1,f.stamp+3600,activity);
 state=unwrap(await f.call('/local/host/state',host),host);assert.equal(state.activities.length,1);
 assert.equal((await f.call('/api/admin/hardware/configure',f.admin,{device_id:host.id,host_activity_id:activity,enabled:true},'PUT')).status,200);
 state=unwrap(await f.call('/local/host/state',host),host);assert.equal(state.activities.length,1);
 const event={interaction_id:randomUUID(),host_device_id:host.id,user_device_id:f.ba.id,activity_id:activity,presence_epoch:f.stamp,presence_tag:sign(f.ba.token,['herstory-presence-v1',f.ba.id,f.stamp]).slice(0,12),occurred_at:f.stamp,host_confirmed:true};
 event.host_proof=sign(host.token,['herstory-host-checkin-v1',event.interaction_id,host.id,f.ba.id,activity,event.presence_epoch,event.presence_tag,event.occurred_at,true]);
 assert.equal((await f.call('/local/host/submit',f.bb,event)).status,400);
 const saved=unwrap(await f.call('/local/host/submit',host,event),host);assert.equal(saved.status,'checked_in');f.reopen();
 assert.deepEqual(unwrap(await f.call('/local/host/submit',host,event),host),saved);
 const result=unwrap(await f.call('/local/host/result',f.ba),f.ba);const {recipient_device_id,...business}=saved;assert.deepEqual(result.receipt,business);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,1);
 assert.equal((await f.call('/api/admin/hardware/configure',f.admin,{device_id:f.bb.id,host_activity_id:activity,enabled:true},'PUT')).status,403);
});
test('local compatibility routes bypass browser Origin only with device authentication',async t=>{
 const f=fixture(t),r=await api.fetch(new Request('http://localhost:3334/local/friend/request',{method:'POST',headers:{Authorization:'Bearer '+f.ba.token,'Content-Type':'application/json'},body:'{}'}),{DB:f.db,AUTH_PEPPER:'x'.repeat(32)});
 assert.equal(r.status,200);
 assert.equal((await f.call('/local/friend/session',null)).status,401);
 assert.equal((await f.call('/api/admin/hardware',f.ba)).status,403);
});

test('HTTP server dispatches local device routes instead of serving static files',async t=>{
 const f=fixture(t);const server=createApplication({origin:'http://127.0.0.1',pepper:'x'.repeat(32)},{db:f.db,mailer:null});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/local/friend/request',{method:'POST',headers:{Authorization:'Bearer '+f.ba.token,'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,200);const result=await response.json();assert.equal(JSON.parse(result.payload).state,'searching');
});
test('cloud rejects forged confirmation, expired sessions and conflicting host requests without new attendance',async t=>{
 const f=fixture(t),activity=f.event();await grant(f,activity);
 const session=unwrap(await f.call('/local/checkin/request',f.ba,{}),f.ba);
 assert.equal((await f.call('/local/checkin/confirm',f.ba,{interaction_id:session.interaction_id,user_proof:'0'.repeat(64)})).status,409);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,0);
 const persisted=f.db.raw.prepare('SELECT state_json FROM hardware_cloud_sessions WHERE id=?').get('checkin:'+f.station.id);
 const state=JSON.parse(persisted.state_json);state.current.occurred_at-=100;
 f.db.raw.prepare('UPDATE hardware_cloud_sessions SET state_json=? WHERE id=?').run(JSON.stringify(state),'checkin:'+f.station.id);
 assert.equal(unwrap(await f.call('/local/checkin/session',f.station),f.station).state,'idle');
 const configured=await f.call('/api/admin/hardware',f.admin);assert.equal(configured.status,200);
 assert.ok(configured.data.devices.every(d=>!('token_hash' in d)&&!('token' in d)));
 assert.equal((await f.call('/api/admin/hardware/configure',f.admin,{device_id:f.ba.id,station_device_id:f.station.id,host_activity_id:activity,enabled:true},'PUT')).status,400);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM hardware_cloud_settings').get().n,0);
});

test('host availability follows publication, ownership and exact start/end boundaries without grants',async t=>{
 const f=fixture(t),activity=f.event(),host=f.bc;
 f.db.raw.prepare('UPDATE events SET host_id=?,starts_at=?,ends_at=? WHERE id=?').run(f.c.id,f.stamp,f.stamp+300,activity);
 assert.equal(unwrap(await f.call('/local/host/state',host),host).activities.length,1);
 assert.equal(unwrap(await f.call('/local/host/state',f.bb),f.bb).activities.length,0);
 f.db.raw.prepare("UPDATE events SET status='pending' WHERE id=?").run(activity);
 assert.equal(unwrap(await f.call('/local/host/state',host),host).activities.length,0);
 f.db.raw.prepare("UPDATE events SET status='published',ends_at=? WHERE id=?").run(f.stamp,activity);
 assert.equal(unwrap(await f.call('/local/host/state',host),host).activities.length,0);
});

test('host names require registration and batch checks only authenticated nearby registered members',async t=>{
 const f=fixture(t,true),activity=f.event(),host=f.bc;
 f.db.raw.prepare('UPDATE events SET host_id=?,starts_at=? WHERE id=?').run(f.c.id,f.stamp-1,activity);
 const submission=(peer,changes={})=>{
  const p={interaction_id:randomUUID(),host_device_id:host.id,user_device_id:peer.id,activity_id:activity,presence_epoch:f.stamp,presence_tag:sign(peer.token,['herstory-presence-v1',peer.id,f.stamp]).slice(0,12),occurred_at:f.stamp,host_confirmed:true,...changes};
  p.host_proof=sign(host.token,['herstory-host-checkin-v1',p.interaction_id,host.id,peer.id,activity,p.presence_epoch,p.presence_tag,p.occurred_at,true]);return p;
 };
 const eligible=submission(f.ba),unregistered=submission(f.bb);
 const named=unwrap(await f.call('/local/host/nearby',host,eligible),host);
 assert.equal(named.user_label,'测试成员');assert.match(named.name_bitmap,/^[a-f0-9]{1536}$/);assert.notEqual(named.name_bitmap,'0'.repeat(1536));
 assert.equal((await f.call('/local/host/nearby',host,unregistered)).status,403);
 const batch={activity_id:activity,participants:[eligible,unregistered]};
 const done=unwrap(await f.call('/local/host/batch',host,batch),host);
 assert.deepEqual(done.results.map(x=>x.status),['checked_in','rejected']);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,1);
 f.reopen();assert.deepEqual(unwrap(await f.call('/local/host/batch',host,batch),host),done);
 const result=unwrap(await f.call('/local/host/result',f.ba),f.ba);assert.equal(result.state,'done');
 assert.equal((await f.call('/local/host/batch',host,{activity_id:activity,participants:[eligible,eligible]})).status,400);
 const forged=submission(f.ba,{presence_tag:'000000000000'});
 const rejected=unwrap(await f.call('/local/host/batch',host,{activity_id:activity,participants:[forged]}),host);assert.equal(rejected.results[0].code,'INVALID_PRESENCE');
 f.db.raw.prepare('UPDATE events SET ends_at=? WHERE id=?').run(f.stamp,activity);
 assert.equal(unwrap(await f.call('/local/host/batch',host,batch),host).results[0].status,'checked_in');
 const fresh=submission(f.ba);assert.equal(unwrap(await f.call('/local/host/batch',host,{activity_id:activity,participants:[fresh]}),host).results[0].code,'HOST_NOT_AUTHORIZED');
});

test('local event deletion remains effective across remote cloud station and host routes',async t=>{
 const f=fixture(t),activity=f.event();await grant(f,activity);
 const waiting=unwrap(await f.call('/local/checkin/request',f.ba,{station_device_id:f.station.id}),f.ba);assert.equal(waiting.activity_id,activity);
 assert.equal((await f.call(`/api/admin/events/${activity}`,f.admin,{confirm_title:'测试活动'},'DELETE')).status,200);
 assert.equal(unwrap(await f.call('/local/checkin/activities',f.station),f.station).activities.length,0);
 assert.equal(unwrap(await f.call('/local/checkin/session',f.station),f.station).state,'idle');
 assert.equal((await f.call('/local/checkin/request',f.ba,{station_device_id:f.station.id})).status,409);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,0);
 const hosted=f.event();f.db.raw.prepare('UPDATE events SET host_id=?,starts_at=? WHERE id=?').run(f.c.id,f.stamp-1,hosted);
 assert.equal(unwrap(await f.call('/local/host/state',f.bc),f.bc).activities.length,1);
 await f.call(`/api/admin/events/${hosted}`,f.admin,{confirm_title:'测试活动'},'DELETE');
 assert.equal(unwrap(await f.call('/local/host/state',f.bc),f.bc).activities.length,0);
 assert.equal((await f.call('/api/admin/hardware/configure',f.admin,{device_id:f.bc.id,host_activity_id:hosted,enabled:true},'PUT')).status,403);
});

test('closed single operation is retired durably and rejects a late submit after reopening',async t=>{
 const f=fixture(t,true),activity=f.event(),host=f.bc,peer=f.ba,id=randomUUID();
 f.db.raw.prepare('UPDATE events SET host_id=?,starts_at=? WHERE id=?').run(f.c.id,f.stamp-1,activity);
 const cancellation={interaction_id:id,activity_id:activity,user_device_id:peer.id,host_proof:sign(host.token,['herstory-host-cancel-v1',id,host.id,peer.id,activity])};
 assert.equal((await f.call('/local/host/cancel',host,cancellation)).status,409);
 f.db.raw.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(activity);
 assert.equal((await f.call('/local/host/cancel',f.bb,cancellation)).status,403);
 assert.equal(unwrap(await f.call('/local/host/cancel',host,cancellation),host).state,'cancelled');
 f.reopen();
 assert.equal(unwrap(await f.call('/local/host/cancel',host,cancellation),host).state,'cancelled');
 assert.equal(unwrap(await f.call('/api/device/operations/'+id,host),host).state,'cancelled');
 f.db.raw.prepare("UPDATE events SET status='published' WHERE id=?").run(activity);
 const late={interaction_id:id,host_device_id:host.id,user_device_id:peer.id,activity_id:activity,presence_epoch:f.stamp,presence_tag:sign(peer.token,['herstory-presence-v1',peer.id,f.stamp]).slice(0,12),occurred_at:f.stamp,host_confirmed:true};
 late.host_proof=sign(host.token,['herstory-host-checkin-v1',id,host.id,peer.id,activity,late.presence_epoch,late.presence_tag,late.occurred_at,true]);
 assert.equal((await f.call('/local/host/submit',host,late)).status,409);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM checkins').get().n,0);
 assert.equal(unwrap(await f.call('/local/host/result',peer),peer).state,'idle');
});

test('friend retirement is durable, rejects late proof replay, and cannot erase saved success',async t=>{
 const f=fixture(t,true), intent=f.friendship(), peer=f.bb;
 const retired={interaction_id:intent.interaction_id,peer_device_id:peer.id,nonce:intent.nonce,confirmation_code:intent.confirmation_code,occurred_at:intent.occurred_at};
 retired.user_proof=sign(f.ba.token,['herstory-friend-retire-v1',retired.interaction_id,f.ba.id,peer.id,retired.nonce,retired.confirmation_code,retired.occurred_at]);
 assert.equal((await f.call('/local/friend/retire',f.ba,{...retired,user_proof:'0'.repeat(64)})).status,403);
 assert.equal(unwrap(await f.call('/local/friend/retire',f.ba,retired),f.ba).state,'cancelled');
 const orphan=f.friendship(),orphanStop={interaction_id:orphan.interaction_id,peer_device_id:f.bb.id,nonce:orphan.nonce,confirmation_code:orphan.confirmation_code,occurred_at:orphan.occurred_at};
 orphanStop.user_proof=sign(f.ba.token,['herstory-friend-retire-v1',orphanStop.interaction_id,f.ba.id,f.bb.id,orphanStop.nonce,orphanStop.confirmation_code,orphanStop.occurred_at]);
 f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(f.stamp,f.bb.id);f.db.raw.prepare("UPDATE members SET status='disabled' WHERE id=?").run(f.b.id);
 assert.equal(unwrap(await f.call('/local/friend/retire',f.ba,orphanStop),f.ba).state,'cancelled');
 f.db.raw.prepare('UPDATE devices SET revoked_at=NULL WHERE id=?').run(f.bb.id);f.db.raw.prepare("UPDATE members SET status='active' WHERE id=?").run(f.b.id);
 f.reopen();
 assert.equal(unwrap(await f.call('/api/device/operations/'+intent.interaction_id,peer),peer).state,'cancelled');
 assert.throws(()=>submitFriend(f.db,{id:f.ba.id},intent),error=>{assert.equal(error.code,'EVENT_ID_CONFLICT');return true;});
 assert.equal((await f.call('/api/device/friend-events',f.ba,intent)).status,409);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM friendships').get().n,0);
 assert.equal(unwrap(await f.call('/local/friend/retire',f.ba,retired),f.ba).state,'cancelled');
 const saved=f.friendship();
 assert.equal((await f.call('/api/device/friend-events',f.ba,saved)).status,200);
 const savedPeer=f.bb;
 const stop={interaction_id:saved.interaction_id,peer_device_id:savedPeer.id,nonce:saved.nonce,confirmation_code:saved.confirmation_code,occurred_at:saved.occurred_at};
 stop.user_proof=sign(f.ba.token,['herstory-friend-retire-v1',stop.interaction_id,f.ba.id,savedPeer.id,stop.nonce,stop.confirmation_code,stop.occurred_at]);
 const result=unwrap(await f.call('/local/friend/retire',f.ba,stop),f.ba);assert.equal(result.state,'saved');assert.equal(result.receipt.status,'connected');
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM friendships').get().n,1);
});

test('Chinese host title and roster strips fit bounded signed device responses',async t=>{
 const f=fixture(t),activity=f.event();
 f.db.raw.prepare('UPDATE events SET host_id=?,starts_at=?,ends_at=? WHERE id=?').run(f.c.id,f.stamp-1,f.stamp+300,activity);
 const longName='王'.repeat(32);f.db.raw.prepare('UPDATE members SET nickname=? WHERE id=?').run(longName,f.c.id);f.db.raw.prepare('UPDATE events SET title=? WHERE id=?').run(longName,activity);
 for(let i=0;i<5;i++){const id=randomUUID();f.db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(id,id+'@example.test',longName,f.stamp,f.stamp);f.db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(activity,id,f.stamp+i+1);}
 const runtime=await f.call('/api/device/runtime?view=board',f.bc),facts=unwrap(runtime,f.bc);
 assert.match(facts.host.active_title_bitmap,/^[a-f0-9]{1536}$/);assert.ok(Buffer.from(facts.host.active_title_bitmap,'hex').some(x=>x));
 const response=await f.call('/api/device/host/roster?activity_id='+activity+'&offset=0&limit=6',f.bc),roster=unwrap(response,f.bc);
 assert.match(roster.activity_title_bitmap,/^[a-f0-9]{1536}$/);
 assert.equal(roster.items.length,6);assert.equal(roster.items[0].name,'测试成员');assert.match(roster.items[0].name_bitmap,/^[a-f0-9]{768}$/);assert.ok(Buffer.from(roster.items[0].name_bitmap,'hex').some(x=>x));
 assert.ok(Buffer.byteLength(JSON.stringify(response.data))<16384);assert.ok(Buffer.byteLength(JSON.stringify(runtime.data))<16384);
});
test('friend visual is signed, recipient ordered and survives avatar edits, saved receipts and restarts',async t=>{
 const f=fixture(t,true),avatar=hair=>JSON.stringify({release:'herstory-avatar-assets-v1',selection:{hst_layer_hair:hair,hst_layer_body:'hst_ast_0019',hst_layer_hoodie:'hst_ast_0052'}});
 f.db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run(avatar('hst_ast_0035'),f.a.id);f.db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run(avatar('hst_ast_0036'),f.b.id);
 for(const b of [f.ba,f.bb])unwrap(await f.call('/local/friend/request',b,{}),b);
 const observation=peer=>({peer_device_id:peer.id,presence_epoch:f.stamp,presence_tag:sign(peer.token,['herstory-presence-v1',peer.id,f.stamp]).slice(0,12),rssi:-45,age_ms:0});
 for(const [b,p] of [[f.ba,f.bb],[f.bb,f.ba]])unwrap(await f.call('/local/friend/nearby',b,{observations:[observation(p)]}),b);
 let s=unwrap(await f.call('/local/friend/session',f.ba),f.ba);const original=s.visual;assert.equal(original.self.member_id,f.a.id);assert.equal(original.self.hair_length,'short');assert.equal(original.peer.hair_length,'long');assert.equal(original.self.fallback,false);
 const opposite=unwrap(await f.call('/local/friend/session',f.bb),f.bb);assert.deepEqual(opposite.visual.self,original.peer);
 f.db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run(avatar('hst_ast_0048'),f.a.id);f.reopen();
 for(const b of [f.ba,f.bb]){const fields=['herstory-hardware-v1','friend',s.interaction_id,s.device_a_id,s.device_b_id,s.nonce,s.confirmation_code,s.occurred_at,true,true];s=unwrap(await f.call('/local/friend/confirm',b,{interaction_id:s.interaction_id,user_proof:sign(b.token,fields)}),b);}
 assert.equal(s.state,'done');const recovered=unwrap(await f.call('/api/device/operations/'+s.interaction_id,f.ba),f.ba);assert.deepEqual(recovered.visual,original);assert.equal(recovered.receipt.visual_a.fallback,false);assert.equal((await f.call('/local/friend/session',f.bc)).data.payload.includes('hair_rgb'),false);
 const stranger=unwrap(await f.call('/api/device/operations/'+s.interaction_id,f.bc),f.bc);assert.equal(stranger.state,'unknown');assert.equal(stranger.visual,undefined);
});
