import {enqueueCheckinFeedback} from './notifications.mjs';
import {randomUUID} from 'node:crypto';
import {HardwareError,hardwareKind} from '../hardware.js';
import {planetSnapshotInTransaction} from '../planet.js';
import {sign} from './checkin-session.mjs';
const fail=(status,code,message)=>{throw new HardwareError(status,code,message);};
export function activeHostEvent(db,board,activityId,time=Math.floor(Date.now()/1000)) {
 const valid=db.raw.prepare("SELECT 1 FROM devices d JOIN members m ON m.id=d.member_id WHERE d.id=? AND d.member_id=? AND d.token_hash=? AND d.revoked_at IS NULL AND m.status!='disabled'").get(board.id,board.member_id,board.token_hash);
 if(!valid||hardwareKind(db,board.id)!=='user')fail(403,'HOST_NOT_AUTHORIZED','发起者设备不可用');
 const event=db.raw.prepare('SELECT * FROM events WHERE id=? AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)').get(activityId);
 if(!event||event.host_id!==board.member_id)fail(403,'HOST_NOT_AUTHORIZED','无权为此活动签到');
 if(event.status!=='published'||time<event.starts_at||time>=event.ends_at)fail(409,'ACTIVITY_CLOSED','活动未开始、已结束或已取消');
 return event;
}
/** Caller owns the transaction; proximity/signature validation stays at the single/batch boundary. */
export function saveHostAttendance(db,{board,peer,activityId,interactionId,payloadHash,time=Math.floor(Date.now()/1000)}) {
 const old=db.raw.prepare('SELECT * FROM hardware_host_receipts WHERE interaction_id=?').get(interactionId);
 if(old){if(old.host_device_id!==board.id||old.payload_hash!==payloadHash)fail(409,'EVENT_ID_CONFLICT','操作编号对应的内容已改变');return JSON.parse(old.receipt_json);}
 activeHostEvent(db,board,activityId,time);
 if(!db.raw.prepare("SELECT 1 FROM devices d JOIN members m ON m.id=d.member_id WHERE d.id=? AND d.member_id=? AND d.revoked_at IS NULL AND m.status!='disabled'").get(peer.id,peer.member_id))fail(403,'INVALID_PARTICIPANT','参与者设备不可用');
 if(!db.raw.prepare('SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=?').get(activityId,peer.member_id))fail(403,'NOT_REGISTERED','成员未报名本场活动');
 const inserted=db.raw.prepare('INSERT OR IGNORE INTO checkins VALUES(?,?,?,?,?)').run(activityId,peer.member_id,peer.id,time,'host:'+interactionId).changes===1;
 if(inserted)db.raw.prepare('INSERT OR IGNORE INTO planet_settlement_tasks(activity_id,member_id,created_at) VALUES(?,?,?)').run(activityId,peer.member_id,time);
 const snapshot=planetSnapshotInTransaction(db,peer.member_id);
 const receipt={receipt_id:randomUUID(),interaction_id:interactionId,status:'checked_in',user_id:peer.member_id,activity_id:activityId,
  checked_at:db.raw.prepare('SELECT checked_at FROM checkins WHERE event_id=? AND member_id=?').get(activityId,peer.member_id).checked_at,
  duplicate:!inserted,planet_revision:snapshot.revision,growth_status:db.raw.prepare('SELECT status FROM planet_settlement_tasks WHERE activity_id=? AND member_id=?').get(activityId,peer.member_id)?.status||'pending_rules'};
 receipt.user_receipt_proof=sign(peer.token_hash,JSON.stringify(['herstory-receipt-v1',receipt.receipt_id,receipt.interaction_id,receipt.status,receipt.user_id,receipt.activity_id,receipt.checked_at,receipt.duplicate,receipt.planet_revision,receipt.growth_status]));
 db.raw.prepare('INSERT INTO hardware_host_receipts VALUES(?,?,?,?,?,?,?)').run(interactionId,board.id,peer.id,activityId,payloadHash,JSON.stringify(receipt),time);
 if(inserted)enqueueCheckinFeedback(db,{deviceId:peer.id,interactionId,activityId,time});
 return receipt;
}
