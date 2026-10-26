import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {openDatabase,migrate} from '../database.js';
import api from '../api.js';
import {buildPlanetReports} from '../planet-reports.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const hash=v=>createHash('sha256').update(v).digest('hex'),time=value=>Date.parse(value)/1000;
function fixture(t){
 const db=openDatabase(':memory:');migrate(db);t.after(()=>db.close());const now=Math.floor(Date.now()/1000),origin='http://localhost:3334';
 function member(role='member'){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(id,id+'@example.test',role+'邻居',role,now,now);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,now+3600,now);return{id,token};}
 const admin=member('admin'),a=member(),b=member();
 function event(start=now+3600,end=start+1800,status='published',host=a){const id=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,'共同学习','说明','学习','教室',?,?,20,?,?,?,?)").run(id,start,end,host.id,status,now,now);return id;}
 function board(m){const id=randomUUID();db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(id,m.id,hash(id),now);return id;}
 async function call(path,who=admin,data,method=data?'PUT':'GET',requestOrigin=origin){const r=await api.fetch(new Request(origin+path,{method,headers:{Origin:requestOrigin,...(who?{Cookie:'popup_city_session='+who.token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{DB:db,AUTH_PEPPER:'website-options-test-pepper-00000000000',PUBLIC_ORIGIN:origin});return{status:r.status,data:await r.json()};}
 return{db,now,admin,a,b,event,board,call};
}
test('administrator pins persist for all viewers; retry is idempotent and unpin keeps the event intact',async t=>{
 const f=fixture(t),id=f.event(),path=`/api/admin/events/${id}/pin`;
 assert.equal((await f.call(path,f.a,{pinned:true})).status,403);assert.equal((await f.call(path,null,{pinned:true})).status,401);
 assert.equal((await f.call(path,f.admin,{pinned:true},'PUT','https://evil.example')).status,403);
 assert.equal((await f.call(path,f.admin,{pinned:true})).status,200);assert.equal((await f.call(path,f.admin,{pinned:true})).status,200);
 for(const viewer of [null,f.a,f.admin]){const event=(await f.call('/api/events',viewer)).data.events.find(e=>e.id===id);assert.equal(event.pinned,true);assert.ok(event.pinned_at);}
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM event_audit WHERE action='pin'").get().n,1);
 assert.equal((await f.call(path,f.admin,{pinned:false})).status,200);assert.equal((await f.call('/api/events',null)).data.events.find(e=>e.id===id).pinned,false);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM events').get().n,1);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM website_event_pins').get().n,0);
});
test('pinning rejects drafts, ended/deleted activities and invalid input; expired pins no longer display',async t=>{
 const f=fixture(t);for(const id of [f.event(f.now-7200,f.now-3600),f.event(f.now+3600,f.now+7200,'pending'),f.event(f.now+3600,f.now+7200,'cancelled')])assert.equal((await f.call(`/api/admin/events/${id}/pin`,f.admin,{pinned:true})).status,409);
 const id=f.event(),path=`/api/admin/events/${id}/pin`;assert.equal((await f.call(path,f.admin,{pinned:'yes'})).status,400);
 assert.equal((await f.call(path,f.admin,{pinned:true})).status,200);f.db.raw.prepare('UPDATE events SET ends_at=?,starts_at=? WHERE id=?').run(f.now-1,f.now-3600,id);
 assert.equal((await f.call('/api/events',null)).data.events.find(e=>e.id===id).pinned,false);
 f.db.raw.prepare('INSERT INTO event_deletions VALUES(?,?,?)').run(id,f.admin.id,f.now);assert.equal((await f.call(path,f.admin,{pinned:false})).status,404);
});
test('pin audit failure rolls back the pin without modifying events or registrations',async t=>{
 const f=fixture(t),id=f.event();f.db.raw.exec("CREATE TRIGGER reject_pin BEFORE INSERT ON event_audit WHEN NEW.action='pin' BEGIN SELECT RAISE(ABORT,'test unavailable'); END");
 assert.equal((await f.call(`/api/admin/events/${id}/pin`,f.admin,{pinned:true})).status,500);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM website_event_pins').get().n,0);
 assert.equal(f.db.raw.prepare('SELECT host_id FROM events WHERE id=?').get(id).host_id,f.a.id);
});
test('reports unlock at UTC+8 phase boundaries, use authenticated ownership and never mutate data',async t=>{
 const f=fixture(t),db=f.db.raw;
 assert.equal(buildPlanetReports(f.db,f.a.id,time('2026-10-25T23:59:59+08:00')).reports[0].open,false);
 const first=buildPlanetReports(f.db,f.a.id,time('2026-10-26T00:00:00+08:00'));assert.equal(first.reports[0].open,true);assert.equal(first.reports[1].open,false);
 assert.equal(buildPlanetReports(f.db,f.a.id,time('2026-11-02T00:00:00+08:00')).reports[1].open,true);
 const event=f.event(time('2026-10-21T10:00:00+08:00'),time('2026-10-21T11:00:00+08:00')),device=f.board(f.a);
 db.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(event,f.a.id,device,time('2026-10-21T09:30:00+08:00'),'verified-checkin');
 const before=Array.from(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(),r=>[r.name,JSON.stringify(db.prepare(`SELECT * FROM "${r.name}"`).all())]);
 const report=buildPlanetReports(f.db,f.a.id,time('2026-10-26T09:00:00+08:00')).reports[0];assert.deepEqual(report.counts,{checkins:1,days:1,hosted:0,friends:0});assert.equal(report.records.checkins[0].id,event);assert.equal(report.archive_status,'not_archived');assert.equal(report.snapshot,undefined);
 assert.equal(buildPlanetReports(f.db,f.b.id,time('2026-10-26T09:00:00+08:00')).reports[0].counts.checkins,0);
 for(const [name,rows] of before)assert.equal(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()),rows,name);
 assert.equal((await f.call('/api/herstory/planet-reports',null)).status,401);
 assert.equal((await f.call('/api/herstory/planet-reports?user_id='+f.b.id,f.a)).data.owner.id,f.a.id);
});
test('reports respect verified corrections, original friendship times and actual hosting review facts',t=>{
 const f=fixture(t),db=f.db.raw,stamp=time('2026-10-26T09:00:00+08:00'),event=f.event(time('2026-10-21T10:00:00+08:00'),time('2026-10-21T11:00:00+08:00')),device=f.board(f.a);
 db.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(event,f.a.id,device,time('2026-10-21T09:30:00+08:00'),'verified');
 db.prepare('INSERT INTO planet_fact_corrections(member_id,kind,event_id,valid,reason,corrected_by,corrected_at) VALUES(?,\'checkin\',?,0,\'核实纠正\',?,?)').run(f.a.id,event,f.admin.id,stamp);
 db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(randomUUID(),f.a.id,f.b.id,device,time('2026-10-22T12:00:00+08:00'),randomUUID());
 db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(randomUUID(),f.a.id,f.b.id,device,time('2026-10-23T12:00:00+08:00'),randomUUID());
 db.prepare('INSERT INTO planet_role_reviews VALUES(?,?,\'host\',?,?,?,?)').run(randomUUID(),f.a.id,event,'真实举办',f.admin.id,stamp);
 const report=buildPlanetReports(f.db,f.a.id,stamp).reports[0];assert.deepEqual(report.counts,{checkins:0,days:0,hosted:1,friends:1});assert.equal(report.records.friends[0].established_at,time('2026-10-22T12:00:00+08:00'));
});
test('original report presenter shows server phase boundaries and late verified facts without fabricating categories or archives',t=>{
 const f=fixture(t),db=f.db.raw,stamp=time('2026-10-26T09:00:00+08:00'),device=f.board(f.a);
 const events=['学习','自由漫游','constructor'].map(category=>{const id=f.event(time('2026-10-21T10:00:00+08:00'),time('2026-10-21T11:00:00+08:00'));db.prepare('UPDATE events SET category=? WHERE id=?').run(category,id);db.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(id,f.a.id,device,time('2026-10-21T10:30:00+08:00'),randomUUID());return id;});
 db.prepare('INSERT INTO planet_role_reviews VALUES(?,?,\'host\',?,?,?,?)').run(randomUUID(),f.a.id,events[1],'活动结束后核实',f.admin.id,stamp);
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},Date,Intl});
 vm.runInContext(readFileSync(new URL('../vendor/planet/frontend/ui-design/report-model.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/planet-reports.js',import.meta.url),'utf8'),context);
 const model=context.window.HerstoryReportModel,base=model.build('week',null,{userId:f.a.id}),data=buildPlanetReports(f.db,f.a.id,stamp);
 const view=context.websitePlanetReport(model,base,data.reports[0]);
 assert.equal(view.status.open,true);assert.equal(view.status.opensAt,'2026-10-26T00:00:00+08:00');
 assert.equal(view.counts.participated,3);assert.equal(view.counts.learning,1);assert.equal(view.counts.creation,0);assert.equal(view.counts.entertainment,0);
 assert.equal(view.rows.length,3);assert.equal(model.categories[view.rows.find(row=>row.activity_id===events[1]).category].label,'自由漫游');assert.equal(Object.keys(model.categories).length,3);
 assert.equal(view.hostCount,1);assert.equal(view.contributions[0].activity_id,events[1]);assert.equal(view.contributions[0].partners,null);
 assert.equal(view.snapshot,null);assert.equal(view.finalized,false);assert.equal(view.freezeEligible,false);assert.match(view.issues.join(' '),/未换算/);
 const locked=context.websitePlanetReport(model,model.build('full',null,{userId:f.a.id}),data.reports[1]);assert.equal(locked.status.open,false);assert.equal(locked.counts,null);
});
