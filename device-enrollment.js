import { nameBitmap } from './hardware-cloud/name-bitmap.mjs';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { HardwareError, hardwareKind } from './hardware.js';
const now=()=>Math.floor(Date.now()/1000);
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const fail=(status,code,message)=>{throw new HardwareError(status,code,message);};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function transaction(db,fn){db.raw.exec('BEGIN IMMEDIATE');try{const result=fn();db.raw.exec('COMMIT');return result;}catch(e){db.raw.exec('ROLLBACK');throw e;}}
async function signed(board,data){if(data.state==='pending')data={...data,member_label_bitmap:await nameBitmap(data.member_label)};if(data.state==='bound'){data={...data,member_name_bitmap:await nameBitmap(data.member_name,true)};}const payload=JSON.stringify({...data,recipient_device_id:board.id});return json({payload,signature:createHmac('sha256',Buffer.from(board.token_hash,'hex')).update(payload).digest('hex')});}
function audit(db,row,action){db.raw.prepare('INSERT INTO device_claim_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),row.id,row.requested_member_id,row.requested_by,action,now());}
function memberAvailable(db,id){
 const member=db.raw.prepare("SELECT id,nickname,email FROM members WHERE id=? AND status!='disabled'").get(id);
 if(!member)fail(404,'MEMBER_NOT_FOUND','成员不存在或已停用');
 if(db.raw.prepare('SELECT 1 FROM devices WHERE member_id=? AND revoked_at IS NULL').get(id))fail(409,'MEMBER_ALREADY_BOUND','该成员已有可用设备，请先核对并撤销旧设备');
 return member;
}
function issueCode(db,row){
 if(row.bound_at)return row;
 if(row.claim_code&&row.expires_at>now())return row;
 db.raw.prepare('UPDATE device_inventory SET claim_code=NULL,request_id=NULL,requested_member_id=NULL,requested_by=NULL WHERE bound_at IS NULL AND expires_at<=?').run(now());
 const occupied=new Set(db.raw.prepare('SELECT claim_code FROM device_inventory WHERE claim_code IS NOT NULL').all().map(r=>r.claim_code));
 if(occupied.size>=10000)fail(503,'CODES_BUSY','设备绑定码暂时用尽，请稍后重试');
 const start=randomInt(10000);let code;
 for(let i=0;i<10000;i++){const candidate=String((start+i)%10000).padStart(4,'0');if(!occupied.has(candidate)){code=candidate;break;}}
 db.raw.prepare('UPDATE device_inventory SET claim_code=?,expires_at=?,request_id=NULL,requested_member_id=NULL,requested_by=NULL WHERE id=?').run(code,now()+300,row.id);
 return db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(row.id);
}
function status(db,row){
 const bound=db.raw.prepare('SELECT d.*,m.status,m.nickname FROM devices d JOIN members m ON m.id=d.member_id WHERE d.id=?').get(row.id);
 if(bound){
  if(bound.revoked_at||bound.status==='disabled')return {state:'revoked'};
  const station=db.raw.prepare('SELECT station_device_id FROM hardware_cloud_settings WHERE device_id=?').get(row.id)?.station_device_id||'';
  return {state:'bound',member_id:bound.member_id,member_name:[...bound.nickname.normalize('NFC')].slice(0,32).join(''),device_kind:hardwareKind(db,row.id),station_device_id:station};
 }
 if(row.bound_at)return {state:'revoked'};
 const live=issueCode(db,row);
 let member=null;if(live.request_id)member=db.raw.prepare("SELECT id,nickname,email FROM members WHERE id=? AND status!='disabled'").get(live.requested_member_id);
 const hint=member?member.email.slice(0,2)+'***'+member.email.slice(member.email.indexOf('@')):'';
 return {state:member?'pending':'unbound',claim_code:live.claim_code,expires_at:live.expires_at,server_time:now(),...(member?{request_id:live.request_id,member_id:member.id,member_label:member.nickname,member_hint:hint}:{})};
}
export async function enrollmentRoute(request,env,url,readBody){
 const db=env.DB,p=url.pathname,method=request.method;
 if(p==='/api/device-enrollment/register'&&method==='POST'){
  const key=env.DEVICE_ENROLLMENT_KEY,provided=/^Enrollment ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')?.[1];
  if(!hex(key)||!provided||!timingSafeEqual(Buffer.from(hash(key),'hex'),Buffer.from(hash(provided),'hex')))fail(403,'ENROLLMENT_DISABLED','设备初始化未获授权');
  const data=await readBody(request);
  if(!uuid(data.device_id)||!hex(data.token_hash))fail(400,'INVALID_DEVICE','设备初始化信息无效');
  const row=transaction(db,()=>{
   let old=db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(data.device_id);
   if(old){if(old.token_hash!==data.token_hash)fail(409,'IDENTITY_CONFLICT','设备身份冲突');return old;}
   if(db.raw.prepare('SELECT 1 FROM devices WHERE id=? OR token_hash=?').get(data.device_id,data.token_hash)||db.raw.prepare('SELECT 1 FROM device_inventory WHERE token_hash=?').get(data.token_hash))fail(409,'IDENTITY_CONFLICT','设备身份冲突');
   if(db.raw.prepare('SELECT COUNT(*) n FROM device_inventory').get().n>=1000)fail(503,'INVENTORY_FULL','设备初始化数量已达上限，请联系管理员');
   db.raw.prepare('INSERT INTO device_inventory(id,token_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run(data.device_id,data.token_hash,now(),now());
   return db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(data.device_id);
  });
  return signed(row,transaction(db,()=>status(db,row)));
 }
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')?.[1];
 if(!token)fail(401,'INVALID_DEVICE','设备身份无效');
 // Existing manually provisioned boards may also fetch their runtime identity.
 const row=db.raw.prepare('SELECT * FROM device_inventory WHERE token_hash=?').get(hash(token));
 if(!row){
  const legacy=db.raw.prepare('SELECT * FROM devices WHERE token_hash=?').get(hash(token));
  if(legacy&&method==='GET'&&p==='/api/device-enrollment/status')return signed(legacy,status(db,legacy));
  fail(401,'INVALID_DEVICE','设备身份无效');
 }
 if(method==='GET'&&p==='/api/device-enrollment/status')return signed(row,transaction(db,()=>{db.raw.prepare('UPDATE device_inventory SET last_seen_at=? WHERE id=?').run(now(),row.id);return status(db,row);}));
 if(method!=='POST'||p!=='/api/device-enrollment/confirm')fail(404,'UNKNOWN_ROUTE','接口不存在');
 const data=await readBody(request);
 if(!uuid(data.request_id)||!['accept','reject'].includes(data.decision))fail(400,'INVALID_CONFIRMATION','绑定确认无效');
 return signed(row,transaction(db,()=>{
  const live=db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(row.id);
  if(live.request_id!==data.request_id)fail(409,'CLAIM_CHANGED','绑定申请已改变，请重新确认');
  if(live.bound_at)return status(db,live); // Lost response: replay returns the completed binding.
  if(live.expires_at<=now())fail(409,'CLAIM_EXPIRED','设备绑定码已过期，请重新申请');
  if(data.decision==='reject'){
   audit(db,live,'rejected');db.raw.prepare('UPDATE device_inventory SET claim_code=NULL,expires_at=0,request_id=NULL,requested_member_id=NULL,requested_by=NULL WHERE id=?').run(live.id);
   return status(db,db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(live.id));
  }
  memberAvailable(db,live.requested_member_id);
  const admin=db.raw.prepare("SELECT 1 FROM members WHERE id=? AND role='admin' AND status!='disabled'").get(live.requested_by);
  if(!admin)fail(403,'ADMIN_REVOKED','操作管理员权限已撤销，请重新申请');
  db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(live.id,live.requested_member_id,live.token_hash,now());
  db.raw.prepare("INSERT INTO device_hardware_profiles VALUES(?,'user','little',?,?)").run(live.id,live.requested_by,now());
  db.raw.prepare('UPDATE device_inventory SET bound_at=?,claim_code=NULL WHERE id=?').run(now(),live.id);
  audit(db,live,'bound');return status(db,db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(live.id));
 }));
}
export async function enrollmentAdminRoute(request,env,url,admin,readBody){
 const db=env.DB,p=url.pathname;
 const match=/^\/api\/admin\/members\/([a-f0-9-]{36})\/device-claims$/.exec(p);
 if(!match)return null;
 if(request.method==='GET'){
  const id=url.searchParams.get('request_id');if(!uuid(id))fail(400,'INVALID_REQUEST','绑定申请无效');
  const row=db.raw.prepare('SELECT * FROM device_inventory WHERE request_id=? AND requested_member_id=? AND requested_by=?').get(id,match[1],admin.id);
  if(!row)fail(404,'CLAIM_NOT_FOUND','绑定申请不存在');
  return json({request_id:id,device_id:row.id,state:row.bound_at?'bound':row.expires_at<=now()?'expired':'pending'});
 }
 if(request.method==='DELETE'){
  const data=await readBody(request);
  const row=db.raw.prepare('SELECT * FROM device_inventory WHERE request_id=? AND requested_member_id=? AND requested_by=? AND bound_at IS NULL').get(typeof data.request_id==='string'?data.request_id:'',match[1],admin.id);
  if(row){audit(db,row,'cancelled');db.raw.prepare('UPDATE device_inventory SET request_id=NULL,requested_member_id=NULL,requested_by=NULL WHERE id=?').run(row.id);}
  return json({ok:true});
 }
 if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方法无效');
 const data=await readBody(request);
 if(typeof data.code!=='string'||!/^\d{4}$/.test(data.code))fail(400,'INVALID_CODE','请输入板子屏幕上的四位数字，保留开头的零');
 db.raw.prepare('DELETE FROM device_claim_attempts WHERE attempted_at<?').run(now()-600);
 if(db.raw.prepare('SELECT COUNT(*) n FROM device_claim_attempts WHERE admin_id=? AND attempted_at>?').get(admin.id,now()-60).n>=5)fail(429,'TOO_MANY_ATTEMPTS','输错次数过多，请一分钟后再试');
 const candidate=db.raw.prepare('SELECT * FROM device_inventory WHERE claim_code=? AND expires_at>? AND bound_at IS NULL').get(data.code,now());
 if(!candidate){db.raw.prepare('INSERT INTO device_claim_attempts VALUES(?,?)').run(admin.id,now());fail(404,'CODE_NOT_FOUND','未找到有效设备绑定码，请核对板子屏幕');}
 const result=transaction(db,()=>{
  const member=memberAvailable(db,match[1]);
  const row=db.raw.prepare('SELECT * FROM device_inventory WHERE id=?').get(candidate.id);
  if(row.bound_at||row.claim_code!==data.code||row.expires_at<=now())fail(409,'CLAIM_EXPIRED','设备绑定码已过期，请重新读取板子屏幕');
  if(db.raw.prepare('SELECT 1 FROM device_inventory WHERE requested_member_id=? AND id!=? AND bound_at IS NULL AND expires_at>? AND request_id IS NOT NULL').get(member.id,row.id,now()))fail(409,'MEMBER_CLAIM_PENDING','该成员已有待确认的领用申请，请先完成或取消');
  if(row.request_id&&(row.requested_member_id!==member.id||row.requested_by!==admin.id))fail(409,'CLAIM_BUSY','这块板子正在等待另一条绑定确认');
  const id=row.request_id||randomUUID();
  db.raw.prepare('UPDATE device_inventory SET request_id=?,requested_member_id=?,requested_by=? WHERE id=?').run(id,member.id,admin.id,row.id);
  if(!row.request_id)audit(db,{...row,requested_member_id:member.id,requested_by:admin.id},'requested');
  return {request_id:id,device_id:row.id,state:'pending',expires_at:row.expires_at,member_id:member.id,member_label:member.nickname};
 });
 return json(result);
}
