import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {derivePixelProgress}=require('./vendor/planet/backend/pixel-planet/service.cjs');
const pixelRules=require('./vendor/planet/backend/pixel-planet/rules.json');
import { createHash, randomUUID } from 'node:crypto';
const ruleBytes=readFileSync(new URL('./vendor/planet/backend/activity-config/activity-config.json',import.meta.url));
const manifestBytes=readFileSync(new URL('./config/planet_asset_manifest_v1.json',import.meta.url));
export const planetRules=JSON.parse(ruleBytes),assetManifest=JSON.parse(manifestBytes);
const hash=v=>createHash('sha256').update(v).digest('hex'),now=()=>Math.floor(Date.now()/1000);
const release={rule_version:planetRules.rule_version,model_version:assetManifest.modelVersion,rule_sha256:hash(ruleBytes),manifest_sha256:hash(manifestBytes)};
export class PlanetGrowthError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new PlanetGrowthError(status,message)};
export function growthTransaction(db,fn){if(db._planetGrowthTx)return fn();db.raw.exec('BEGIN IMMEDIATE');db._planetGrowthTx=true;try{const r=fn();db.raw.exec('COMMIT');return r}catch(e){db.raw.exec('ROLLBACK');throw e}finally{db._planetGrowthTx=false}}
const unitsFor=refs=>[...new Set(refs.flatMap(ref=>{const ids=assetManifest.refUnits[ref];if(!ids)throw Error('Frozen reference missing');return ids}))].sort();
const releaseRow=db=>db.raw.prepare('SELECT * FROM planet_growth_release').get();
function assertRelease(row){if(row&&Object.keys(release).some(key=>row[key]!==release[key]))throw Error('Planet published release does not match this build');}
export function validPlanetCheckins(db,memberId){return db.raw.prepare(`SELECT c.event_id,c.checked_at,e.title FROM checkins c JOIN events e ON e.id=c.event_id
 WHERE c.member_id=? AND e.status='published' AND COALESCE((SELECT valid FROM planet_fact_corrections f WHERE f.member_id=c.member_id AND f.kind='checkin' AND f.event_id=c.event_id ORDER BY f.id DESC LIMIT 1),1)=1 ORDER BY c.checked_at,c.event_id`).all(memberId)}
// Shared read-only projection for website and hardware; hardware alone persists frame versions.
export function derivePixelPlanet(db,memberId,paletteId,connections){
 const mappings=db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all();
 const activities=mappings.map(m=>({...planetRules.activities.find(a=>a.activity_id===m.catalog_activity_id),canonical_session_id:m.activity_id,
  enabled:db.raw.prepare('SELECT status FROM events WHERE id=?').get(m.activity_id)?.status==='published'}));
 const facts=validPlanetCheckins(db,memberId).flatMap(f=>mappings.filter(m=>m.activity_id===f.event_id).map(m=>({user_id:memberId,campaign_id:pixelRules.campaignId,
  activity_id:m.catalog_activity_id,canonical_session_id:f.event_id,revision:1,status:'valid',checked_in_at:new Date(f.checked_at*1000).toISOString(),updated_at:new Date(f.checked_at*1000).toISOString()})));
 const {issues,...progress}=derivePixelProgress({userId:memberId,campaignId:pixelRules.campaignId,activities,checkins:facts});
 return {paletteId,...progress,friendIds:connections.map(f=>f.id).sort()};
}
function validRoles(db,memberId){return db.raw.prepare(`SELECT r.* FROM planet_role_reviews r LEFT JOIN events e ON e.id=r.event_id
 WHERE r.member_id=? AND (r.kind='volunteer' OR (e.status='published' AND e.host_id=r.member_id))
 AND COALESCE((SELECT valid FROM planet_fact_corrections f WHERE f.member_id=r.member_id AND f.kind='role' AND f.review_id=r.id ORDER BY f.id DESC LIMIT 1),1)=1 ORDER BY r.reviewed_at,r.id`).all(memberId)}
