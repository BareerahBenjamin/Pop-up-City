import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {openDatabase,migrate} from '../database.js';
import api from '../api.js';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sha=value=>createHash('sha256').update(value).digest('hex');
const html=Buffer.from('<!doctype html><html lang="zh-CN"><body><h1>课程讲义</h1><script>document.body.dataset.ready="yes"</script></body></html>');
const input=(content=html,filename='导师课件.html')=>({title:'课堂讲义',filename,content:content.toString('base64')});
function fixture(t){
 const db=openDatabase(':memory:');migrate(db);t.after(()=>db.close());const stamp=Math.floor(Date.now()/1000),origin='http://localhost:3334';
 function member(role='member',status='active'){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare('INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@example.test',role+'用户',role,status,stamp,stamp);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),id,stamp+3600,stamp);return {id,token};}
 const admin=member('admin'),host=member(),next=member(),other=member(),invited=member('member','invited'),disabled=member('member','disabled');
 function event(status='published',owner=host,starts=stamp-7200){const id=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,'课程','说明','学习','教室',?,?,20,?,?,?,?)").run(id,starts,starts+3600,owner.id,status,stamp,stamp);return id;}
 const id=event();
 async function response(path,who=admin,data,method=data?'POST':'GET',originHeader=origin){return api.fetch(new Request(origin+path,{method,headers:{Origin:originHeader,...(who?{Cookie:'popup_city_session='+who.token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{DB:db,AUTH_PEPPER:'isolated-material-test-pepper-00000000000',PUBLIC_ORIGIN:origin});}
 async function call(...args){const r=await response(...args);return{status:r.status,data:await r.json()};}
 return {db,stamp,admin,host,next,other,invited,disabled,event,id,call,response,materials:`/api/events/${id}/materials`};
}
test('ended courses allow host/admin upload, edit, replace and versioned delete; guests read published files',async t=>{
 const f=fixture(t);const created=await f.call(f.materials,f.host,input());assert.equal(created.status,201);const m=created.data.material;
 assert.equal(m.filename,'导师课件.html');assert.equal(m.version,1);
 const list=await f.call(f.materials,null);assert.equal(list.status,200);assert.equal(list.data.can_manage,false);assert.equal(list.data.materials[0].id,m.id);assert.equal(list.data.materials[0].content,undefined);
 const downloaded=await f.response(m.download_url,null);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),html);assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);
 const preview=await f.response(m.preview_url,null);assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.doesNotMatch(preview.headers.get('content-security-policy'),/allow-same-origin/);assert.equal(preview.headers.get('x-frame-options'),'SAMEORIGIN');
 let edited=await f.call(`${f.materials}/${m.id}`,f.admin,{title:'改名讲义',version:1},'PATCH');assert.equal(edited.status,200);assert.equal(edited.data.material.version,2);
 assert.equal((await f.call(`${f.materials}/${m.id}`,f.host,{title:'旧版本',version:1},'PATCH')).status,409);
 const replacement=Buffer.from('<html><body><h1>修订讲义</h1></body></html>');edited=await f.call(`${f.materials}/${m.id}`,f.host,{...input(replacement,'修订版.html'),version:2},'PATCH');assert.equal(edited.status,200);assert.equal(edited.data.material.version,3);
 assert.deepEqual(Buffer.from(await (await f.response(m.download_url,null)).arrayBuffer()),replacement);
 assert.equal((await f.call(`${f.materials}/${m.id}`,f.host,{version:2},'DELETE')).status,409);
 assert.equal((await f.call(`${f.materials}/${m.id}`,f.host,{version:3},'DELETE')).status,200);assert.equal((await f.call(f.materials,null)).data.materials.length,0);
 assert.deepEqual(f.db.raw.prepare('SELECT action FROM event_material_audit ORDER BY rowid').all().map(r=>r.action),['upload','edit','edit','delete']);
});
test('private courses, deleted courses, unrelated members and foreign origins cannot access or change courseware',async t=>{
 const f=fixture(t),id=f.event('pending'),path=`/api/events/${id}/materials`;
 const m=(await f.call(path,f.host,input())).data.material;
 for(const who of [null,f.other]){assert.equal((await f.call(path,who)).status,404);assert.equal((await f.response(m.download_url,who)).status,404);}
 assert.equal((await f.call(path,f.other,input())).status,403);assert.equal((await f.call(path,null,input())).status,401);
 assert.equal((await f.call(path,f.host,input(),'POST','https://evil.example')).status,403);
 assert.equal((await f.call(path,f.admin)).status,200);
 f.db.raw.prepare('INSERT INTO event_deletions VALUES(?,?,?)').run(id,f.admin.id,f.stamp);
 assert.equal((await f.call(path,f.host)).status,404);assert.equal((await f.response(m.preview_url,f.admin)).status,404);assert.equal((await f.call(path,f.admin,input())).status,404);
});
test('invalid types, malformed files and oversize uploads fail without partial records',async t=>{
 const f=fixture(t);
 for(const payload of [input(html,'../讲义.html'),input(html,'讲义.exe'),input(Buffer.from('text'),'讲义.html'),input(Buffer.from('PK\x03\x04[Content_Types].xml ppt/presentation.xml'),'讲义.pptx'),input(html,'讲义.ppt'),{...input(),content:'@@@@'},{...input(),title:' '}])assert.equal((await f.call(f.materials,f.host,payload)).status,400);
 assert.equal((await f.call(f.materials,f.host,input(Buffer.alloc(20*1024*1024+1),'讲义.ppt'))).status,413);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_materials').get().n,0);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_material_audit').get().n,0);
});
test('material quota and audit errors roll back without changing saved materials',async t=>{
 const f=fixture(t);for(let i=0;i<20;i++)assert.equal((await f.call(f.materials,f.host,input())).status,201);
 assert.equal((await f.call(f.materials,f.host,input())).status,409);
 const item=(await f.call(f.materials,f.host)).data.materials[0];
 f.db.raw.exec("CREATE TRIGGER reject_material_edit BEFORE INSERT ON event_material_audit WHEN NEW.action='edit' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.equal((await f.call(`${f.materials}/${item.id}`,f.host,{title:'不能写入',version:1},'PATCH')).status,500);
 const row=f.db.raw.prepare('SELECT title,version FROM event_materials WHERE id=?').get(item.id);assert.equal(row.title,'课堂讲义');assert.equal(row.version,1);
});
test('valid PPT/PPTX uploads download as attachments with exact bytes and no HTML preview',async t=>{
 const f=fixture(t);
 for(const [name,bytes] of [['演示文稿.pptx',readFileSync(new URL('./fixtures/courseware.pptx',import.meta.url))],['旧版课件.ppt',Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'),Buffer.alloc(504)])]]){
  const r=await f.call(f.materials,f.host,input(bytes,name));assert.equal(r.status,201);assert.equal(r.data.material.preview_url,undefined);
  const response=await f.response(r.data.material.download_url,null);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await f.response(r.data.material.download_url.replace('/download','/preview'),null)).status,400);
 }
});
test('materials and audit survive database reopen; upgrade preserves all existing table data',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'courseware-persistence-')),path=join(dir,'isolated.sqlite');let db=openDatabase(path);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 // Build the pre-feature schema first, then upgrade only this isolated file.
 db.raw.exec('PRAGMA application_id=1213219633; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n!=='0018_event_materials.sql').sort()){
  const sql=readFileSync(new URL(name,directory),'utf8');db.raw.exec(sql);db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name,sha(sql));
 }
 const member=randomUUID(),event=randomUUID(),stamp=Math.floor(Date.now()/1000),token=randomBytes(32).toString('hex');
 db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,'导师','active',?,?)").run(member,'fake@example.test',stamp,stamp);
 db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,'结束课程','说明','学习','教室',?,?,20,?,'published',?,?)").run(event,stamp-7200,stamp-3600,member,stamp,stamp);
 db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),member,stamp+3600,stamp);
 const before=db.raw.prepare('SELECT * FROM members').all(),url=`http://localhost:3334/api/events/${event}/materials`;
 const tables=db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations'").all().map(r=>r.name);
 const oldRows=new Map(tables.map(name=>[name,db.raw.prepare(`SELECT * FROM "${name}"`).all()]));
 migrate(db);for(const [name,rows] of oldRows)assert.deepEqual(db.raw.prepare(`SELECT * FROM "${name}"`).all(),rows,name);
 const response=await api.fetch(new Request(url,{method:'POST',headers:{Origin:'http://localhost:3334',Cookie:'popup_city_session='+token,'Content-Type':'application/json'},body:JSON.stringify(input())}),{DB:db,AUTH_PEPPER:'isolated-material-test-pepper-00000000000',PUBLIC_ORIGIN:'http://localhost:3334'});assert.equal(response.status,201);
 db.close();db=openDatabase(path);migrate(db);assert.deepEqual(db.raw.prepare('SELECT * FROM members').all(),before);
 assert.deepEqual(Buffer.from(db.raw.prepare('SELECT content FROM event_materials WHERE event_id=?').get(event).content),html);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_material_audit').get().n,1);
 assert.equal(db.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('host reassignment changes only event ownership plus audit; new host inherits website management',async t=>{
 const f=fixture(t),path=`/api/admin/events/${f.id}/host`,data={host_id:f.next.id,previous_host_id:f.host.id};
 const device=randomUUID();f.db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(device,f.host.id,sha('fake-device'),f.stamp);
 f.db.raw.prepare('INSERT INTO hardware_host_grants VALUES(?,?,?)').run(device,f.id,f.admin.id);
 const deviceBefore=f.db.raw.prepare('SELECT * FROM devices').all(),grantsBefore=f.db.raw.prepare('SELECT * FROM hardware_host_grants').all();
 const m=(await f.call(f.materials,f.host,input())).data.material;
 f.db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(f.id,f.other.id,f.stamp);
 const before=f.db.raw.prepare('SELECT * FROM events WHERE id=?').get(f.id);
 const list=(await f.call('/api/admin/event-hosts')).data.members;assert.ok(list.some(m=>m.id===f.next.id));assert.ok(!list.some(m=>[f.invited.id,f.disabled.id].includes(m.id)));
 assert.equal((await f.call(path,f.host,data,'PATCH')).status,403);
 for(const candidate of [f.invited,f.disabled,{id:randomUUID()}])assert.equal((await f.call(path,f.admin,{...data,host_id:candidate.id},'PATCH')).status,400);
 assert.equal((await f.call(path,f.admin,data,'PATCH')).status,200);
 const after=f.db.raw.prepare('SELECT * FROM events WHERE id=?').get(f.id);assert.equal(after.host_id,f.next.id);for(const key of Object.keys(before).filter(k=>!['host_id','updated_at'].includes(k)))assert.equal(after[key],before[key],key);
 assert.equal((await f.call(f.materials,f.host)).data.can_manage,false);assert.equal((await f.call(`${f.materials}/${m.id}`,f.host,{title:'旧发起人',version:1},'PATCH')).status,403);
 assert.equal((await f.call(`${f.materials}/${m.id}`,f.next,{title:'新发起人',version:1},'PATCH')).status,200);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_registrations').get().n,1);assert.deepEqual(f.db.raw.prepare('SELECT * FROM devices').all(),deviceBefore);assert.deepEqual(f.db.raw.prepare('SELECT * FROM hardware_host_grants').all(),grantsBefore);
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM event_audit WHERE action='change-host'").get().n,1);
 assert.equal((await f.call(path,f.admin,data,'PATCH')).status,409);
});
test('host changes reject conflicting schedules and deleted events atomically',async t=>{
 const f=fixture(t),path=`/api/admin/events/${f.id}/host`,data={host_id:f.next.id,previous_host_id:f.host.id};f.event('published',f.next);
 assert.equal((await f.call(path,f.admin,data,'PATCH')).status,409);assert.equal(f.db.raw.prepare('SELECT host_id FROM events WHERE id=?').get(f.id).host_id,f.host.id);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_audit').get().n,0);
 f.db.raw.prepare('INSERT INTO event_deletions VALUES(?,?,?)').run(f.id,f.admin.id,f.stamp);assert.equal((await f.call(path,f.admin,data,'PATCH')).status,404);
});

test('website host reassignment is reflected in existing hardware runtime without rewriting device identities',async t=>{
 const f=fixture(t),id=f.event('published',f.host,f.stamp-30);
 const board=member=>{const b={id:randomUUID(),member_id:member.id,token_hash:sha(randomBytes(32).toString('hex'))};f.db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(b.id,b.member_id,b.token_hash,f.stamp);return b;};
 const oldBoard=board(f.host),newBoard=board(f.next);
 const {runtimeState}=await import('../hardware-cloud/runtime.mjs');
 assert.equal(runtimeState(f.db,oldBoard).host.active_activity_id,id);
 assert.equal(runtimeState(f.db,newBoard).host.can_check_in,false);
 const identities=f.db.raw.prepare('SELECT * FROM devices ORDER BY id').all();
 assert.equal((await f.call('/api/admin/events/'+id+'/host',f.admin,{host_id:f.next.id,previous_host_id:f.host.id},'PATCH')).status,200);
 assert.equal(runtimeState(f.db,oldBoard).host.can_check_in,false);
 assert.equal(runtimeState(f.db,newBoard).host.active_activity_id,id);
 assert.deepEqual(f.db.raw.prepare('SELECT * FROM devices ORDER BY id').all(),identities);
});
test('courseware size limit does not change device request limits',async()=>{
 const {bodyLimit}=await import('../covers.js');
 const id=randomUUID();
 assert.ok(bodyLimit('POST','/api/events/'+id+'/materials')>20*1024*1024);
 for(const path of ['/local/host/submit','/api/device/runtime','/api/device/host/batches','/api/device-enrollment/register'])assert.equal(bodyLimit('POST',path),16000);
});
