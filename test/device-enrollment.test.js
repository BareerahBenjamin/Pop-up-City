import test from 'node:test';
import { nameBitmap } from '../hardware-cloud/name-bitmap.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../database.js';
import api from '../api.js';
import { createApplication } from '../server.js';
const sha = value => createHash('sha256').update(value).digest('hex');
test('compact English and Chinese names keep a fixed font rather than filling the bitmap',async()=>{
 const bounds=async name=>{
  const bits=Buffer.from(await nameBitmap(name,true),'hex');assert.equal(bits.length,384);
  let top=24,bottom=-1,left=128,right=-1;
  for(let y=0;y<24;y++)for(let x=0;x<128;x++)if(bits[y*16+(x>>3)]&(128>>(x&7))){top=Math.min(top,y);bottom=Math.max(bottom,y);left=Math.min(left,x);right=Math.max(right,x);}
  assert.ok(bottom>=top);return {height:bottom-top+1,width:right-left+1};
 };
 const single=await bounds('A'),short=await bounds('Rae'),chinese=await bounds('海椰'),mixed=await bounds('Rae 海椰');
 assert.ok(single.height<=14);assert.ok(short.height<=14);assert.ok(chinese.height<=14);assert.ok(mixed.height<=14);
 assert.ok(single.width<16);assert.ok(short.width<40);
});
const sign = (token, fields) => createHmac('sha256', createHash('sha256').update(token).digest()).update(JSON.stringify(fields)).digest('hex');
function fixture(t, persistent = false) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'hardware-frame-storage-')) : null;
  const filename = directory ? join(directory, 'app.sqlite') : ':memory:';
  let db = openDatabase(filename); migrate(db);
  t.after(() => { db.close(); if (directory) rmSync(directory, {recursive:true,force:true}); });
  const stamp = Math.floor(Date.now() / 1000), origin = 'http://localhost:3334';
  const env = { DB: db, AUTH_PEPPER: 'isolated-hardware-test-pepper-000000000000', PUBLIC_ORIGIN: origin, DEVICE_ENROLLMENT_KEY:'a'.repeat(64) };
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
  return { env, origin, get db() { return db; }, reopen() { db.close(); db = openDatabase(filename); env.DB = db; }, stamp, admin, a, b, c, ba, bb, bc, station, call, event, configure, checkin, friendship };
}