export function settlePlanetGrowth(db,memberId){
 const row=releaseRow(db);assertRelease(row);
 const facts=validPlanetCheckins(db,memberId),mappings=db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all(),extras=db.raw.prepare('SELECT * FROM planet_growth_events').all();
 const desired=new Map(),tracks=[],completed=new Set();
 function grant(key,label,refs,sources,alreadyUnits=false){const ids=alreadyUnits?[...new Set(refs)].sort():unitsFor(refs);if(ids.length)desired.set(key,{key,label,sources,ids});}
 if(row){
  for(const fact of facts){
   const extra=extras.find(e=>e.event_id===fact.event_id),source={kind:'checkin',eventId:fact.event_id};if(extra)completed.add(fact.event_id);
   if(extra?.milestone==='opening'){grant('opening','开营 · 初始地貌',planetRules.opening.grants_source_model_refs,[source]);completed.add(fact.event_id);}
   if(extra?.halloween){grant('halloween:'+fact.event_id,'万圣节 · 奥德赛巨人岛',planetRules.conditional_milestones.halloween.grants_source_model_refs,[source]);completed.add(fact.event_id);}
   const matched=mappings.filter(m=>m.activity_id===fact.event_id).map(m=>planetRules.activities.find(a=>a.activity_id===m.catalog_activity_id));
   for(const a of matched){if(!a?.enabled)continue;completed.add(fact.event_id);grant('activity:'+fact.event_id,a.reward_label,a.source_model_refs,[source]);}
  }
  for(const [id,track]of Object.entries(planetRules.tracks)){
   const participating=facts.map(f=>({fact:f,activity:mappings.filter(m=>m.activity_id===f.event_id).map(m=>planetRules.activities.find(a=>a.activity_id===m.catalog_activity_id)).find(a=>a?.enabled&&a.track_id===id)})).filter(p=>p.activity);
   const earned=track.progress_mode==='fixed_round'?[...new Set(participating.map(p=>p.activity.fixed_round))].sort():track.stages.slice(0,participating.length).map(s=>s.stage);
   for(const stageNo of earned){const stage=track.stages.find(s=>s.stage===stageNo);if(!stage)throw Error('Track stage missing');const sources=(track.progress_mode==='fixed_round'?participating.filter(p=>p.activity.fixed_round===stageNo):participating.slice(0,stageNo)).map(p=>({kind:'checkin',eventId:p.fact.event_id}));grant('track:'+id+':'+stageNo,track.display_name+' · '+stage.label,stage.source_model_refs,sources);if(id==='market')grant('market-backfill:'+stageNo,'市集补全 · 第'+stageNo+'场',assetManifest.marketRounds[stageNo-1],sources,true);}
   tracks.push({id,name:track.display_name,level:earned.length,cap:track.stages.length,completedStages:earned,nextLabel:track.progress_mode==='fixed_round'?null:track.stages[earned.length]?.label||null});
  }
  const roles=validRoles(db,memberId),volunteer=roles.find(r=>r.kind==='volunteer'),hosts=roles.filter(r=>r.kind==='host');
  if(volunteer)grant('volunteer','志愿者 · 10只星光燕',planetRules.roles.volunteer.grants_source_model_refs,[{kind:'role',reviewId:volunteer.id}]);
  for(let i=0;i<Math.min(hosts.length,planetRules.roles.host.max_level);i++)grant('host:'+(i+1),'发起者 · 第'+(i+1)+'级',planetRules.roles.host.stages[i],hosts.slice(0,i+1).map(r=>({kind:'role',reviewId:r.id})));
  tracks.push({id:'host',name:'发起者村庄',level:Math.min(hosts.length,10),cap:10,completedStages:Array.from({length:Math.min(hosts.length,10)},(_,i)=>i+1),nextLabel:hosts.length<10?'完成并经审核确认一次活动':null});
 }
 const active=db.raw.prepare(`SELECT g.* FROM planet_asset_grants g LEFT JOIN planet_asset_reversals r ON r.grant_id=g.id WHERE g.member_id=? AND r.grant_id IS NULL`).all(memberId);
 const stamp=now();for(const item of desired.values())item.hash=hash(JSON.stringify([item.label,item.sources,item.ids,release]));
 for(const old of active){const target=desired.get(old.reward_key);if(!target||target.hash!==old.content_hash)db.raw.prepare('INSERT INTO planet_asset_reversals VALUES(?,?,?)').run(old.id,'有效行为或来源发生变化',stamp);}
 for(const item of desired.values())if(!active.some(g=>g.reward_key===item.key&&g.content_hash===item.hash))db.raw.prepare('INSERT INTO planet_asset_grants VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),memberId,release.rule_version,release.model_version,item.key,item.label,JSON.stringify(item.sources),JSON.stringify(item.ids),item.hash,stamp);
 const all=db.raw.prepare('SELECT event_id FROM checkins WHERE member_id=?').all(memberId);
 for(const f of all)db.raw.prepare(`INSERT INTO planet_settlement_tasks(activity_id,member_id,status,created_at) VALUES(?,?,?,?) ON CONFLICT(activity_id,member_id) DO UPDATE SET status=excluded.status`).run(f.event_id,memberId,row&&(mappings.some(m=>m.activity_id===f.event_id)||extras.some(e=>e.event_id===f.event_id))?'settled':'pending_rules',stamp);
 const unitIds=[...new Set([...desired.values()].flatMap(d=>d.ids))].sort();
 const pendingCheckins=facts.filter(f=>!completed.has(f.event_id)).length;
 return {status:row?'ready':'pending_rules',ruleVersion:release.rule_version,modelVersion:release.model_version,unitIds,assetUnitCount:unitIds.length,rewardCount:desired.size,pendingCheckins,checkinCount:facts.length,tracks,rewards:[...desired.values()].map(d=>({key:d.key,label:d.label,assetUnitCount:d.ids.length,sources:d.sources})),volunteer:desired.has('volunteer')};
}
export function activatePlanetGrowth(db,admin){return growthTransaction(db,()=>{const old=releaseRow(db);assertRelease(old);const maps=db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all();if(maps.some(m=>!planetRules.activities.some(a=>a.activity_id===m.catalog_activity_id))||new Set(maps.map(m=>m.activity_id)).size!==maps.length)fail(409,'现有目录映射含未知活动或同一活动重复绑定，请在启用前修正');if(!old)db.raw.prepare('INSERT INTO planet_growth_release VALUES(1,?,?,?,?,?,?)').run(release.rule_version,release.model_version,release.rule_sha256,release.manifest_sha256,admin.id,now());return {activated:true,...release}})}
export function configurePlanetEvent(db,admin,data){return growthTransaction(db,()=>{
 if(!releaseRow(db))fail(409,'请先启用当前星球成长规则');
 const e=db.raw.prepare('SELECT * FROM events WHERE id=?').get(data.activity_id);if(!e)fail(404,'网站活动不存在');
 const catalogId=data.catalog_activity_id||null,milestone=data.milestone||null;
 if(catalogId&&!planetRules.activities.some(a=>a.activity_id===catalogId))fail(400,'成长目录不存在');
 if(milestone&&!['opening','host'].includes(milestone))fail(400,'里程碑不合法');
 if(!catalogId&&!milestone&&data.halloween!==true)fail(400,'请选择活动奖励或里程碑');
 if(catalogId&&milestone==='opening')fail(400,'开营和课程奖励请分别绑定活动');
 const date=new Date(e.starts_at*1000+8*3600000).toISOString().slice(0,10);
 if(milestone==='opening'&&date!==planetRules.campaign.opens_at)fail(400,'开营活动日期应为2026-10-19');
 if(data.halloween===true&&date!==planetRules.conditional_milestones.halloween.date)fail(400,'万圣节奖励仅用于2026-10-31已确认的活动');
 if(milestone==='opening'&&db.raw.prepare("SELECT 1 FROM planet_growth_events WHERE milestone='opening' AND event_id!=?").get(e.id))fail(409,'开营活动已绑定');
 const other=db.raw.prepare('SELECT * FROM planet_activity_catalog_map WHERE activity_id=? AND catalog_activity_id!=?').get(e.id,catalogId||'');if(other)fail(409,'同一实际活动只能绑定一个成长目录，结营别名也使用同一个活动ID');
 if(catalogId){const old=db.raw.prepare('SELECT * FROM planet_activity_catalog_map WHERE catalog_activity_id=?').get(catalogId);if(old&&old.activity_id!==e.id)fail(409,'已发布的活动映射不能改绑');if(!old)db.raw.prepare('INSERT INTO planet_activity_catalog_map VALUES(?,?,?,?)').run(catalogId,e.id,admin.id,now());}
 const old=db.raw.prepare('SELECT * FROM planet_growth_events WHERE event_id=?').get(e.id),h=Number(data.halloween===true);if(old&&(old.milestone!==milestone||old.halloween!==h))fail(409,'已发布的里程碑不能修改');if(!old)db.raw.prepare('INSERT INTO planet_growth_events VALUES(?,?,?,?,?)').run(e.id,milestone,h,admin.id,now());
 return {mapped:true,eventId:e.id};
 })}
export function reviewPlanetRole(db,admin,data){return growthTransaction(db,()=>{
 if(!releaseRow(db))fail(409,'请先启用成长规则');
 if(!['volunteer','host'].includes(data.kind)||typeof data.evidence_note!=='string'||!data.evidence_note.trim()||data.evidence_note.length>1000)fail(400,'请填写身份类型和审核依据');
 if(data.member_id===admin.id)fail(403,'不能审核自己的奖励，请由另一位管理员确认');
 if(!db.raw.prepare("SELECT 1 FROM members WHERE id=? AND status!='disabled'").get(data.member_id))fail(404,'成员不存在');
 const e=data.kind==='host'?db.raw.prepare('SELECT * FROM events WHERE id=?').get(data.event_id):null;
 if(data.kind==='host'&&(!e||e.host_id!==data.member_id||e.status!=='published'||e.ends_at>now()))fail(409,'只有已结束且已发布的本人发起活动可以审核');
 if(e&&!db.raw.prepare('SELECT 1 FROM planet_growth_events WHERE event_id=? UNION ALL SELECT 1 FROM planet_activity_catalog_map WHERE activity_id=?').get(e.id,e.id))fail(409,'请先将该活动加入成长计划');
 const old=db.raw.prepare('SELECT * FROM planet_role_reviews WHERE member_id=? AND kind=? AND event_id IS ?').get(data.member_id,data.kind,e?.id||null);if(old)return {reviewId:old.id,duplicate:true};
 const id=randomUUID();db.raw.prepare('INSERT INTO planet_role_reviews VALUES(?,?,?,?,?,?,?)').run(id,data.member_id,data.kind,e?.id||null,data.evidence_note.trim(),admin.id,now());return {reviewId:id,duplicate:false};
 })}
export function correctPlanetFact(db,admin,data){return growthTransaction(db,()=>{
 if(typeof data.valid!=='boolean'||!['checkin','role'].includes(data.kind)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>1000)fail(400,'纠正必须包含事实类型、有效状态和原因');
 const fact=data.kind==='checkin'?db.raw.prepare('SELECT 1 FROM checkins WHERE event_id=? AND member_id=?').get(data.event_id,data.member_id):db.raw.prepare('SELECT 1 FROM planet_role_reviews WHERE id=? AND member_id=?').get(data.review_id,data.member_id);if(!fact)fail(404,'事实不存在');
 db.raw.prepare('INSERT INTO planet_fact_corrections(member_id,kind,event_id,review_id,valid,reason,corrected_by,corrected_at) VALUES(?,?,?,?,?,?,?,?)').run(data.member_id,data.kind,data.kind==='checkin'?data.event_id:null,data.kind==='role'?data.review_id:null,Number(data.valid),data.reason.trim(),admin.id,now());return {corrected:true};
 })}
export function planetGrowthAdmin(db){assertRelease(releaseRow(db));return {release:releaseRow(db)||null,availableRelease:release,catalog:planetRules.activities.map(a=>({id:a.activity_id,title:a.title,date:a.event_date,reward:a.reward_label})),mappings:db.raw.prepare('SELECT * FROM planet_activity_catalog_map').all(),milestones:db.raw.prepare('SELECT * FROM planet_growth_events').all(),reviews:db.raw.prepare(`SELECT r.*,m.nickname,e.title FROM planet_role_reviews r JOIN members m ON m.id=r.member_id LEFT JOIN events e ON e.id=r.event_id ORDER BY reviewed_at DESC`).all()};}
