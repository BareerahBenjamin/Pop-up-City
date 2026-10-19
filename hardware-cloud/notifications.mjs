import {HardwareError,hardwareKind} from '../hardware.js';
import {sign} from './checkin-session.mjs';
const now=()=>Math.floor(Date.now()/1000);
const fail=(status,code,message)=>{throw new HardwareError(status,code,message);};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
function transaction(db,fn){db.raw.exec('BEGIN IMMEDIATE');try{const value=fn();db.raw.exec('COMMIT');return value;}catch(e){db.raw.exec('ROLLBACK');throw e;}}
function board(db,reporter){const b=db.raw.prepare("SELECT d.* FROM devices d JOIN members m ON m.id=d.member_id WHERE d.id=? AND d.token_hash=? AND d.revoked_at IS NULL AND m.status!='disabled'").get(reporter.id,reporter.token_hash);if(!b)fail(401,'INVALID_DEVICE','设备不可用');if(hardwareKind(db,b.id)!=='user')fail(403,'USER_ONLY','仅成员板可使用');return b;}
// Called in the same transaction as a newly committed host check-in.
export function enqueueCheckinFeedback(db,{deviceId,interactionId,activityId,time=now()}){
 const live=db.raw.prepare('SELECT * FROM device_feedback_sessions WHERE device_id=? AND expires_at>?').get(deviceId,time);
 if(!live)return;
 const event=db.raw.prepare('SELECT ends_at FROM events WHERE id=?').get(activityId);
 db.raw.prepare('INSERT OR IGNORE INTO device_notifications(device_id,session_id,interaction_id,activity_id,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(deviceId,live.session_id,interactionId,activityId,time,Math.min(time+10,live.expires_at,event.ends_at));
}
export function feedbackSession(db,reporter,sessionId,time=now()){
 if(!uuid(sessionId))fail(400,'INVALID_SESSION','需要小写UUID会话编号');
 return transaction(db,()=>{const b=board(db,reporter),old=db.raw.prepare('SELECT * FROM device_feedback_sessions WHERE device_id=?').get(b.id);
  // A session ID must be fresh after reconnect; expired same-ID retries cannot revive its backlog.
  if(old?.session_id===sessionId){if(old.expires_at<=time)fail(409,'SESSION_EXPIRED','重连需要新会话');return {session_id:sessionId,expires_at:old.expires_at,poll_after_ms:2000};}
  if(db.raw.prepare('SELECT 1 FROM device_feedback_session_ids WHERE session_id=?').get(sessionId))fail(409,'SESSION_REUSED','需要新的会话编号');
  db.raw.prepare('INSERT INTO device_feedback_session_ids VALUES(?,?)').run(sessionId,b.id);
  db.raw.prepare('INSERT INTO device_feedback_sessions VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET session_id=excluded.session_id,expires_at=excluded.expires_at').run(b.id,sessionId,time+10);
  return {session_id:sessionId,expires_at:time+10,poll_after_ms:2000};
 });
}
export function feedbackPoll(db,reporter,sessionId,time=now()){
 return transaction(db,()=>{const b=board(db,reporter);const s=db.raw.prepare('SELECT * FROM device_feedback_sessions WHERE device_id=? AND session_id=? AND expires_at>?').get(b.id,sessionId,time);
  if(!s)fail(409,'SESSION_EXPIRED','请建立新会话');
  db.raw.prepare('UPDATE device_feedback_sessions SET expires_at=? WHERE device_id=?').run(time+10,b.id);
  const rows=db.raw.prepare(`SELECT n.* FROM device_notifications n JOIN events e ON e.id=n.activity_id WHERE n.device_id=? AND n.session_id=? AND n.acked_at IS NULL AND n.expires_at>? AND e.status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) AND e.ends_at>? ORDER BY n.id LIMIT 30`).all(b.id,sessionId,time,time);
  return {session_id:sessionId,server_time:time,expires_at:time+10,poll_after_ms:2000,items:rows.map(n=>({notification_id:n.id,interaction_id:n.interaction_id,activity_id:n.activity_id,created_at:n.created_at,expires_at:n.expires_at,feedback:'checkin_pulse',duration_ms:1000}))};
 });
}
export function feedbackAck(db,reporter,{session_id,notification_ids},time=now()){
 if(!Array.isArray(notification_ids)||notification_ids.length>30||notification_ids.some(x=>!Number.isSafeInteger(x)||x<1))fail(400,'INVALID_ACK','通知编号不合法');
 return transaction(db,()=>{const b=board(db,reporter),s=db.raw.prepare('SELECT * FROM device_feedback_sessions WHERE device_id=? AND session_id=?').get(b.id,session_id);if(!s)fail(409,'SESSION_EXPIRED','会话已更换');
  for(const id of notification_ids)db.raw.prepare('UPDATE device_notifications SET acked_at=COALESCE(acked_at,?) WHERE id=? AND device_id=? AND session_id=?').run(time,id,b.id,session_id);
  return {session_id,acknowledged:true,feedback:'none'};
 });
}
export async function notificationRoute(request,env,url,reporter,readBody){
 const path=url.pathname;if(!['/api/device/feedback/session','/api/device/feedback','/api/device/feedback/ack'].includes(path))return null;
 let data;if(path.endsWith('/session')&&request.method==='POST')data=feedbackSession(env.DB,reporter,(await readBody(request)).session_id);
 else if(path.endsWith('/ack')&&request.method==='POST')data=feedbackAck(env.DB,reporter,await readBody(request));
 else if(path==='/api/device/feedback'&&request.method==='GET')data=feedbackPoll(env.DB,reporter,url.searchParams.get('session_id'));
 else fail(405,'METHOD_NOT_ALLOWED','请求方法不支持');
 const payload=JSON.stringify({...data,recipient_device_id:reporter.id});return new Response(JSON.stringify({payload,signature:sign(reporter.token_hash,payload)}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
