import {randomUUID,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {sign,equal} from './checkin-session.mjs';
export const FRIEND_MIN_RSSI=-60;
export const FRIEND_RETAIN_RSSI=-68;
export const friendCanonical=s=>JSON.stringify(['herstory-hardware-v1','friend',s.interaction_id,s.device_a_id,s.device_b_id,s.nonce,s.confirmation_code,s.occurred_at,true,true]);
export class FriendSessions {
 constructor(f,submit,clock=()=>Math.floor(Date.now()/1000)) {
  this.f=f;this.submit=submit;this.clock=clock;this.waiters=new Map();this.byBoard=new Map();this.sessions=new Map();this.reports=new Map();this.sequence=0;
 }
 wrap(b,s){const payload=JSON.stringify({...s,recipient_device_id:b.id});return{payload,signature:sign(b.token_hash,payload)};}
 expire(){
  const t=this.clock();
  for(const [id,w] of this.waiters)if(t-w.time>=90){this.waiters.delete(id);this.reports.delete(id);}
  for(const [id,s] of this.sessions)if(s.state!=='submitting'&&t-s.occurred_at>=90){this.remove(s);this.sessions.delete(id);}
  for(const [id,peers] of this.reports){for(const [peer,e] of peers)if(t-e.time>=5)peers.delete(peer);if(!peers.size)this.reports.delete(id);}
 }
 remove(s){for(const id of [s.device_a_id,s.device_b_id])if(this.byBoard.get(id)===s){this.byBoard.delete(id);this.reports.delete(id);}}
 near(a,b){const t=this.clock(),ab=this.reports.get(a)?.get(b),ba=this.reports.get(b)?.get(a);return Boolean(ab&&ba&&t-ab.time<5&&t-ba.time<5);}
 view(s){const{a_proof,b_proof,...rest}=s;return {...rest,proximity_ready:this.near(s.device_a_id,s.device_b_id)};}
 response(board){const s=this.byBoard.get(board.id);return this.wrap(board,s?this.view(s):{state:this.waiters.has(board.id)?'searching':'idle'});}
 match(){
  const queue=[...this.waiters.values()].sort((a,b)=>a.order-b.order);
  for(let i=0;i<queue.length;i++){
   const a=queue[i];if(!this.waiters.has(a.board.id))continue;
   for(let j=i+1;j<queue.length;j++){
    const b=queue[j];if(!this.waiters.has(b.board.id)||!this.near(a.board.id,b.board.id))continue;
    const boards=[a.board,b.board].sort((x,y)=>x.id.localeCompare(y.id)),ids=boards.map(x=>x.id);
    const s={state:'waiting',interaction_id:randomUUID(),device_a_id:ids[0],device_b_id:ids[1],
     device_a_label:boards[0].nickname||'USER',device_b_label:boards[1].nickname||'USER',
     nonce:randomBytes(16).toString('hex'),confirmation_code:String(randomInt(1000,10000)),occurred_at:this.clock(),a_confirmed:false,b_confirmed:false};
    this.sessions.set(s.interaction_id,s);
    for(const id of ids){this.waiters.delete(id);this.byBoard.set(id,s);}break;
   }
  }
 }
 observe(board,data){
  if(!this.waiters.has(board.id)&&!this.byBoard.has(board.id))throw Error('NOT_SEARCHING');
  if(!Array.isArray(data.observations)||data.observations.length>16)throw Error('INVALID_OBSERVATIONS');
  const peers=new Map(),seen=new Set(),t=this.clock();
  for(const e of data.observations){
   if(!e||typeof e.peer_device_id!=='string')throw Error('INVALID_OBSERVATIONS');
   const peer=this.f.boards.find(b=>b.id===e.peer_device_id&&b.role!=='checkin'&&b.member_id!==board.member_id);
   if(!peer)continue; // Ignore unrelated or retired beacons without granting proximity.
   if(peer.id===board.id||seen.has(peer.id)||!Number.isSafeInteger(e.rssi)||e.rssi< -127||e.rssi>0||
      !Number.isSafeInteger(e.age_ms)||e.age_ms<0||e.age_ms>=5000||
      !Number.isSafeInteger(e.presence_epoch)||e.presence_epoch<1||Math.abs(t-e.presence_epoch)>20||
      typeof e.presence_tag!=='string'||!/^[a-f0-9]{12}$/.test(e.presence_tag))throw Error('INVALID_OBSERVATIONS');
   const expected=sign(peer.token_hash,JSON.stringify(['herstory-presence-v1',peer.id,e.presence_epoch])).slice(0,12);
   if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(e.presence_tag,'hex')))throw Error('INVALID_PRESENCE');
   seen.add(peer.id);
   const pair=this.byBoard.get(board.id),previous=this.reports.get(board.id)?.get(peer.id);
   const paired=pair&&(pair.device_a_id===peer.id||pair.device_b_id===peer.id);
   const retained=paired&&previous&&t-previous.time<5&&e.rssi>=FRIEND_RETAIN_RSSI;
   if(e.rssi>=FRIEND_MIN_RSSI||retained)peers.set(peer.id,{time:t-e.age_ms/1000});
  }
  this.reports.set(board.id,peers);this.match();
 }
 async route(board,method,path,data={}) {
  if(board.role==='checkin')throw Error('USER_ONLY');this.expire();
  let s=this.byBoard.get(board.id);
  if(path==='/local/friend/request'&&method==='POST'){
   if(s&&!['done'].includes(s.state))return this.response(board);
   if(s)this.byBoard.delete(board.id);
   if(!this.waiters.has(board.id)){this.reports.delete(board.id);this.waiters.set(board.id,{board,time:this.clock(),order:++this.sequence});}
   this.match();return this.response(board);
  }
  if(path==='/local/friend/session'&&method==='GET')return this.response(board);
  if(path==='/local/friend/nearby'&&method==='POST'){this.observe(board,data);return this.response(board);}
  if(path==='/local/friend/cancel'&&method==='POST'){
   if(s&&s.state==='submitting')throw Error('SUBMITTING');
   if(s&&data.interaction_id!==s.interaction_id)throw Error('SESSION_MISMATCH');
   this.waiters.delete(board.id);this.reports.delete(board.id);
   if(s){if(s.state==='done')this.byBoard.delete(board.id);else{this.remove(s);this.sessions.delete(s.interaction_id);}}
   this.match();return this.response(board);
  }
  if(path!=='/local/friend/confirm'||method!=='POST')throw Error('UNKNOWN_ROUTE');
  if(!s||s.interaction_id!==data.interaction_id)throw Error('SESSION_MISMATCH');
  if(s.state==='done'||s.state==='submitting')return this.response(board);
  if(!['waiting','failed'].includes(s.state))throw Error('NOT_WAITING');
  if(!this.near(s.device_a_id,s.device_b_id))return this.response(board);
  if(!equal(data.user_proof,sign(board.token_hash,friendCanonical(s))))throw Error('INVALID_PROOF');
  const side=board.id===s.device_a_id?'a':'b';s[side+'_confirmed']=true;s[side+'_proof']=data.user_proof;
  if(s.a_confirmed&&s.b_confirmed){
   s.state='submitting';
   try{const receipt=await this.submit(board,{interaction_id:s.interaction_id,device_a_id:s.device_a_id,device_b_id:s.device_b_id,
     nonce:s.nonce,confirmation_code:s.confirmation_code,occurred_at:s.occurred_at,a_confirmed:true,b_confirmed:true,a_proof:s.a_proof,b_proof:s.b_proof});
    if(receipt?.interaction_id!==s.interaction_id||receipt.status!=='connected'||typeof receipt.duplicate!=='boolean')throw Error('BAD_RECEIPT');s.receipt=receipt;s.state='done';
    this.reports.delete(s.device_a_id);this.reports.delete(s.device_b_id);
   }catch{s.state='failed';}
  }
  return this.response(board);
 }
}
