import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { openDatabase,migrate,checkSchema } from '../database.js';
const stamp=()=>Math.floor(Date.now()/1000);
const insert=(db,table,row)=>db.raw.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
function fixture(path=':memory:'){
 const db=openDatabase(path);migrate(db);const t=stamp();
 for(const [id,role] of [['reviewer','admin'],['alice','member'],['bob','member']])insert(db,'members',{id,email:`${id}@example.test`,nickname:id,role,status:'active',created_at:t,updated_at:t});
 insert(db,'programs',{id:'p1',name:'Test program',starts_at:t-10000,ends_at:t+10000,status:'active',created_at:t,updated_at:t});
 insert(db,'programs',{id:'p2',name:'Other program',starts_at:t-10000,ends_at:t+10000,created_at:t,updated_at:t});
 insert(db,'activity_types',{id:'TEST-001',name:'Test type',category:'learning',world_area:'city',created_at:t});
 for(const [id,kind] of [['r1','activity'],['rp','long_term_project']])for(const v of [1,2])insert(db,'growth_rules',{rule_id:id,rule_version:v,type_id:'TEST-001',event_kind:kind,name:'Test rule only',definition_json:'{"test_only":true}',created_by:'reviewer',created_at:t});
 for(const [id,kind,rule] of [['e1','activity','r1'],['e2','activity','r1'],['project','long_term_project','rp']]){
  insert(db,'events',{id,title:id,description:'test',category:'Legacy free text',location:'test',starts_at:t-120,ends_at:t-60,capacity:10,volunteer_capacity:2,host_id:'alice',status:'published',created_at:t,updated_at:t});
  insert(db,'event_growth_config',{event_id:id,program_id:'p1',type_id:'TEST-001',event_kind:kind,rule_id:rule,rule_version:1,configured_by:'reviewer',created_at:t});
 }
 insert(db,'devices',{id:'device',member_id:'alice',token_hash:'test',created_at:t});
 for(const event of ['e1','e2'])insert(db,'checkins',{event_id:event,member_id:'alice',device_id:'device',checked_at:t-180,request_id:event});
 insert(db,'asset_definitions',{id:'test-school',name:'Test only',asset_kind:'building',slot_key:'test-slot',created_at:t});
 function fact(table,overrides={}){const row={id:randomUUID(),event_id:table==='project_submissions'?'project':'e1',member_id:'alice',status:'verified',verified_by:'reviewer',verified_at:t,created_at:t,updated_at:t,...(table==='project_submissions'?{contribution_key:'test-contribution',title:'test'}:{}),...overrides};insert(db,table,row);return row}
 function reward(overrides={}){const row={id:randomUUID(),member_id:'alice',event_id:'e1',program_id:'p1',rule_id:'r1',rule_version:1,source_kind:'checkin',checkin_event_id:'e1',metric:'P',amount:1,idempotency_key:randomUUID(),reason:'Test settlement',calculation_json:'{"test_only":true}',created_by:'reviewer',created_at:t,...overrides};insert(db,'reward_ledger',row);return row}
 function reverse(row,overrides={}){return reward({...row,id:randomUUID(),amount:-row.amount,reversal_of:row.id,idempotency_key:randomUUID(),reason:'Test reversal',...overrides})}
 return {db,t,fact,reward,reverse};
}

