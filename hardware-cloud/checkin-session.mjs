// Adapted from the hardware LAN session protocol; signing receives the stored token hash.
import {createHmac,randomUUID,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
const key=t=>Buffer.from(t,'hex');
export const sign=(token,text)=>createHmac('sha256',key(token)).update(text).digest('hex');
export const equal=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export const canonical=s=>JSON.stringify(['herstory-hardware-v1','checkin',s.interaction_id,s.station_device_id,s.user_device_id,s.activity_id,s.nonce,s.confirmation_code,s.occurred_at,true]);
export class CheckinSessions {
 constructor(fixture,submit,clock=()=>Math.floor(Date.now()/1000)){this.f=fixture;this.submit=submit;this.clock=clock;this.current=null;this.selected=fixture.activities?.[0]||fixture.activity;this.station=fixture.boards.find(b=>b.role==='checkin');}
 expire(){if(this.current&&this.clock()-this.current.occurred_at>90)this.current=null;}
 wrap(board,state){const payload=JSON.stringify({recipient_device_id:board.id,...state});return{payload,signature:sign(board.token_hash,payload)};}
 async route(board,method,path,data={}){
  this.expire();const station=board.role==='checkin';let s=this.current;
  if(path==='/local/checkin/activities'&&method==='GET'){
   if(!station)throw Error('STATION_ONLY');return this.wrap(board,{state:'idle',activities:this.f.activities||[this.f.activity],selected_activity_id:this.selected.id});
  }
  if(path==='/local/checkin/select'&&method==='POST'){
   if(!station)throw Error('STATION_ONLY');if(s&&!['done','failed'].includes(s.state))throw Error('SESSION_ACTIVE');
   const choice=(this.f.activities||[this.f.activity]).find(a=>a.id===data.activity_id);if(!choice)throw Error('UNKNOWN_ACTIVITY');
   this.selected=choice;this.current=null;return this.wrap(board,{state:'idle',activity_id:choice.id,activity_label:choice.label||'CHECK-IN'});
  }
  if(path==='/local/checkin/request'&&method==='POST'){
   if(station)throw Error('USER_ONLY');
   if(!this.station)throw Error('STATION_UNAVAILABLE');
   if(s&&s.state!=='done'&&s.state!=='failed'){
    if(s.user_device_id!==board.id)throw Error('STATION_BUSY');
   }else{
    s={state:'waiting',interaction_id:randomUUID(),station_device_id:this.station.id,user_device_id:board.id,
     activity_id:this.selected.id,activity_label:this.selected.label||'CHECK-IN',nonce:randomBytes(16).toString('hex'),confirmation_code:String(randomInt(1000,10000)),occurred_at:this.clock(),user_label:board.role.toUpperCase()};
    this.current=s;
   }
  }else if(path==='/local/checkin/session'&&method==='GET'){
   if(!s||(!station&&s.user_device_id!==board.id))return this.wrap(board,{state:'idle',activity_id:this.selected.id,activity_label:this.selected.label||'CHECK-IN'});
  }else{
   if(!s||data.interaction_id!==s.interaction_id||(!station&&s.user_device_id!==board.id))throw Error('SESSION_MISMATCH');
   if(path==='/local/checkin/cancel'&&method==='POST'){
    if(s.state==='submitting')throw Error('SUBMISSION_PENDING');this.current=null;return this.wrap(board,{state:'idle'});
   }else if(path==='/local/checkin/confirm'&&method==='POST'){
    if(station||!['waiting','confirmed'].includes(s.state))throw Error('NOT_WAITING');
    if(!equal(data.user_proof,sign(board.token_hash,canonical(s))))throw Error('INVALID_PROOF');
    s.user_proof=data.user_proof;s.state='confirmed';
   }else if(path==='/local/checkin/submit'&&method==='POST'){
    if(!station)throw Error('STATION_ONLY');
    if(s.state==='done')return this.wrap(board,this.public(s));
    if(s.state!=='confirmed'&&s.state!=='failed')throw Error('USER_NOT_CONFIRMED');
    s.state='submitting';
    try{
     const body={interaction_id:s.interaction_id,station_device_id:s.station_device_id,user_device_id:s.user_device_id,activity_id:s.activity_id,
      nonce:s.nonce,confirmation_code:s.confirmation_code,occurred_at:s.occurred_at,user_confirmed:true,user_proof:s.user_proof};
     const r=await this.submit(board,body);
     if(!r||r.interaction_id!==s.interaction_id||r.status!=='checked_in'||typeof r.duplicate!=='boolean')throw Error('INVALID_BACKEND_RECEIPT');
     s.receipt=r;s.state='done';
    }catch(e){s.state='failed';s.error='Backend unavailable or rejected; OK to retry';}
   }else throw Error('UNKNOWN_ROUTE');
  }
  return this.wrap(board,this.public(s));
 }
 public(s){const {user_proof,...state}=s;return state;}
}
