import {randomUUID} from 'node:crypto';

export const MATERIAL_MAX_BYTES=20*1024*1024;
export const MATERIAL_BODY_LIMIT=Math.ceil(MATERIAL_MAX_BYTES/3)*4+16000;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const now=()=>Math.floor(Date.now()/1000);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const metadata=row=>({id:row.id,event_id:row.event_id,title:row.title,filename:row.filename,format:row.format,byte_length:row.byte_length,version:row.version,created_at:row.created_at,updated_at:row.updated_at,
 download_url:`/api/events/${row.event_id}/materials/${row.id}/download`,...(row.format==='html'?{preview_url:`/api/events/${row.event_id}/materials/${row.id}/preview`}:{})});
function title(value){if(typeof value!=='string'||!value.trim()||value.trim().length>120)fail(400,'请填写 1–120 字的课件名称');return value.trim();}
function powerpointZip(bytes){
 if(bytes.length<22||bytes.readUInt32LE(0)!==0x04034b50)return false;
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}}
 if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)return false;
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16),names=new Set();
 if(!count||count>10000||offset+size!==end)return false;
 let cursor=offset;
 for(let i=0;i<count;i++){
  if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)return false;
  const length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
  if(cursor+46+length+extra+comment>end||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)return false;
  names.add(bytes.subarray(cursor+46,cursor+46+length).toString('utf8'));cursor+=46+length+extra+comment;
 }
 return cursor===end&&names.has('[Content_Types].xml')&&names.has('ppt/presentation.xml');
}
async function readInput(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'需要 JSON 请求');
 if(Number(request.headers.get('content-length'))>MATERIAL_BODY_LIMIT)fail(413,'课件文件不能超过 20 MB');
 const reader=request.body?.getReader();if(!reader)fail(400,'请求内容为空');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MATERIAL_BODY_LIMIT){await reader.cancel();fail(413,'课件文件不能超过 20 MB');}chunks.push(value);}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'请求内容无效');}
 if(!data||Array.isArray(data)||typeof data!=='object')fail(400,'需要 JSON 对象');return data;
}
function file(input){
 if(typeof input.filename!=='string'||input.filename.length>180||/[\x00-\x1f\x7f/\\]/.test(input.filename))fail(400,'文件名无效');
 const format=/\.(html?|pptx?)$/i.exec(input.filename)?.[1]?.toLowerCase();
 const kind=/\.html?$/i.test(input.filename)?'html':format;
 if(!['html','ppt','pptx'].includes(kind))fail(400,'仅支持 HTML、PPT 或 PPTX 课件');
 if(typeof input.content!=='string'||input.content.length>MATERIAL_BODY_LIMIT||input.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content))fail(400,'课件文件内容无效');
 const bytes=Buffer.from(input.content,'base64');
 if(!bytes.length||bytes.length>MATERIAL_MAX_BYTES)fail(413,'请上传非空课件，单个文件不超过 20 MB');
 if(bytes.toString('base64')!==input.content)fail(400,'课件文件内容无效');
 if(kind==='html'){
  let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(400,'HTML 课件请使用 UTF-8 编码');}
  if(html.includes('\0')||!/<(?:!doctype\s+html|html|head|body|section|main|div|h[1-6])(?:\s|>)/i.test(html))fail(400,'请上传完整的 HTML 课件');
 }else if(kind==='ppt'){
  if(!bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))fail(400,'PPT 文件内容与扩展名不一致');
 }else{
  // Office Open XML names live in the ZIP central directory; do not decompress uploads.
  if(!powerpointZip(bytes))fail(400,'PPTX 文件内容无效');
 }
 return {filename:input.filename,format:kind,content:bytes,byte_length:bytes.length};
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
function currentEvent(db,id,user,write=false){
 const event=db.prepare('SELECT * FROM events WHERE id=? AND NOT EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)').get(id);
 if(!event)fail(404,'活动已删除或不存在');
 const manage=Boolean(user&&(user.role==='admin'||event.host_id===user.id));
 if(write&&!manage)fail(user?403:401,user?'仅活动发起人或管理员可管理课件':'请先登录');
 if(!write&&!manage&&event.status!=='published')fail(404,'课件暂未公开');
 return {event,manage};
}
function audit(db,eventId,id,user,action,label){db.prepare('INSERT INTO event_material_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),eventId,id,user.id,action,label,now());}

export async function eventMaterialsRoute(request,env,url,user){
 const match=/^\/api\/events\/([a-f0-9-]{36})\/materials(?:\/([a-f0-9-]{36})(?:\/(download|preview))?)?$/.exec(url.pathname);
 if(!match)return null;
 try{
  const [,eventId,id,mode]=match,method=request.method,db=env.DB.raw;
  if(!uuid.test(eventId)||(id&&!uuid.test(id)))fail(404,'课件不存在');
  if(mode&&['GET','HEAD'].includes(method)){
   currentEvent(db,eventId,user);const row=db.prepare('SELECT * FROM event_materials WHERE id=? AND event_id=?').get(id,eventId);
   if(!row)fail(404,'课件不存在');
   const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
   if(mode==='preview'){
    if(row.format!=='html')fail(400,'PPT 课件请下载查看，在线预览请使用 HTML 版');
    Object.assign(headers,{'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});
   }else{
    const types={html:'text/html; charset=utf-8',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
    Object.assign(headers,{'Content-Type':types[row.format],'Content-Disposition':`attachment; filename="courseware.${row.format}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Content-Security-Policy':"sandbox; default-src 'none'"});
   }
   headers['Content-Length']=String(row.byte_length);return new Response(method==='HEAD'?null:row.content,{headers});
  }
  if(method==='GET'&&!id){
   const {manage}=currentEvent(db,eventId,user);
   const rows=db.prepare('SELECT id,event_id,title,filename,format,byte_length,version,created_at,updated_at FROM event_materials WHERE event_id=? ORDER BY created_at,id').all(eventId);
   return json({materials:rows.map(metadata),can_manage:manage});
  }
  if(!mode&&(method==='POST'&&!id||['PATCH','DELETE'].includes(method)&&id)){
   currentEvent(db,eventId,user,true);const input=await readInput(request);
   const label=method==='DELETE'?null:title(input.title),upload=method==='POST'||input.content!==undefined?file(input):null;
   return transaction(db,()=>{
    currentEvent(db,eventId,user,true);
    const existing=id?db.prepare('SELECT * FROM event_materials WHERE id=? AND event_id=?').get(id,eventId):null;
    if(id&&!existing)fail(404,'课件不存在');
    if(existing&&input.version!==existing.version)fail(409,'课件已被其他人修改，请刷新列表后再试');
    if(method==='DELETE'){audit(db,eventId,id,user,'delete',existing.title);db.prepare('DELETE FROM event_materials WHERE id=?').run(id);return json({ok:true});}
    const usage=db.prepare('SELECT COUNT(*) count,COALESCE(SUM(byte_length),0) bytes FROM event_materials WHERE event_id=?').get(eventId);
    if(!id&&usage.count>=20)fail(409,'每场活动最多上传 20 份课件');
    if(usage.bytes-(existing?.byte_length||0)+(upload?.byte_length||existing?.byte_length||0)>100*1024*1024)fail(413,'本场活动的课件总大小不能超过 100 MB');
    const stamp=now(),materialId=id||randomUUID(),values=upload||existing;
    if(existing)db.prepare('UPDATE event_materials SET title=?,filename=?,format=?,content=?,byte_length=?,version=version+1,updated_at=? WHERE id=?').run(label,values.filename,values.format,values.content,values.byte_length,stamp,id);
    else db.prepare('INSERT INTO event_materials VALUES(?,?,?,?,?,?,?,1,?,?,?)').run(materialId,eventId,label,values.filename,values.format,values.content,values.byte_length,user.id,stamp,stamp);
    audit(db,eventId,materialId,user,existing?'edit':'upload',label);
    const row=db.prepare('SELECT id,event_id,title,filename,format,byte_length,version,created_at,updated_at FROM event_materials WHERE id=?').get(materialId);
    return json({material:metadata(row)},existing?200:201);
   });
  }
  fail(405,'不支持的课件操作');
 }catch(error){if(error.status)return json({error:error.message},error.status);throw error;}
}
