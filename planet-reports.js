// Read-only website reports. No growth settlement, device queries or synthetic snapshots.
const campaign='herstory_hackathon_2026';
const phases=[{id:'week',title:'首周星球报告',start:'2026-10-19',end:'2026-10-25',opens_at:'2026-10-26T00:00:00+08:00'},{id:'full',title:'全程星球报告',start:'2026-10-19',end:'2026-11-01',opens_at:'2026-11-02T00:00:00+08:00'}];
const seconds=value=>Date.parse(value)/1000;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
export function buildPlanetReports(db,userId,now=Math.floor(Date.now()/1000)){
 const sql=db.raw;
 const owner=sql.prepare("SELECT id,nickname FROM members WHERE id=? AND status!='disabled'").get(userId);
 if(!owner)throw Error('Report owner unavailable');
 sql.exec('BEGIN');
 try{
  const reports=phases.map(phase=>{
   const opens=seconds(phase.opens_at),start=seconds(phase.start+'T00:00:00+08:00'),end=seconds(phase.end+'T23:59:59.999+08:00'),open=now>=opens;
   if(!open)return {...phase,open,records:null};
   const checkins=sql.prepare(`SELECT e.id,e.title,e.category,e.location,e.starts_at,e.ends_at,c.checked_at FROM checkins c JOIN events e ON e.id=c.event_id
     WHERE c.member_id=? AND c.checked_at>=? AND c.checked_at<=? AND e.starts_at>=? AND e.starts_at<=? AND e.status='published'
     AND COALESCE((SELECT valid FROM planet_fact_corrections f WHERE f.member_id=c.member_id AND f.kind='checkin' AND f.event_id=c.event_id ORDER BY f.id DESC LIMIT 1),1)=1 ORDER BY c.checked_at,e.id`).all(userId,start,end,start,end);
   // Hosting requires the existing administrator-reviewed fact; scheduled ownership alone is not proof of hosting.
   const hosted=sql.prepare(`SELECT e.id,e.title,e.category,e.starts_at,e.ends_at,r.reviewed_at FROM planet_role_reviews r JOIN events e ON e.id=r.event_id
     WHERE r.member_id=? AND r.kind='host' AND e.status='published' AND e.starts_at>=? AND e.starts_at<=? AND e.ends_at<=? AND r.reviewed_at<=?
     AND COALESCE((SELECT valid FROM planet_fact_corrections f WHERE f.member_id=r.member_id AND f.kind='role' AND f.review_id=r.id ORDER BY f.id DESC LIMIT 1),1)=1 ORDER BY e.starts_at,e.id`).all(userId,start,end,end,now);
   const friendships=sql.prepare(`SELECT m.id,m.nickname,MIN(x.established_at) established_at FROM
     (SELECT from_member_id a,to_member_id b,connected_at established_at FROM connections UNION ALL SELECT member_a_id a,member_b_id b,established_at FROM friendships) x
     JOIN members m ON m.id=CASE WHEN x.a=? THEN x.b ELSE x.a END WHERE (x.a=? OR x.b=?) AND m.id!=? AND m.status!='disabled'
     GROUP BY m.id,m.nickname HAVING MIN(x.established_at)>=? AND MIN(x.established_at)<=? ORDER BY established_at,m.id`).all(userId,userId,userId,userId,start,end);
   const categories=Object.entries(checkins.reduce((groups,row)=>{groups[row.category]=(groups[row.category]||0)+1;return groups;},{})).map(([label,count])=>({label,count}));
   return {...phase,open,cutoff_at:new Date((end+0.001)*1000).toISOString(),records:{checkins,hosted,friends:friendships},counts:{checkins:checkins.length,days:new Set(checkins.map(c=>new Date((c.checked_at+8*3600)*1000).toISOString().slice(0,10))).size,hosted:hosted.length,friends:friendships.length},categories,
    archive_status:'not_archived',note:'统计来自已核实记录，会随补录或纠正更新。该阶段星球留影尚未归档，不以当前星球画面代替历史留影。'};
  });
  sql.exec('COMMIT');return {campaign_id:campaign,owner,generated_at:new Date(now*1000).toISOString(),timezone:'Asia/Shanghai',reports};
 }catch(error){sql.exec('ROLLBACK');throw error;}
}
export function planetReportsRoute(request,env,url,user){
 if(url.pathname!=='/api/herstory/planet-reports')return null;
 if(!user)return json({error:'请先登录'},401);
 if(request.method!=='GET')return json({error:'不支持的报告操作'},405);
 return json(buildPlanetReports(env.DB,user.id));
}
