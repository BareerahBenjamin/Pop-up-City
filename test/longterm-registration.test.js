import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {openDatabase,migrate} from '../database.js';
import api from '../api.js';
function fixture(t){
 const db=openDatabase(':memory:');migrate(db);t.after(()=>db.close());const stamp=Math.floor(Date.now()/1000),origin='http://localhost:3358',hash=v=>createHash('sha256').update(v).digest('hex');
 function member(bound=true){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,'测试邻居','member','active',?,?)").run(id,id+'@example.test',stamp,stamp);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,stamp+3600,stamp);if(bound)db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(randomUUID(),id,hash(id),stamp);return{id,token};}
 const host=member();
 function event({start=stamp-7*86400,end=stamp+7*86400,status='published',capacity=20,volunteers=2}={}){const id=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,status,created_at,updated_at) VALUES(?,'长期活动','两周持续报名','活动','线上',?,?,?,?,?,?,?,?)").run(id,start,end,capacity,volunteers,host.id,status,stamp,stamp);return id;}
 async function call(id,who,kind='attendees',method='POST'){const r=await api.fetch(new Request(origin+`/api/events/${id}/${kind}`,{method,headers:{Origin:origin,Cookie:'popup_city_session='+who.token}}),{DB:db,PUBLIC_ORIGIN:origin,AUTH_PEPPER:'longterm-test-pepper-00000000000000000'});return{status:r.status,data:await r.json()};}
 return{db,stamp,member,event,call};
}
test('ongoing two-week events accept attendee and volunteer registrations through their end',async t=>{
 const f=fixture(t),id=f.event(),user=f.member();
 for(const kind of ['attendees','volunteers']){assert.equal((await f.call(id,user,kind)).status,200);assert.equal((await f.call(id,user,kind)).status,200);}
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_registrations WHERE event_id=?').get(id).n,2);
 for(const kind of ['attendees','volunteers'])assert.equal((await f.call(id,user,kind,'DELETE')).status,200);
});
test('three days is the same long-term boundary as the calendar; ordinary sessions still close at start',async t=>{
 const f=fixture(t),user=f.member(),start=f.stamp-3600;
 assert.equal((await f.call(f.event({start,end:start+3*86400}),user)).status,200);
 assert.equal((await f.call(f.event({start,end:start+3*86400-1}),user)).status,409);
 assert.equal((await f.call(f.event({start:f.stamp,end:f.stamp+14*86400}),user)).status,200);
 assert.equal((await f.call(f.event({start:f.stamp+3600,end:f.stamp+7200}),user)).status,200);
 assert.equal((await f.call(f.event({start:f.stamp-100,end:f.stamp+100}),user)).status,409);
});
test('long-term events close exactly at end and reject unpublished or deleted events',async t=>{
 const f=fixture(t),user=f.member(),ended=f.event({start:f.stamp-14*86400,end:f.stamp});
 for(const kind of ['attendees','volunteers']){const r=await f.call(ended,user,kind);assert.equal(r.status,409);assert.match(r.data.error,/已结束/);}
 for(const status of ['cancelled','pending','rejected'])assert.equal((await f.call(f.event({status}),user)).status,409);
 const deleted=f.event();f.db.raw.prepare('INSERT INTO event_deletions VALUES(?,?,?)').run(deleted,user.id,f.stamp);assert.equal((await f.call(deleted,user)).status,404);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_registrations').get().n,0);
});
test('ongoing long-term signup keeps binding checks and does not modify hardware or other business tables',async t=>{
 const f=fixture(t),id=f.event(),unbound=f.member(false),revoked=f.member(),bound=f.member();f.db.raw.prepare('UPDATE devices SET revoked_at=? WHERE member_id=?').run(f.stamp,revoked.id);
 const tables=f.db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='event_registrations'").all().map(row=>row.name),before=tables.map(name=>[name,JSON.stringify(f.db.raw.prepare('SELECT * FROM "'+name+'"').all())]);
 for(const who of [unbound,revoked]){const r=await f.call(id,who);assert.equal(r.status,409);assert.match(r.data.error,/绑定/);}
 assert.equal((await f.call(id,bound)).status,200);
 for(const [name,rows]of before)assert.equal(JSON.stringify(f.db.raw.prepare('SELECT * FROM "'+name+'"').all()),rows,name);
});
test('long-term registration retains atomic capacity enforcement for both registration kinds',async t=>{
 const f=fixture(t),id=f.event({capacity:1,volunteers:1}),users=[f.member(),f.member()];
 for(const kind of ['attendees','volunteers']){const results=await Promise.all(users.map(user=>f.call(id,user,kind)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);}
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_registrations WHERE event_id=?').get(id).n,2);
});
test('website buttons and status use the end deadline only for published long-term events',()=>{
 const context=vm.createContext({document:{addEventListener(){}},setInterval(){},Date,Intl,statusText:s=>s});vm.runInContext(readFileSync(new URL('../public/event-tools.js',import.meta.url),'utf8'),context);
 const event={status:'published',starts_at:1000,ends_at:1000+14*86400};
 assert.equal(context.eventRegistrationOpen(event,1000),true);assert.equal(context.eventRegistrationOpen(event,event.ends_at-1),true);assert.equal(context.eventRegistrationOpen(event,event.ends_at),false);
 assert.equal(context.eventTimeLabel(event,1001),'进行中 · 可报名');assert.equal(context.eventTimeLabel(event,event.ends_at),'已结束');
 assert.equal(context.eventRegistrationOpen({...event,status:'cancelled'},1001),false);assert.equal(context.eventRegistrationOpen({...event,ends_at:2000},1000),false);
});
