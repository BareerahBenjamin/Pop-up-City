import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openDatabase,migrate} from '../../database.js';
import api from '../../api.js';
import {sign} from '../../hardware-cloud/checkin-session.mjs';
import {stepBatch} from '../../hardware-cloud/host-batches.mjs';
const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','88888888-8888-8888-8888-888888888888'];
const [device,member,event,batch,session,retry,peer,peerMember]=ids,token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex'),stamp=Math.floor(Date.now()/1000);
const db=openDatabase(':memory:');migrate(db);const env={DB:db,AUTH_PEPPER:'firmware-cloud-isolated-pepper-000000',PUBLIC_ORIGIN:'https://example.test'};
try{
 for(const [m,d]of[[member,device],[peerMember,peer]]){db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(m,m+'@example.test','Rae',stamp,stamp);db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(d,m,d===device?hash:createHash('sha256').update('b'.repeat(64)).digest('hex'),stamp);}
 db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,status,created_at,updated_at) VALUES(?,'AI LAB','x','learning','x',?,?,150,30,?,'published',?,?)").run(event,stamp-60,stamp+3600,member,stamp,stamp);
 for(const [i,m]of[member,peerMember].entries())db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(event,m,stamp+i);
 async function call(path,body,targetEnv=env){const response=await api.fetch(new Request('https://example.test'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),targetEnv);if(response.status!==200)throw Error(path+' '+response.status+' '+await response.text());return await response.json();}
 const vectors={presence_epoch:stamp};vectors.own_presence_tag=sign(hash,JSON.stringify(['herstory-presence-v1',device,stamp])).slice(0,12);vectors.peer_presence_tag=sign(createHash('sha256').update('b'.repeat(64)).digest('hex'),JSON.stringify(['herstory-presence-v1',peer,stamp])).slice(0,12);vectors.host_nearby=await call('/local/host/nearby',{activity_id:event,user_device_id:peer,presence_epoch:stamp,presence_tag:vectors.peer_presence_tag});vectors.roster=await call('/api/device/host/roster?activity_id='+event+'&offset=0&limit=6');vectors.runtime=await call('/api/device/runtime?view=board');vectors.own_presence_tag=sign(hash,JSON.stringify(['herstory-presence-v1',device,JSON.parse(vectors.runtime.payload).server_time])).slice(0,12);vectors.feedback_open=await call('/api/device/feedback/session',{session_id:session});

 vectors.expected_batch_proof=sign(hash,JSON.stringify(['herstory-host-batch-v1',batch,device,event,true]));
 vectors.batch_start=await call('/api/device/host/batches',{batch_id:batch,activity_id:event,host_confirmed:true,host_proof:vectors.expected_batch_proof});
 stepBatch(db,batch);db.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(stamp,peer);stepBatch(db,batch);vectors.batch_partial=await call('/api/device/host/batches/'+batch);
 vectors.feedback=await call('/api/device/feedback?session_id='+session);const notice=JSON.parse(vectors.feedback.payload).items[0];if(!notice)throw Error('No fixture notice');vectors.ack=await call('/api/device/feedback/ack',{session_id:session,notification_ids:[notice.notification_id]});
 vectors.expected_retry_proof=sign(hash,JSON.stringify(['herstory-host-batch-retry-v1',retry,batch,device,true]));vectors.batch_retry=await call('/api/device/host/batches/'+batch+'/retry',{request_id:retry,host_confirmed:true,host_proof:vectors.expected_retry_proof});vectors.operation=await call('/api/device/operations/99999999-9999-9999-9999-999999999999');
 db.raw.prepare('UPDATE devices SET revoked_at=NULL WHERE id=?').run(peer);stepBatch(db,batch);vectors.batch_completed=await call('/api/device/host/batches/'+batch);
 const singleId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',occurred=JSON.parse(vectors.runtime.payload).server_time;
 vectors.single_unknown=await call('/api/device/operations/'+singleId);
 vectors.expected_single_proof=sign(hash,JSON.stringify(['herstory-host-checkin-v1',singleId,device,peer,event,stamp,vectors.peer_presence_tag,occurred,true]));
 vectors.single=await call('/local/host/submit',{interaction_id:singleId,host_device_id:device,user_device_id:peer,activity_id:event,presence_epoch:stamp,presence_tag:vectors.peer_presence_tag,occurred_at:occurred,host_confirmed:true,host_proof:vectors.expected_single_proof});
 vectors.single_operation=await call('/api/device/operations/'+singleId);
 db.raw.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(event);vectors.runtime_closed=await call('/api/device/runtime?view=board&known_activity_id='+event);
 vectors.expected_cancel_proof=sign(hash,JSON.stringify(['herstory-host-cancel-v1',singleId,device,peer,event]));
 db.raw.prepare('DELETE FROM hardware_host_receipts WHERE interaction_id=?').run(singleId);
 vectors.single_cancel=await call('/local/host/cancel',{interaction_id:singleId,activity_id:event,user_device_id:peer,host_proof:vectors.expected_cancel_proof});
 const avatarFor=hair=>JSON.stringify({release:'herstory-avatar-assets-v1',selection:{hst_layer_hair:hair,hst_layer_body:'hst_ast_0019',hst_layer_hoodie:'hst_ast_0052'}});
 db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run(avatarFor('hst_ast_0036'),member);db.raw.prepare('UPDATE members SET avatar_json=? WHERE id=?').run(avatarFor('hst_ast_0035'),peerMember);
 vectors.friend_searching=await call('/local/friend/request',{});vectors.friend_poll=await call('/local/friend/session');
 const peerHash=createHash('sha256').update('b'.repeat(64)).digest('hex');
 async function peerCall(path,body){const response=await api.fetch(new Request('https://example.test'+path,{method:'POST',headers:{Authorization:'Bearer '+'b'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(body)}),env);if(response.status!==200)throw Error('Peer fixture '+response.status);return response.json();}
 await peerCall('/local/friend/request',{});
 const presenceEpoch=Math.floor(Date.now()/1000);
 await call('/local/friend/nearby',{observations:[{peer_device_id:peer,rssi:-45,age_ms:0,presence_epoch:presenceEpoch,presence_tag:sign(peerHash,JSON.stringify(['herstory-presence-v1',peer,presenceEpoch])).slice(0,12)}]});
 await peerCall('/local/friend/nearby',{observations:[{peer_device_id:device,rssi:-45,age_ms:0,presence_epoch:presenceEpoch,presence_tag:sign(hash,JSON.stringify(['herstory-presence-v1',device,presenceEpoch])).slice(0,12)}]});
 vectors.friend_waiting=await call('/local/friend/session');const paired=JSON.parse(vectors.friend_waiting.payload);
 const canonical=JSON.stringify(['herstory-hardware-v1','friend',paired.interaction_id,paired.device_a_id,paired.device_b_id,paired.nonce,paired.confirmation_code,paired.occurred_at,true,true]);
 vectors.expected_friend_proof=sign(hash,canonical);
 vectors.friend_confirmed=await call('/local/friend/confirm',{interaction_id:paired.interaction_id,user_proof:vectors.expected_friend_proof});
 await peerCall('/local/friend/confirm',{interaction_id:paired.interaction_id,user_proof:sign(peerHash,canonical)});
 vectors.friend_done=await call('/local/friend/session');vectors.friend_operation_id=paired.interaction_id;vectors.friend_operation=await call('/api/device/operations/'+paired.interaction_id);
 const retiredId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 vectors.expected_friend_retire_proof=sign(hash,JSON.stringify(['herstory-friend-retire-v1',retiredId,device,peer,paired.nonce,paired.confirmation_code,paired.occurred_at]));
 vectors.friend_retire=await call('/local/friend/retire',{interaction_id:retiredId,peer_device_id:peer,nonce:paired.nonce,confirmation_code:paired.confirmation_code,occurred_at:paired.occurred_at,user_proof:vectors.expected_friend_retire_proof});
 vectors.friend_retired_operation=await call('/api/device/operations/'+retiredId);


 const enrollmentDb=openDatabase(':memory:');migrate(enrollmentDb);const enrollmentEnv={...env,DB:enrollmentDb};
 try{
  const admin='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',request='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  for(const [id,role]of[[member,'member'],[admin,'admin']])enrollmentDb.raw.prepare("INSERT INTO members(id,email,nickname,status,role,created_at,updated_at) VALUES(?,?,?,'active',?,?,?)").run(id,id+'@example.test','Rae',role,stamp,stamp);
  enrollmentDb.raw.prepare(`INSERT INTO device_inventory(id,token_hash,claim_code,expires_at,created_at,last_seen_at) VALUES(?,?,'1234',?,?,?)`).run(device,hash,stamp+300,stamp,stamp);
  vectors.enrollment_waiting=await call('/api/device-enrollment/status',null,enrollmentEnv);
  enrollmentDb.raw.prepare('UPDATE device_inventory SET request_id=?,requested_member_id=?,requested_by=? WHERE id=?').run(request,member,admin,device);
  vectors.enrollment_pending=await call('/api/device-enrollment/status',null,enrollmentEnv);
  vectors.enrollment_rejected=await call('/api/device-enrollment/confirm',{request_id:request,decision:'reject'},enrollmentEnv);
  enrollmentDb.raw.prepare(`UPDATE device_inventory SET claim_code='1234',expires_at=?,request_id=?,requested_member_id=?,requested_by=? WHERE id=?`).run(stamp+300,request,member,admin,device);
  vectors.enrollment_bound=await call('/api/device-enrollment/confirm',{request_id:request,decision:'accept'},enrollmentEnv);
  enrollmentDb.raw.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(stamp,device);
  vectors.enrollment_revoked=await call('/api/device-enrollment/status',null,enrollmentEnv);
 }finally{enrollmentDb.close();}
 writeFileSync(process.argv[2],JSON.stringify(vectors));
}finally{db.close();}
