import { visualForReceipt } from './hardware-cloud/avatar-visual.mjs';
import { saveHostAttendance } from './hardware-cloud/attendance.mjs';
import { nameBitmap } from './hardware-cloud/name-bitmap.mjs';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { CheckinSessions, sign } from './hardware-cloud/checkin-session.mjs';
import { FriendSessions } from './hardware-cloud/friend-session.mjs';
import { friendListPage } from './hardware-cloud/friend-list.mjs';
import { checkin, friend, hardwareKind, HardwareError } from './hardware.js';
import { planetSnapshotInTransaction } from './planet.js';
const now = () => Math.floor(Date.now()/1000);
const fail = (status, code) => { throw new HardwareError(status, code, code); };
const json = data => new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const queues = new WeakMap();
const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
function wrap(board, data) { const payload=JSON.stringify({...data,recipient_device_id:board.id});return json({payload,signature:sign(board.token_hash,payload)}); }
function verify(board, fields, signature) {
 const expected=sign(board.token_hash,JSON.stringify(fields));
 if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')))fail(403,'INVALID_PROOF');
}
function boards(db) {
 return db.raw.prepare(`SELECT d.*,m.nickname,m.avatar_json FROM devices d JOIN members m ON m.id=d.member_id WHERE d.revoked_at IS NULL AND m.status!='disabled'`).all().map(b=>({...b,role:hardwareKind(db,b.id)}));
}
function load(db,id) {const row=db.raw.prepare('SELECT state_json FROM hardware_cloud_sessions WHERE id=? AND updated_at>?').get(id,now()-120);return row?JSON.parse(row.state_json):null;}
function save(db,id,state) {
 db.raw.prepare('DELETE FROM hardware_cloud_sessions WHERE updated_at<?').run(now()-120);
 db.raw.prepare('INSERT INTO hardware_cloud_sessions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').run(id,JSON.stringify(state),now());
}
function activities(db,station) {
 return db.raw.prepare(`SELECT e.id,e.title label,e.starts_at,e.ends_at FROM events e JOIN checkin_station_activities a ON a.activity_id=e.id WHERE a.station_device_id=? AND a.revoked_at IS NULL AND a.opens_at<=? AND a.closes_at>? AND e.status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) AND e.starts_at>? AND e.starts_at<=? ORDER BY e.starts_at,e.id`).all(station,now(),now(),now(),now()+3600).map(e=>({...e,label:/^[\x20-\x7e]{1,48}$/.test(e.label)?e.label:'ACTIVITY '+e.id.slice(0,8)}));
}
async function checkinSession(db, board, method, path, data, all) {
 let station=board.role==='checkin'?board.id:data.station_device_id||db.raw.prepare('SELECT station_device_id FROM hardware_cloud_settings WHERE device_id=?').get(board.id)?.station_device_id;
 if(!station){const choices=all.filter(b=>b.role==='checkin'&&activities(db,b.id).length);if(choices.length!==1)fail(409,'CONFIGURE_STATION');station=choices[0].id;}
 const stationBoard=all.find(b=>b.id===station&&b.role==='checkin');if(!stationBoard)fail(403,'STATION_UNAVAILABLE');
 const events=activities(db,station);
 const previous=load(db,'checkin:'+station);
 const service=new CheckinSessions({boards:all,activities:events,activity:{id:'',label:'No open activity'}},(reporter,event)=>checkin(db,reporter,event));
 service.station=stationBoard;
 if(previous){service.selected=events.find(e=>e.id===previous.selected?.id)||events[0]||{id:'',label:'No open activity'};service.current=previous.current;}
 if(service.current&&(!all.some(b=>b.id===service.current.user_device_id)||db.raw.prepare('SELECT 1 FROM event_deletions WHERE event_id=?').get(service.current.activity_id)))service.current=null;
 service.expire();
 if(path.endsWith('/request')&&!service.selected.id)fail(409,'CHECKIN_CLOSED');
 try {return json(await service.route(board,method,path,data));}
 finally {save(db,'checkin:'+station,{selected:service.selected,current:service.current});}
}
async function friendSession(db,board,method,path,data,all,url) {
 if(board.role==='checkin')fail(403,'USER_ONLY');
 if(path==='/local/friend/list'){
  if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
  const connections=db.raw.prepare(`SELECT m.id member_id,m.nickname,f.established_at connected_at FROM friendships f JOIN members m ON m.id=CASE WHEN f.member_a_id=? THEN f.member_b_id ELSE f.member_a_id END WHERE (f.member_a_id=? OR f.member_b_id=?) AND m.status!='disabled' ORDER BY connected_at DESC,m.id`).all(board.member_id,board.member_id,board.member_id);
  return wrap(board,friendListPage({connections},Number(url.searchParams.get('offset')||0)));
 }
 if(path==='/local/friend/retire'){
  if(method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
  const {interaction_id:id,peer_device_id:peerId,nonce,confirmation_code:code,occurred_at:time}=data;
  if(!uuid(id)||!uuid(peerId)||peerId===board.id||!/^[a-f0-9]{32}$/.test(nonce||'')||!/^\d{4}$/.test(code||'')||!Number.isSafeInteger(time)||time<1||time>now()+300)fail(400,'INVALID_INTENT');
  verify(board,['herstory-friend-retire-v1',id,board.id,peerId,nonce,code,time],data.user_proof);
  db.raw.exec('BEGIN IMMEDIATE');
  try{
   const old=db.raw.prepare('SELECT * FROM hardware_interactions WHERE interaction_id=?').get(id);
   let receipt;
   if(old){
    if(old.interaction_type!=='friend'||![old.device_a_id,old.device_b_id].includes(board.id)||![old.device_a_id,old.device_b_id].includes(peerId))fail(409,'EVENT_ID_CONFLICT');
    receipt=JSON.parse(old.receipt_json);
   }else{
    const peer=db.raw.prepare('SELECT * FROM devices WHERE id=?').get(peerId);if(!peer||hardwareKind(db,peer.id)!=='user')fail(403,'INVALID_PAIR');
    receipt={receipt_id:randomUUID(),interaction_id:id,status:'cancelled'};
    const ids=[board.id,peerId].sort();
    const fingerprint=createHash('sha256').update(JSON.stringify(['herstory-friend-retire-v1',id,...ids,nonce,code,time])).digest('hex');
    db.raw.prepare('INSERT INTO hardware_interactions VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'friend',board.id,ids[0],ids[1],null,time,now(),fingerprint,JSON.stringify(receipt));
   }
   db.raw.exec('COMMIT');return wrap(board,{interaction_id:id,operation_type:'friend',state:receipt.status==='cancelled'?'cancelled':'saved',receipt,...(visualForReceipt(receipt,board.id)?{visual:visualForReceipt(receipt,board.id)}:{}),may_retry_as_new:false});
  }catch(error){db.raw.exec('ROLLBACK');throw error;}
 }
 const service=new FriendSessions({boards:all},(reporter,event,visual)=>friend(db,reporter,event,visual));
 const old=load(db,'friend');
 if(old){
  for(const [id,w] of old.waiters){const b=all.find(b=>b.id===id);if(b)service.waiters.set(id,{...w,board:b});}
  for(const s of old.sessions)if(all.some(b=>b.id===s.device_a_id)&&all.some(b=>b.id===s.device_b_id)){
   if(s.state==='submitting')s.state='failed';
   service.sessions.set(s.interaction_id,s);
   for(const id of [s.device_a_id,s.device_b_id])if(old.byBoard?.some(([b,i])=>b===id&&i===s.interaction_id))service.byBoard.set(id,s);
  }
  service.reports=new Map(old.reports.map(([id,rows])=>[id,new Map(rows)]));service.sequence=old.sequence;
 }
 try{return json(await service.route(board,method,path,data));}
 finally{save(db,'friend',{waiters:[...service.waiters].map(([id,{board:b,...w}])=>[id,w]),sessions:[...service.sessions.values()].filter(s=>[s.device_a_id,s.device_b_id].some(id=>service.byBoard.get(id)===s)),reports:[...service.reports].map(([id,rows])=>[id,[...rows]]),byBoard:[...service.byBoard].map(([id,s])=>[id,s.interaction_id]),sequence:service.sequence});}
}
function hostActivities(db,board) {
 return db.raw.prepare(`SELECT e.id,e.title label,e.starts_at,e.ends_at,(SELECT COUNT(*) FROM checkins c WHERE c.event_id=e.id) checked_count FROM events e WHERE e.host_id=? AND e.status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) AND e.starts_at<=? AND e.ends_at>? ORDER BY e.starts_at,e.id`).all(board.member_id,now(),now());
}
function presence(peer,data) {
 if(!Number.isSafeInteger(data.presence_epoch)||Math.abs(now()-data.presence_epoch)>20||typeof data.presence_tag!=='string'||!/^[a-f0-9]{12}$/.test(data.presence_tag))fail(403,'INVALID_PRESENCE');
 const expected=sign(peer.token_hash,JSON.stringify(['herstory-presence-v1',peer.id,data.presence_epoch])).slice(0,12);
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(data.presence_tag,'hex')))fail(403,'INVALID_PRESENCE');
}
async function hostRoute(db,board,method,path,data,all) {
 if(board.role==='checkin')fail(403,'USER_ONLY');
 const op=path.slice('/local/host/'.length);
 if(method==='POST'&&op==='cancel'){
  if(!uuid(data.interaction_id)||!uuid(data.activity_id)||!uuid(data.user_device_id))fail(400,'INVALID_ID');
  verify(board,['herstory-host-cancel-v1',data.interaction_id,board.id,data.user_device_id,data.activity_id],data.host_proof);
  db.raw.exec('BEGIN IMMEDIATE');
  try{
   const old=db.raw.prepare('SELECT * FROM hardware_host_receipts WHERE interaction_id=?').get(data.interaction_id);
   if(old){if(old.host_device_id!==board.id||old.user_device_id!==data.user_device_id||old.activity_id!==data.activity_id)fail(409,'EVENT_ID_CONFLICT');
    const receipt=JSON.parse(old.receipt_json);db.raw.exec('COMMIT');return wrap(board,{interaction_id:data.interaction_id,activity_id:data.activity_id,state:receipt.status==='cancelled'?'cancelled':'saved',receipt,may_retry_as_new:false});}
   const event=db.raw.prepare('SELECT * FROM events WHERE id=?').get(data.activity_id),peer=db.raw.prepare('SELECT * FROM devices WHERE id=?').get(data.user_device_id);
   if(!event||event.host_id!==board.member_id||!peer||peer.member_id===board.member_id)fail(403,'HOST_NOT_AUTHORIZED');
   const deleted=db.raw.prepare('SELECT 1 FROM event_deletions WHERE event_id=?').get(event.id),time=now();
   if(!deleted&&event.status==='published'&&event.starts_at<=time&&event.ends_at>time)fail(409,'ACTIVITY_STILL_ACTIVE');
   const receipt={receipt_id:randomUUID(),interaction_id:data.interaction_id,status:'cancelled',activity_id:event.id,user_id:peer.member_id,reason:'activity_closed'};
   const fingerprint=createHash('sha256').update(JSON.stringify(['herstory-host-cancel-v1',data.interaction_id,board.id,peer.id,event.id])).digest('hex');
   db.raw.prepare('INSERT INTO hardware_host_receipts VALUES(?,?,?,?,?,?,?)').run(data.interaction_id,board.id,peer.id,event.id,fingerprint,JSON.stringify(receipt),time);
   db.raw.exec('COMMIT');return wrap(board,{interaction_id:data.interaction_id,activity_id:event.id,state:'cancelled',receipt,may_retry_as_new:false});
  }catch(error){db.raw.exec('ROLLBACK');throw error;}
 }

 if(method==='GET'&&op==='state')return wrap(board,{server_time:now(),activities:hostActivities(db,board)});
 if(method==='GET'&&op==='result'){
  const row=db.raw.prepare('SELECT receipt_json FROM hardware_host_receipts WHERE user_device_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1').get(board.id,now()-90);
  const decoded=row?JSON.parse(row.receipt_json):null;const receipt=decoded?.status==='cancelled'?null:decoded;
  return wrap(board,receipt?{state:'done',interaction_id:receipt.interaction_id,activity_id:receipt.activity_id,receipt}:{state:'idle'});
 }
 if(method==='POST'&&op==='batch'){
  if(!Array.isArray(data.participants)||!data.participants.length||data.participants.length>16||
     new Set(data.participants.map(p=>p?.user_device_id)).size!==data.participants.length||
     data.participants.some(p=>!p||p.activity_id!==data.activity_id))fail(400,'INVALID_BATCH');
  const results=[];
  for(const participant of data.participants){
   try{
    const response=await hostRoute(db,board,'POST','/local/host/submit',participant,all);
    const receipt=JSON.parse((await response.json()).payload);
    results.push({user_device_id:participant.user_device_id,status:receipt.duplicate?'duplicate':'checked_in'});
   }catch(e){if(!(e instanceof HardwareError))throw e;results.push({user_device_id:participant.user_device_id,status:'rejected',code:e.code});}
  }
  return wrap(board,{state:'batch_done',results});
 }
 if(method!=='POST'||!['nearby','submit'].includes(op))fail(405,'METHOD_NOT_ALLOWED');
 const peer=all.find(b=>b.id===data.user_device_id&&b.role==='user'&&b.member_id!==board.member_id);if(!peer)fail(403,'INVALID_PARTICIPANT');
 const fields=['herstory-host-checkin-v1',data.interaction_id,board.id,peer.id,data.activity_id,data.presence_epoch,data.presence_tag,data.occurred_at,true];
 const hash=createHash('sha256').update(JSON.stringify(fields)).digest('hex');
 if(op==='submit'){
  if(!uuid(data.interaction_id)||data.host_device_id!==board.id||data.host_confirmed!==true)fail(400,'INVALID_HOST_CONFIRMATION');
  verify(board,fields,data.host_proof);
  const old=db.raw.prepare('SELECT * FROM hardware_host_receipts WHERE interaction_id=?').get(data.interaction_id);
  if(old){if(old.host_device_id!==board.id||old.payload_hash!==hash)fail(409,'EVENT_ID_CONFLICT');return wrap(board,JSON.parse(old.receipt_json));}
 }
 if(!hostActivities(db,board).some(e=>e.id===data.activity_id))fail(403,'HOST_NOT_AUTHORIZED');
 presence(peer,data);
 if(!db.raw.prepare("SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=?").get(data.activity_id,peer.member_id))fail(403,'NOT_REGISTERED');
 if(op==='nearby')return wrap(board,{activity_id:data.activity_id,user_device_id:peer.id,user_label:peer.nickname,name_bitmap:await nameBitmap(peer.nickname),presence_tag:data.presence_tag});
 if(!Number.isSafeInteger(data.occurred_at)||Math.abs(now()-data.occurred_at)>90)fail(409,'CONFIRMATION_EXPIRED');
 db.raw.exec('BEGIN IMMEDIATE');
 try{
  const receipt=saveHostAttendance(db,{board,peer,activityId:data.activity_id,interactionId:data.interaction_id,payloadHash:hash});
  db.raw.exec('COMMIT');return wrap(board,receipt);
 }catch(e){db.raw.exec('ROLLBACK');throw e;}
}
export async function cloudRoute(request,env,url,authenticated,readBody) {
 const data=request.method==='POST'?await readBody(request):{};
 // Serialise read/modify/write of persisted sessions within this single Node service.
 const db=env.DB,previous=queues.get(db)||Promise.resolve();
 const job=previous.catch(()=>{}).then(async()=>{
  const all=boards(db),board=all.find(b=>b.id===authenticated.id);if(!board)fail(401,'DEVICE_REVOKED');
  try{
   if(url.pathname.startsWith('/local/checkin/'))return await checkinSession(db,board,request.method,url.pathname,data,all);
   if(url.pathname.startsWith('/local/friend/'))return await friendSession(db,board,request.method,url.pathname,data,all,url);
   if(url.pathname.startsWith('/local/host/'))return await hostRoute(db,board,request.method,url.pathname,data,all);
   fail(404,'UNKNOWN_ROUTE');
  }catch(e){if(e instanceof HardwareError)throw e;if(/^[A-Z][A-Z0-9_]{1,63}$/.test(e.message))throw new HardwareError(409,'INTERACTION_REJECTED',e.message);
   throw new HardwareError(503,'INTERACTION_UNAVAILABLE','交互服务暂不可用，请稍后重试');}
 });
 queues.set(db,job);return job;
}
export async function cloudAdminRoute(request,env,url,admin,readBody) {
 const db=env.DB,p=url.pathname;
 if(p==='/api/admin/hardware'&&request.method==='GET')return json({devices:boards(db).map(({token_hash,...b})=>({...b,rgb565_byte_order:db.raw.prepare('SELECT rgb565_byte_order FROM device_hardware_profiles WHERE device_id=?').get(b.id)?.rgb565_byte_order,station_device_id:db.raw.prepare('SELECT station_device_id FROM hardware_cloud_settings WHERE device_id=?').get(b.id)?.station_device_id})),station_activities:db.raw.prepare('SELECT * FROM checkin_station_activities').all(),host_grants:db.raw.prepare('SELECT * FROM hardware_host_grants').all()});
 if(p!=='/api/admin/hardware/configure'||request.method!=='PUT')return null;
 const data=await readBody(request);
 if(!uuid(data.device_id)||Number(data.station_device_id!==undefined)+Number(data.host_activity_id!==undefined)!==1)fail(400,'INVALID_CONFIGURATION');
 const all=boards(db),board=all.find(b=>b.id===data.device_id);if(!board)fail(404,'DEVICE_NOT_FOUND');
 if(data.station_device_id!==undefined){
  if(board.role==='checkin'||data.station_device_id!==null&&!all.some(b=>b.id===data.station_device_id&&b.role==='checkin'))fail(400,'INVALID_STATION');
  db.raw.prepare('INSERT INTO hardware_cloud_settings VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET station_device_id=excluded.station_device_id').run(board.id,data.station_device_id);
 }
 if(data.host_activity_id!==undefined){
  const e=db.raw.prepare('SELECT host_id FROM events WHERE id=? AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)').get(data.host_activity_id);
  if(board.role==='checkin'||!e||e.host_id!==board.member_id)fail(403,'EVENT_OWNER_REQUIRED');
  if(data.enabled===false)db.raw.prepare('DELETE FROM hardware_host_grants WHERE device_id=? AND activity_id=?').run(board.id,data.host_activity_id);
  else if(data.enabled===true)db.raw.prepare('INSERT OR IGNORE INTO hardware_host_grants VALUES(?,?,?)').run(board.id,data.host_activity_id,admin.id);
  else fail(400,'ENABLED_REQUIRED');
 }
 return json({status:'configured'});
}
