import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../database.js';
import { planetSnapshot, loginDestination } from '../planet.js';
import api from '../api.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const source = readFileSync(new URL('../public/assets/avatar-preview-catalog.js', import.meta.url), 'utf8');
const catalog = JSON.parse(source.slice(source.indexOf(' = ') + 3).trim().replace(/;$/, ''));
const avatar = { release: catalog.release, selection: Object.fromEntries(catalog.layers.filter(l => l.selectable).map(l => [l.id, catalog.assets.find(a => a.layer === l.id).id])) };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'planet-test-')), path = join(dir, 'test.sqlite'), db = openDatabase(path); migrate(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const stamp = Math.floor(Date.now()/1000), env = { DB: db, AUTH_PEPPER: 'isolated-planet-test-pepper-000000000000', PUBLIC_ORIGIN: 'http://localhost:3334' };
  function user(name, role = 'member') {
    const id = randomUUID(), token = hash(id);
    db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(id, id+'@example.test', name, role, stamp, stamp);
    db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token), id, stamp+3600, stamp);
    return { id, token };
  }
  async function call(path, actor, body, method = body ? 'POST' : 'GET') {
    const r = await api.fetch(new Request(env.PUBLIC_ORIGIN+path, { method, headers: { Origin: env.PUBLIC_ORIGIN, ...(actor ? { Cookie: 'popup_city_session='+actor.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    const text = await r.text(); return { status: r.status, headers: r.headers, data: r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  }
  return { db, path, user, call, stamp };
}
test('planet identity persists, cannot be reassigned, rejects anonymous reads and ignores requested owner', async t => {
  const f=fixture(t),a=f.user('甲'),b=f.user('乙');
  assert.equal((await f.call('/api/herstory/planet-state')).status,401);
  const many=await Promise.all(Array.from({length:20},()=>f.call('/api/herstory/planet-state?userId='+b.id,a)));
  const first=many[0].data;
  assert.equal(new Set(many.map(r=>r.data.planetId)).size,1);assert.equal(first.userId,a.id);
  assert.equal(first.day,0);assert.equal('pixelPlanet' in first,false);
  assert.equal(first.integration.growthStatus,'pending_rules');
  const other=(await f.call('/api/herstory/planet-state',b)).data;assert.notEqual(first.planetId,other.planetId);
  const secondConnection=openDatabase(f.path);try {assert.deepEqual(planetSnapshot(secondConnection,a.id),first);}finally{secondConnection.close();}
  assert.throws(()=>f.db.raw.prepare('UPDATE member_planets SET planet_id=? WHERE member_id=?').run(randomUUID(),a.id),/permanent/);
  f.db.raw.prepare("UPDATE members SET status='disabled' WHERE id=?").run(a.id);
  assert.equal((await f.call('/api/herstory/planet-state',a)).status,401);
});
test('planet uses deduplicated authenticated exchanges, first encounter time and coherent revisions', async t=>{
  const f=fixture(t),a=f.user('甲'),b=f.user('</script><b>乙'),c=f.user('不应泄露');
  const device=randomUUID();f.db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(device,a.id,hash(device),f.stamp);
  const insert=(from,to,when)=>f.db.raw.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(randomUUID(),from,to,device,when,randomUUID());
  const before=(await f.call('/api/herstory/planet-state',a)).data;
  insert(a.id,b.id,f.stamp-100);insert(b.id,a.id,f.stamp);
  const next=(await f.call('/api/herstory/planet-state',a)).data;
  assert.equal(next.connections.length,1);assert.equal(next.connections[0].id,b.id);assert.equal(next.connections[0].established_at,new Date((f.stamp-100)*1000).toISOString());assert.ok(next.revision>before.revision);
  insert(a.id,b.id,f.stamp+1);assert.equal((await f.call('/api/herstory/planet-state',a)).data.revision,next.revision);
  assert.equal((await f.call('/api/herstory/planet-state',c)).data.connections.length,0);
  const page=await f.call('/planet',a);assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.ok(!page.data.includes('</script><b>乙'));assert.ok(page.data.includes('\\u003c/script\\u003e'));
  f.db.raw.prepare("UPDATE members SET status='disabled' WHERE id=?").run(b.id);
  const removed=(await f.call('/api/herstory/planet-state',a)).data;assert.equal(removed.connections.length,0);assert.ok(removed.revision>next.revision);
});
test('avatar finalizes once while ordinary profile remains editable by member and admin', async t=>{
  const f=fixture(t),a=f.user('甲'),admin=f.user('管理','admin');
  assert.equal(loginDestination(f.db,a.id),'/#planet/welcome');
  await f.call('/api/herstory/planet-onboarding',a,{});assert.equal(loginDestination(f.db,a.id),'/#setup');
  const body={nickname:'确认名字',bio:'自我介绍',skills:'绘画',needs:'朋友',avatar,card_public:false,finalize:true};
  assert.equal((await f.call('/api/admin/members/'+a.id,admin,{avatar},'PATCH')).status,403);
  assert.equal((await f.call('/api/me',a,{...body,avatar:{}},'PATCH')).status,400);
  assert.equal((await f.call('/api/me',a,{...body,finalize:false},'PATCH')).status,400);
  const results=await Promise.all([f.call('/api/me',a,body,'PATCH'),f.call('/api/me',a,{...body,nickname:'不该覆盖'},'PATCH')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const me=(await f.call('/api/me',a)).data.member;assert.equal(me.avatar_locked,true);assert.equal(me.profile_locked,false);assert.equal(loginDestination(f.db,a.id),'/#me');
  assert.equal((await f.call('/api/me',a,{...body,nickname:'再次修改'},'PATCH')).status,409);
  assert.equal((await f.call('/api/me',a,{nickname:'可编辑',bio:'新介绍',skills:'代码',needs:'合作',card_public:true},'PATCH')).status,200);
  assert.equal((await f.call('/api/admin/members/'+a.id,admin,{nickname:'管理员修改'},'PATCH')).status,200);
  assert.equal((await f.call('/api/admin/members/'+a.id,admin,{avatar:{}},'PATCH')).status,409);
  const edited=(await f.call('/api/me',a)).data.member;assert.equal(edited.nickname,'管理员修改');assert.deepEqual(edited.avatar,avatar);
  f.db.raw.prepare('UPDATE members SET bio=? WHERE id=?').run('资料可编辑',a.id);
  assert.throws(()=>f.db.raw.prepare('UPDATE members SET profile_completed_at=NULL WHERE id=?').run(a.id),/finalized/);
  assert.throws(()=>f.db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run('{}',a.id),/finalized/);
  f.db.raw.prepare("UPDATE members SET status='disabled' WHERE id=?").run(a.id); // moderation still works
});
test('upgrading preserves and locks existing avatars without locking incomplete members',()=>{
  const db=openDatabase(':memory:');
  try{
    // Build the previous schema with real migration checksums, then apply only new migrations.
    db.raw.exec('PRAGMA application_id=1213219633; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
    const dir=new URL('../migrations/',import.meta.url);
    for(const name of readdirSync(dir).filter(n=>/^000[1-5]_/.test(n)).sort()){
      const sql=readFileSync(new URL(name,dir),'utf8');db.raw.exec(sql);db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name,hash(sql));
    }
    db.raw.prepare('INSERT INTO members(id,email,nickname,avatar_json,created_at,updated_at) VALUES(?,?,?,?,1,2)').run('old','old@example.test','已有成员',JSON.stringify(avatar));
    db.raw.prepare('INSERT INTO members(id,email,nickname,created_at,updated_at) VALUES(?,?,?,1,2)').run('new','new@example.test','新成员');
    migrate(db);migrate(db);
    assert.equal(db.raw.prepare('SELECT profile_completed_at FROM members WHERE id=?').get('old').profile_completed_at,2);
    assert.equal(db.raw.prepare('SELECT avatar_json FROM members WHERE id=?').get('old').avatar_json,JSON.stringify(avatar));
    assert.equal(db.raw.prepare('SELECT profile_completed_at FROM members WHERE id=?').get('new').profile_completed_at,null);
  }finally{db.close();}
});