const unwrap=(r,board)=>{assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.signature,createHmac('sha256',Buffer.from(sha(board.token),'hex')).update(r.data.payload).digest('hex'));return JSON.parse(r.data.payload);};
async function register(f,board){const response=await api.fetch(new Request(f.origin+'/api/device-enrollment/register',{method:'POST',headers:{Authorization:'Enrollment '+f.env.DEVICE_ENROLLMENT_KEY,'Content-Type':'application/json'},body:JSON.stringify({device_id:board.id,token_hash:sha(board.token)})}),f.env);return {status:response.status,data:await response.json()};}
const fresh=()=>({id:randomUUID(),token:randomBytes(32).toString('hex')});
function unbindFixture(f){f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE member_id IN (?,?)').run(f.stamp,f.a.id,f.b.id);}
test('four-digit claim preserves leading zero; admin request alone never binds; board confirmation and replay are durable',async t=>{
 const f=fixture(t,true);unbindFixture(f);const board=fresh();
 const initial=unwrap(await register(f,board),board);assert.match(initial.claim_code,/^\d{4}$/);assert.equal(initial.state,'unbound');
 f.db.raw.prepare("UPDATE device_inventory SET claim_code='0087' WHERE id=?").run(board.id);
 let state=unwrap(await f.call('/api/device-enrollment/status',board),board);assert.equal(state.claim_code,'0087');
 const base='/api/admin/members/'+f.a.id+'/device-claims';
 const request=await f.call(base,f.admin,{code:'0087'});assert.equal(request.status,200);assert.equal(request.data.state,'pending');
 assert.equal(f.db.raw.prepare('SELECT 1 FROM devices WHERE id=?').get(board.id),undefined);
 state=unwrap(await f.call('/api/device-enrollment/status',board),board);assert.equal(state.request_id,request.data.request_id);assert.equal(state.member_id,f.a.id);assert.match(state.member_label_bitmap,/^[a-f0-9]{1536}$/);assert.ok(Buffer.from(state.member_label_bitmap,'hex').some(x=>x));
 f.reopen();
 const confirmed=unwrap(await f.call('/api/device-enrollment/confirm',board,{request_id:state.request_id,decision:'accept'}),board);assert.equal(confirmed.state,'bound');assert.equal(confirmed.member_id,f.a.id);assert.equal(confirmed.member_name,'测试成员');assert.match(confirmed.member_name_bitmap,/^[a-f0-9]{768}$/);assert.ok(Buffer.from(confirmed.member_name_bitmap,'hex').some(x=>x));
 assert.deepEqual(unwrap(await f.call('/api/device-enrollment/confirm',board,{request_id:state.request_id,decision:'accept'}),board),confirmed);
 assert.equal((await f.call(base+'?request_id='+state.request_id,f.admin)).data.state,'bound');
 const normal=await f.call('/api/device/me',board);assert.equal(normal.status,200);assert.equal(normal.data.member_id,f.a.id);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM device_claim_audit WHERE action='bound'").get().n,1);
 assert.ok(!JSON.stringify(request.data).includes(board.token));
 f.db.raw.prepare('UPDATE members SET nickname=? WHERE id=?').run('Rae 海椰',f.a.id);
 const renamed=unwrap(await f.call('/api/device-enrollment/status',board),board);assert.equal(renamed.member_name,'Rae 海椰');assert.notEqual(renamed.member_name_bitmap,confirmed.member_name_bitmap);
});
test('100 simultaneously issued four-digit codes are unique and initialization requires separate batch authorization',async t=>{
 const f=fixture(t),all=[];
 for(let i=0;i<100;i++){const b=fresh();all.push(unwrap(await register(f,b),b));}
 assert.equal(new Set(all.map(x=>x.claim_code)).size,100);assert.ok(all.every(x=>/^\d{4}$/.test(x.claim_code)));
});

test('claim expiry, code reuse and stale request confirmation cannot bind another claimant',async t=>{
 const f=fixture(t);unbindFixture(f);const board=fresh(),other=fresh();const initial=unwrap(await register(f,board),board);
 const base='/api/admin/members/'+f.a.id+'/device-claims';const claim=await f.call(base,f.admin,{code:initial.claim_code});assert.equal(claim.status,200);
 f.db.raw.prepare('UPDATE device_inventory SET expires_at=? WHERE id=?').run(f.stamp-1,board.id);
 assert.equal((await f.call('/api/device-enrollment/confirm',board,{request_id:claim.data.request_id,decision:'accept'})).status,409);
 unwrap(await f.call('/api/device-enrollment/status',board),board);
 assert.equal((await f.call('/api/device-enrollment/confirm',board,{request_id:claim.data.request_id,decision:'accept'})).status,409);
 const next=unwrap(await register(f,other),other);const request=await f.call(base,f.admin,{code:next.claim_code});
 assert.equal((await f.call('/api/device-enrollment/confirm',board,{request_id:request.data.request_id,decision:'accept'})).status,409);
 assert.equal(f.db.raw.prepare('SELECT 1 FROM devices WHERE id=?').get(other.id),undefined);
});
test('board reject and administrator cancel release requests; member ownership, rate limits and revoked credentials are enforced',async t=>{
 const f=fixture(t);unbindFixture(f);const board=fresh();let state=unwrap(await register(f,board),board);const base='/api/admin/members/'+f.a.id+'/device-claims';
 let claim=await f.call(base,f.admin,{code:state.claim_code});assert.equal(claim.status,200);
 state=unwrap(await f.call('/api/device-enrollment/confirm',board,{request_id:claim.data.request_id,decision:'reject'}),board);assert.equal(state.state,'unbound');
 assert.equal((await f.call(base+'?request_id='+claim.data.request_id,f.admin)).status,404);
 claim=await f.call(base,f.admin,{code:state.claim_code});assert.equal((await f.call(base,f.admin,{request_id:claim.data.request_id},'DELETE')).status,200);
 claim=await f.call(base,f.admin,{code:state.claim_code});unwrap(await f.call('/api/device-enrollment/confirm',board,{request_id:claim.data.request_id,decision:'accept'}),board);
 f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(f.stamp,board.id);
 assert.equal(unwrap(await f.call('/api/device-enrollment/status',board),board).state,'revoked');
 assert.equal((await f.call('/api/device/me',board)).status,401);
 const missing=[...Array(10000)].map((_,i)=>String(i).padStart(4,'0')).find(code=>!f.db.raw.prepare('SELECT 1 FROM device_inventory WHERE claim_code=?').get(code));
 for(let i=0;i<5;i++)assert.equal((await f.call(base,f.admin,{code:missing})).status,404);
 assert.equal((await f.call(base,f.admin,{code:missing})).status,429);
});
test('new initialization and claims reject missing credentials, malformed codes, duplicate identity and already-owned accounts',async t=>{
 const f=fixture(t),board=fresh();const registered=unwrap(await register(f,board),board);
 const base='/api/admin/members/'+f.a.id+'/device-claims';
 assert.equal((await f.call(base,f.admin,{code:registered.claim_code})).status,409);
 assert.equal((await f.call(base,f.admin,{code:87})).status,400);
 assert.equal((await f.call(base,f.ba,{code:registered.claim_code})).status,403);
 assert.equal((await register(f,{id:board.id,token:'b'.repeat(64)})).status,409);
 assert.equal((await f.call('/api/device-enrollment/register',board,{device_id:board.id,token_hash:sha(board.token)})).status,403);
 assert.equal((await f.call('/api/device-enrollment/status',null)).status,401);
 f.env.DEVICE_ENROLLMENT_KEY='';assert.equal((await register(f,fresh())).status,403);
});
