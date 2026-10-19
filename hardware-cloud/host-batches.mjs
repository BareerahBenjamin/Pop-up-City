import {nameBitmap,rosterNameBitmap} from './name-bitmap.mjs';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {HardwareError,hardwareKind} from '../hardware.js';
import {sign} from './checkin-session.mjs';
import {activeHostEvent,saveHostAttendance} from './attendance.mjs';
const now=()=>Math.floor(Date.now()/1000);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const fail=(status,code,message)=>{throw new HardwareError(status,code,message);};
const tx=(db,fn)=>{db.raw.exec('BEGIN IMMEDIATE');try{let r=fn();db.raw.exec('COMMIT');return r;}catch(e){db.raw.exec('ROLLBACK');throw e;}};
function boardAt(db,id){return db.raw.prepare("SELECT d.* FROM devices d JOIN members m ON m.id=d.member_id WHERE d.id=? AND d.revoked_at IS NULL AND m.status!='disabled'").get(id);}
function owner(db,reporter){let b=boardAt(db,reporter.id);if(!b||b.token_hash!==reporter.token_hash)fail(401,'INVALID_DEVICE','设备不可用');if(hardwareKind(db,b.id)!=='user')fail(403,'USER_ONLY','仅成员板可使用');return b;}
function ownedEvent(db,b,id){let e=db.raw.prepare('SELECT * FROM events WHERE id=? AND host_id=?').get(id,b.member_id);if(!e)fail(404,'ACTIVITY_NOT_FOUND','活动不存在或无权访问');return e;}
function ownedBatch(db,b,id){let row=db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=? AND host_device_id=?').get(id,b.id);if(!row)fail(404,'BATCH_NOT_FOUND','批次不存在或无权访问');ownedEvent(db,b,row.activity_id);return row;}
function proof(b,canonical,value){const expected=sign(b.token_hash,JSON.stringify(canonical));if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(value,'hex')))fail(403,'INVALID_PROOF','批量确认签名无效');}
function validId(id,code='INVALID_ID'){if(!uuid(id))fail(400,code,'需要小写UUID');}
const isActive=(e,t)=>e&&!e.deleted&&e.status==='published'&&e.starts_at<=t&&e.ends_at>t;
export function batchView(db,batch,time=now()) {
 const items=db.raw.prepare('SELECT state,group_index,error_code FROM hardware_host_batch_items WHERE batch_id=? ORDER BY position').all(batch.id);
 const counts={pending:0,checked_in:0,already_signed:0,failed:0};for(const i of items)counts[i.state]++;
 const groups=[];for(const item of items){let g=groups[item.group_index]??={index:item.group_index+1,total:0,processed:0};g.total++;if(item.state!=='pending')g.processed++;}
 const e=db.raw.prepare('SELECT e.*,EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) deleted FROM events e WHERE e.id=?').get(batch.activity_id);
 return {batch_id:batch.id,activity_id:batch.activity_id,state:batch.state,attempt:batch.attempt,total:batch.total,
  processed:batch.total-counts.pending,signed:counts.checked_in+counts.already_signed,newly_signed:counts.checked_in,
  already_signed:counts.already_signed,failed:counts.failed,pending:counts.pending,unknown:0,
  groups,group_size:batch.group_size,current_group:groups.find(g=>g.processed<g.total)?.index??null,
  stop_reason:batch.stop_reason,can_retry:['partial','failed'].includes(batch.state)&&counts.failed>0&&isActive(e,time),
  updated_at:batch.updated_at,feedback:'none'};
}
export function rosterPage(db,reporter,{activityId,offset=0,limit=6}={}) {
 validId(activityId,'INVALID_ACTIVITY_ID');if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>30)fail(400,'INVALID_PAGE','名单分页参数不合法');
 return tx(db,()=>{const b=owner(db,reporter),e=ownedEvent(db,b,activityId);if(db.raw.prepare('SELECT 1 FROM event_deletions WHERE event_id=?').get(activityId))fail(404,'ACTIVITY_NOT_FOUND','活动已删除');
  // One row per member even when registered as both attendee and volunteer.
  const rows=db.raw.prepare(`SELECT r.member_id,m.nickname,MIN(r.created_at) registered_at,
   MAX(r.kind='attendee') attendee,MAX(r.kind='volunteer') volunteer,c.checked_at
   FROM event_registrations r JOIN members m ON m.id=r.member_id LEFT JOIN checkins c ON c.event_id=r.event_id AND c.member_id=r.member_id
   WHERE r.event_id=? GROUP BY r.member_id ORDER BY registered_at,r.member_id`).all(activityId);
  const total=rows.length,checked=rows.filter(r=>r.checked_at!=null).length,start=total?Math.min(offset,Math.max(0,total-1)):0;
  return {activity_id:e.id,activity_title:e.title,activity_status:e.status,starts_at:e.starts_at,ends_at:e.ends_at,
   total,checked_count:checked,offset:start,limit,has_more:start+limit<total,roster_version:hash(rows),
   range_start:total?start+1:0,range_end:Math.min(start+limit,total),items:rows.slice(start,start+limit).map(r=>({member_id:r.member_id,name:r.nickname,
    kinds:[...(r.attendee?['attendee']:[]),...(r.volunteer?['volunteer']:[])],status:r.checked_at!=null?'SIGNED':'PENDING',checked_at:r.checked_at??null}))};});
}
export function createBatch(db,reporter,data,time=now()) {
 validId(data.batch_id,'INVALID_BATCH_ID');validId(data.activity_id,'INVALID_ACTIVITY_ID');
 if(data.host_confirmed!==true||Object.hasOwn(data,'participants')||Object.hasOwn(data,'member_ids'))fail(400,'INVALID_BATCH','批量名单只能由后台按报名表生成');
 return tx(db,()=>{const b=owner(db,reporter),canonical=['herstory-host-batch-v1',data.batch_id,b.id,data.activity_id,true];proof(b,canonical,data.host_proof);const payloadHash=hash(canonical);
  const old=db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(data.batch_id);
  if(old){if(old.host_device_id!==b.id||old.payload_hash!==payloadHash)fail(409,'BATCH_ID_CONFLICT','批次编号对应的内容已改变');return batchView(db,old,time);}
  activeHostEvent(db,b,data.activity_id,time);
  if(db.raw.prepare("SELECT 1 FROM hardware_host_batches WHERE activity_id=? AND state IN ('queued','running')").get(data.activity_id))fail(409,'BATCH_IN_PROGRESS','本活动已有批次正在处理，请先查询原批次');
  const rows=db.raw.prepare('SELECT member_id,MIN(created_at) registered_at FROM event_registrations WHERE event_id=? GROUP BY member_id ORDER BY registered_at,member_id').all(data.activity_id);
  const groupSize=rows.length<=16?Math.max(1,rows.length):10;
  db.raw.prepare('INSERT INTO hardware_host_batches VALUES(?,?,?,?,?,?,?,1,NULL,?,?)').run(data.batch_id,b.id,data.activity_id,payloadHash,rows.length?'queued':'completed',rows.length,groupSize,time,time);
  const insert=db.raw.prepare("INSERT INTO hardware_host_batch_items VALUES(?,?,?,?,?,?,'pending',NULL,?)");
  rows.forEach((r,i)=>insert.run(data.batch_id,r.member_id,null,i,Math.floor(i/groupSize),randomUUID(),time));
  return batchView(db,db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(data.batch_id),time);
 });
}
export function readBatch(db,reporter,id,time=now()){validId(id,'INVALID_BATCH_ID');return tx(db,()=>{const b=owner(db,reporter);return batchView(db,ownedBatch(db,b,id),time);});}
export function retryBatch(db,reporter,id,data,time=now()) {
 validId(id,'INVALID_BATCH_ID');validId(data.request_id,'INVALID_REQUEST_ID');if(data.host_confirmed!==true)fail(400,'INVALID_CONFIRMATION','需要确认重试');
 return tx(db,()=>{const b=owner(db,reporter),row=ownedBatch(db,b,id),canonical=['herstory-host-batch-retry-v1',data.request_id,id,b.id,true];proof(b,canonical,data.host_proof);const payloadHash=hash(canonical);
  const old=db.raw.prepare('SELECT * FROM hardware_host_batch_retries WHERE request_id=?').get(data.request_id);
  if(old){if(old.batch_id!==id||old.payload_hash!==payloadHash)fail(409,'RETRY_ID_CONFLICT','重试编号内容不匹配');return batchView(db,row,time);}
  activeHostEvent(db,b,row.activity_id,time);
  if(!['partial','failed'].includes(row.state))fail(409,'NOT_RETRYABLE','当前批次不可重试');
  if(db.raw.prepare("SELECT 1 FROM hardware_host_batches WHERE activity_id=? AND state IN ('queued','running')").get(row.activity_id))fail(409,'BATCH_IN_PROGRESS','本活动已有批次正在处理');
  const changed=db.raw.prepare("UPDATE hardware_host_batch_items SET state='pending',error_code=NULL,updated_at=? WHERE batch_id=? AND state='failed'").run(time,id).changes;
  if(!changed)fail(409,'NOT_RETRYABLE','没有未成功成员');
  db.raw.prepare("UPDATE hardware_host_batches SET state='queued',attempt=attempt+1,stop_reason=NULL,updated_at=? WHERE id=?").run(time,id);
  db.raw.prepare('INSERT INTO hardware_host_batch_retries VALUES(?,?,?,?,?)').run(data.request_id,id,payloadHash,row.attempt+1,time);
  return batchView(db,db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(id),time);
 });
}
function settleState(db,id,time){const states=db.raw.prepare('SELECT state,COUNT(*) n FROM hardware_host_batch_items WHERE batch_id=? GROUP BY state').all(id),count=s=>states.find(r=>r.state===s)?.n||0;
 const state=count('pending')?'running':count('failed')?(count('checked_in')+count('already_signed')?'partial':'failed'):'completed';
 db.raw.prepare('UPDATE hardware_host_batches SET state=?,updated_at=? WHERE id=?').run(state,time,id);
}
/** Exactly one atomic member commit per turn; never holds a transaction across I/O or a whole sub-batch. */
export function stepBatch(db,id,{time=now()}={}) {
 return tx(db,()=>{let batch=db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(id);if(!batch||!['queued','running'].includes(batch.state))return batch?batchView(db,batch,time):null;
  const b=boardAt(db,batch.host_device_id),event=db.raw.prepare('SELECT e.*,EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) deleted FROM events e WHERE e.id=?').get(batch.activity_id);
  let reason=!b||hardwareKind(db,b.id)!=='user'?'DEVICE_REVOKED':!event||event.host_id!==b.member_id?'HOST_NOT_AUTHORIZED':event.deleted?'ACTIVITY_DELETED':event.status!=='published'?'ACTIVITY_CANCELLED':time>=event.ends_at?'ACTIVITY_ENDED':time<event.starts_at?'ACTIVITY_NOT_STARTED':null;
  if(reason){db.raw.prepare("UPDATE hardware_host_batches SET state='stopped',stop_reason=?,updated_at=? WHERE id=?").run(reason,time,id);return batchView(db,db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(id),time);}
  const item=db.raw.prepare("SELECT * FROM hardware_host_batch_items WHERE batch_id=? AND state='pending' ORDER BY position LIMIT 1").get(id);
  if(!item){settleState(db,id,time);return batchView(db,db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(id),time);}
  let state,deviceId=null,errorCode=null;
  db.raw.exec('SAVEPOINT batch_member');
  try{
   const existing=db.raw.prepare('SELECT * FROM checkins WHERE event_id=? AND member_id=?').get(batch.activity_id,item.member_id);
   if(existing){state='already_signed';deviceId=existing.device_id;}
   else{
    const peer=db.raw.prepare(`SELECT d.* FROM devices d JOIN members m ON m.id=d.member_id LEFT JOIN device_hardware_profiles p ON p.device_id=d.id
     WHERE d.member_id=? AND d.revoked_at IS NULL AND m.status!='disabled' AND COALESCE(p.device_kind,'user')='user' ORDER BY d.created_at DESC,d.id LIMIT 1`).get(item.member_id);
    if(!peer)fail(409,'NO_BOUND_DEVICE','成员已无有效绑定设备');
    const canonical=['herstory-host-batch-item-v1',id,item.member_id,item.interaction_id,b.id,batch.activity_id];
    const receipt=saveHostAttendance(db,{board:b,peer,activityId:batch.activity_id,interactionId:item.interaction_id,payloadHash:hash(canonical),time});
    state=receipt.duplicate?'already_signed':'checked_in';deviceId=peer.id;
   }
   db.raw.exec('RELEASE batch_member');
  }catch(e){db.raw.exec('ROLLBACK TO batch_member; RELEASE batch_member');state='failed';errorCode=e instanceof HardwareError?e.code:'SAVE_FAILED';}
  db.raw.prepare('UPDATE hardware_host_batch_items SET device_id=?,state=?,error_code=?,updated_at=? WHERE batch_id=? AND member_id=?').run(deviceId,state,errorCode,time,id,item.member_id);
  settleState(db,id,time);return batchView(db,db.raw.prepare('SELECT * FROM hardware_host_batches WHERE id=?').get(id),time);
 });
}
export function runPendingBatches(db,{time=now(),limit=4}={}){const ids=db.raw.prepare("SELECT id FROM hardware_host_batches WHERE state IN ('queued','running') ORDER BY updated_at,id LIMIT ?").all(limit);for(const {id}of ids)stepBatch(db,id,{time});return ids.length;}
function wrap(b,data){const payload=JSON.stringify({...data,recipient_device_id:b.id});return new Response(JSON.stringify({payload,signature:sign(b.token_hash,payload)}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
export async function hostBatchRoute(request,env,url,reporter,readBody){
 const path=url.pathname,match=/^\/api\/device\/host\/batches\/([^/]+)(\/retry)?$/.exec(path);
 if(path!=='/api/device/host/roster'&&path!=='/api/device/host/batches'&&!match)return null;
 let result;
 if(path==='/api/device/host/roster'&&request.method==='GET'){
  const number=(name,fallback)=>{const v=url.searchParams.get(name);return v===null?fallback:/^\d+$/.test(v)?Number(v):NaN;};
  result=rosterPage(env.DB,reporter,{activityId:url.searchParams.get('activity_id'),offset:number('offset',0),limit:number('limit',6)});
  result.activity_title_bitmap=await nameBitmap(result.activity_title);for(const item of result.items)item.name_bitmap=await rosterNameBitmap(item.name);
 }else if(path==='/api/device/host/batches'&&request.method==='POST')result=createBatch(env.DB,reporter,await readBody(request));
 else if(match&&!match[2]&&request.method==='GET')result=readBatch(env.DB,reporter,match[1]);
 else if(match&&match[2]&&request.method==='POST')result=retryBatch(env.DB,reporter,match[1],await readBody(request));
 else fail(405,'METHOD_NOT_ALLOWED','请求方法不支持');
 return wrap(reporter,result);
}
