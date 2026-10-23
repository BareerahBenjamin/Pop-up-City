import {randomUUID} from 'node:crypto';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

// Website administration only. Existing hardware reads events.host_id unchanged.
export async function eventHostsRoute(request,env,url,user,readBody){
 const list=url.pathname==='/api/admin/event-hosts',match=/^\/api\/admin\/events\/([a-f0-9-]{36})\/host$/.exec(url.pathname);
 if(!list&&!match)return null;
 try{
  if(!user)fail(401,'请先登录');if(user.role!=='admin')fail(403,'仅管理员可以修改活动发起人');
  const db=env.DB.raw;
  if(list&&request.method==='GET')return json({members:db.prepare("SELECT id,nickname,email FROM members WHERE status='active' ORDER BY nickname,id").all()});
  if(!match||request.method!=='PATCH')fail(405,'不支持的发起人操作');
  const input=await readBody(request);
  if(!uuid.test(input.host_id||'')||!uuid.test(input.previous_host_id||''))fail(400,'请选择已注册的活动发起人');
  db.exec('BEGIN IMMEDIATE');
  try{
   const event=db.prepare('SELECT * FROM events WHERE id=? AND NOT EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)').get(match[1]);
   if(!event)fail(404,'活动已删除或不存在');
   if(event.host_id!==input.previous_host_id)fail(409,'活动发起人已变化，请刷新后再修改');
   const member=db.prepare("SELECT id,nickname FROM members WHERE id=? AND status='active'").get(input.host_id);
   if(!member)fail(400,'只能选择当前已注册且未停用的用户');
   if(event.host_id!==member.id){
    if(['pending','published'].includes(event.status)&&db.prepare("SELECT 1 FROM events e WHERE host_id=? AND id!=? AND status IN ('pending','published') AND starts_at<? AND ends_at>? AND NOT EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) LIMIT 1").get(member.id,event.id,event.ends_at,event.starts_at))fail(409,'该用户发起的活动时间有重叠，请选择其他用户或调整时间');
    const stamp=Math.floor(Date.now()/1000);
    db.prepare('UPDATE events SET host_id=?,updated_at=? WHERE id=?').run(member.id,stamp,event.id);
    db.prepare('INSERT INTO event_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),event.id,user.id,'change-host',JSON.stringify({previous_host_id:event.host_id,host_id:member.id}),stamp);
   }
   db.exec('COMMIT');return json({host_id:member.id,host_nickname:member.nickname});
  }catch(error){db.exec('ROLLBACK');throw error;}
 }catch(error){if(error.status)return json({error:error.message},error.status);throw error;}
}