test('growth migration is additive, checksum-protected, repeatable and rolls back interruption',()=>{
 const db=openDatabase(':memory:');
 try{
  db.raw.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
  for(const name of ['0001_initial.sql','0002_event_covers.sql','0003_member_roles_and_interests.sql']){const sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');db.raw.exec(sql);insert(db,'schema_migrations',{name,checksum:createHash('sha256').update(sql).digest('hex')})}
  insert(db,'members',{id:'old',email:'old@example.test',nickname:'Preserve',created_at:1,updated_at:1});
  insert(db,'events',{id:'old-event',title:'Preserve event',description:'old',category:'old-category',location:'old',starts_at:1,ends_at:2,capacity:10,host_id:'old',status:'published',created_at:1,updated_at:1});
  insert(db,'sessions',{token_hash:'session',member_id:'old',expires_at:9999999999,created_at:1});
  const snapshot=JSON.stringify(db.raw.prepare('SELECT * FROM events').all());
  const sql=readFileSync(new URL('../migrations/0004_growth_system.sql',import.meta.url),'utf8');
  db.raw.exec('BEGIN IMMEDIATE');db.raw.exec(sql);db.raw.exec('ROLLBACK');
  assert.equal(db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='programs'").get(),undefined);
  migrate(db);migrate(db);checkSchema(db);
  assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM events').all()),snapshot);
  assert.equal(db.raw.prepare('SELECT member_id FROM sessions').get().member_id,'old');
  for(const table of ['programs','activity_types','growth_rules','event_growth_config','reward_ledger','user_assets'])assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close()}
});

test('rule versions are immutable; mismatched program, rule and member cannot settle',()=>{
 const f=fixture();try{
  assert.throws(()=>f.db.raw.exec("UPDATE growth_rules SET definition_json='{}'"),/immutable/);
  assert.throws(()=>f.db.raw.exec('DELETE FROM growth_rules'),/immutable/);
  assert.throws(()=>f.db.raw.exec("UPDATE event_growth_config SET event_kind='closing' WHERE event_id='e1'"),/FOREIGN KEY/);
  for(const overrides of [{program_id:'p2'},{rule_version:2},{member_id:'bob'},{event_id:'e2'}])assert.throws(()=>f.reward(overrides));
  f.reward();assert.throws(()=>f.db.raw.exec("UPDATE event_growth_config SET rule_version=2 WHERE event_id='e1'"),/FOREIGN KEY/);
  assert.equal(f.db.raw.prepare('SELECT total FROM member_growth_totals').get().total,1);
  assert.throws(()=>f.reward({idempotency_key:'different-key'}),/UNIQUE/);
  assert.throws(()=>f.reward({event_id:'e2',checkin_event_id:'e2',amount:2}),/CHECK/);
 }finally{f.db.close()}
});

test('host and volunteer rewards require correct, independently verified completion facts',()=>{
 const f=fixture();try{
  assert.throws(()=>f.fact('host_completions',{member_id:'bob'}),/does not match/);
  assert.throws(()=>f.fact('host_completions',{verified_by:'alice'}),/administrator|CHECK/);
  const host=f.fact('host_completions',{status:'pending',verified_by:null,verified_at:null});
  const source={source_kind:'host',checkin_event_id:null,host_completion_id:host.id,metric:'H'};
  assert.throws(()=>f.reward(source),/not verified/);
  f.db.raw.prepare("UPDATE host_completions SET status='verified',verified_by='reviewer',verified_at=? WHERE id=?").run(f.t,host.id);
  const earned=f.reward(source);
  assert.throws(()=>f.db.raw.prepare("UPDATE host_completions SET status='revoked' WHERE id=?").run(host.id),/reverse rewards/);
  f.reverse(earned);f.db.raw.prepare("UPDATE host_completions SET status='revoked' WHERE id=?").run(host.id);
  assert.throws(()=>f.db.raw.prepare("UPDATE host_completions SET status='verified' WHERE id=?").run(host.id),/immutable/);
  assert.throws(()=>f.fact('volunteer_completions'),/does not match/);
  insert(f.db,'event_registrations',{event_id:'e1',member_id:'alice',kind:'volunteer',created_at:f.t});
  const volunteer=f.fact('volunteer_completions');f.reward({source_kind:'volunteer',checkin_event_id:null,volunteer_completion_id:volunteer.id,metric:'V'});
  assert.equal(f.db.raw.prepare("SELECT total FROM member_growth_totals WHERE metric='V'").get().total,1);
 }finally{f.db.close()}
});

test('long-term project contribution is separate from attendance and deduplicated by contribution key',()=>{
 const f=fixture();try{
  assert.throws(()=>f.fact('project_submissions',{event_id:'e1'}),/does not match/);
  const contribution=f.fact('project_submissions');assert.throws(()=>f.fact('project_submissions'),/UNIQUE/);
  const source={event_id:'project',rule_id:'rp',source_kind:'project',checkin_event_id:null,project_submission_id:contribution.id,metric:'M'};
  f.reward(source);assert.throws(()=>f.reward(source),/UNIQUE/);
  assert.throws(()=>f.reward({...source,member_id:'bob'}),/FOREIGN KEY/);
  assert.throws(()=>f.db.raw.prepare("UPDATE project_submissions SET evidence_json='{\"changed\":true}' WHERE id=?").run(contribution.id),/immutable/);
 }finally{f.db.close()}
});

test('ledger and asset projection are atomic, append-only, and support exact one-time reversals',()=>{
 const f=fixture();try{
  const a=f.reward({metric:null,asset_id:'test-school',asset_level:1});
  const b=f.reward({event_id:'e2',checkin_event_id:'e2',metric:null,asset_id:'test-school',asset_level:2});
  assert.equal(f.db.raw.prepare('SELECT asset_level FROM user_assets').get().asset_level,2);
  assert.throws(()=>f.db.raw.exec('UPDATE reward_ledger SET amount=9'),/append only/);
  assert.throws(()=>f.db.raw.exec('DELETE FROM reward_ledger'),/append only/);
  assert.throws(()=>f.reverse(b,{asset_level:1}),/exactly negate/);
  f.reverse(b);assert.equal(f.db.raw.prepare('SELECT asset_level FROM user_assets').get().asset_level,1);
  assert.throws(()=>f.reverse(b),/UNIQUE/);
  f.reverse(a);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM user_assets').get().n,0);
  assert.throws(()=>insert(f.db,'user_assets',{member_id:'alice',program_id:'p1',asset_id:'test-school',asset_level:1,source_ledger_id:a.id,updated_at:f.t}),/unreversed/);
  const before=f.db.raw.prepare('SELECT COUNT(*) n FROM reward_ledger').get().n;
  f.db.raw.exec("CREATE TRIGGER fail_asset BEFORE INSERT ON user_assets BEGIN SELECT RAISE(ABORT,'test projection failure'); END");
  assert.throws(()=>f.reward({metric:null,asset_id:'test-school',asset_level:3}),/projection failure/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM reward_ledger').get().n,before);
 }finally{f.db.close()}
});

test('bad check-ins and unprivileged settlement cannot create rewards',()=>{
 const f=fixture();try{
  assert.throws(()=>f.reward({created_by:'alice'}),/administrator/);
  f.db.raw.exec("UPDATE events SET status='cancelled' WHERE id='e1'");assert.throws(()=>f.reward(),/published/);
  f.db.raw.exec("UPDATE events SET status='published' WHERE id='e1'; UPDATE checkins SET checked_at=0 WHERE event_id='e1'");assert.throws(()=>f.reward(),/valid window/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM reward_ledger').get().n,0);
 }finally{f.db.close()}
});

test('concurrent duplicate settlement creates one reward; lock timeout and retry preserve data',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'popup-growth-')),path=join(directory,'test.sqlite'),f=fixture(path);
 try{
  const row={id:'a',member_id:'alice',event_id:'e1',program_id:'p1',rule_id:'r1',rule_version:1,source_kind:'checkin',checkin_event_id:'e1',metric:'P',amount:1,idempotency_key:'a',reason:'test',calculation_json:'{}',created_by:'reviewer',created_at:f.t};
  const query=`INSERT INTO reward_ledger(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`;
  const writer=n=>new Promise((resolve,reject)=>{const values=Object.values({...row,id:n,idempotency_key:n});const w=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');try{db.prepare(workerData.query).run(...workerData.values);parentPort.postMessage('ok')}catch(e){parentPort.postMessage(e.message)}finally{db.close()}`,{eval:true,workerData:{path,query,values}});w.once('message',resolve);w.once('error',reject)});
  const results=await Promise.all([writer('first'),writer('second')]);assert.equal(results.filter(x=>x==='ok').length,1);assert.ok(results.some(x=>x.includes('UNIQUE')));
  const other=openDatabase(path);other.raw.exec('PRAGMA busy_timeout=1');f.db.raw.exec('BEGIN IMMEDIATE');
  assert.throws(()=>other.raw.exec("UPDATE programs SET name='Blocked' WHERE id='p1'"),/locked/);f.db.raw.exec('ROLLBACK');other.raw.exec("UPDATE programs SET name='Retry' WHERE id='p1'");other.close();
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM reward_ledger').get().n,1);assert.equal(f.db.raw.prepare("SELECT name FROM programs WHERE id='p1'").get().name,'Retry');
 }finally{f.db.close();rmSync(directory,{recursive:true,force:true})}
});

test('backup CLI captures an existing WAL database and refuses to overwrite a backup', async()=>{
 const {spawnSync}=await import('node:child_process');
 const directory=mkdtempSync(join(tmpdir(),'popup-backup-')),path=join(directory,'source.sqlite'),f=fixture(path);
 try{
  const env={...process.env,AUTH_PEPPER:'backup-test-00000000000000000000000000',DATABASE_PATH:path,NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3300',PUBLIC_ORIGIN:'http://127.0.0.1:3300',MAIL_MODE:'disabled'};
  const run=()=>spawnSync(process.execPath,[new URL('../backup.js',import.meta.url).pathname,'backup-test.sqlite'],{env,encoding:'utf8'});
  assert.equal(run().status,0);assert.notEqual(run().status,0);
  const copy=openDatabase(join(directory,'backup-test.sqlite'));checkSchema(copy);assert.equal(copy.raw.prepare('SELECT COUNT(*) n FROM events').get().n,3);assert.equal(copy.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');copy.close();
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM events').get().n,3);
 }finally{f.db.close();rmSync(directory,{recursive:true,force:true})}
});
