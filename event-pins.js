const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export function withEventPins(db,events,now=Math.floor(Date.now()/1000)){
 const pins=new Map(db.raw.prepare('SELECT event_id,pinned_at FROM website_event_pins').all().map(p=>[p.event_id,p.pinned_at]));
 return events.map(e=>({...e,pinned:e.status==='published'&&e.ends_at>now&&pins.has(e.id),pinned_at:pins.get(e.id)||null}));
}
export async function eventPinsRoute(request,env,url,user,readBody){
 const match=/^\/api\/admin\/events\/([a-f0-9-]{36})\/pin$/.exec(url.pathname);if(!match)return null;
 if(!user)return json({error:'请先登录'},401);if(user.role!=='admin')return json({error:'仅管理员可以置顶活动'},403);
 if(request.method!=='PUT')return json({error:'不支持的置顶操作'},405);
 const input=await readBody(request);if(typeof input.pinned!=='boolean')return json({error:'请指定是否置顶'},400);
 const db=env.DB.raw;db.exec('BEGIN IMMEDIATE');
 try{
  const event=db.prepare('SELECT * FROM events WHERE id=? AND NOT EXISTS(SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)').get(match[1]),stamp=Math.floor(Date.now()/1000);
  if(!event){db.exec('ROLLBACK');return json({error:'活动已删除或不存在'},404);}
  if(input.pinned&&(event.status!=='published'||event.ends_at<=stamp)){db.exec('ROLLBACK');return json({error:'仅可置顶已发布且未结束的活动'},409);}
  const previous=db.prepare('SELECT 1 FROM website_event_pins WHERE event_id=?').get(event.id);
  if(input.pinned&&!previous)db.prepare('INSERT INTO website_event_pins VALUES(?,?,?)').run(event.id,user.id,stamp);
  else if(!input.pinned&&previous)db.prepare('DELETE FROM website_event_pins WHERE event_id=?').run(event.id);
  if(Boolean(previous)!==input.pinned)db.prepare('INSERT INTO event_audit VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),event.id,user.id,input.pinned?'pin':'unpin','网站活动置顶',stamp);
  db.exec('COMMIT');return json({pinned:input.pinned});
 }catch(error){db.exec('ROLLBACK');throw error;}
}
