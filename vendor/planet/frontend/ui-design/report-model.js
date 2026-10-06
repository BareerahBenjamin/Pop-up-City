/* Report facts are phase-scoped; this module never reads the live planet. */
(function(root){
'use strict';
const CAMPAIGN='herstory_hackathon_2026',TZ='Asia/Shanghai';
const phases=[{id:'week',label:'首周回顾',title:'我的星球足迹',start:'2026-10-19',end:'2026-10-25',marketId:'a26',condition:'第一场市集结束后开放',copy:'每一次打卡，都让星球长出新的风景。',finalizesAt:'2026-10-26T00:00:00+08:00'},{id:'full',label:'全程回顾',title:'我的星球故事',start:'2026-10-19',end:'2026-11-01',marketId:'a58',condition:'第二场市集结束后开放',copy:'这是你用两周经历，长成的星球。'}];
const categories={learning:{label:'学习',region:'城市板块',color:'#748795'},creation:{label:'创造',region:'火山工坊',color:'#b8896d'},entertainment:{label:'娱乐',region:'森林农场',color:'#80988d'}};
function time(value){return typeof value==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;}
function day(value){const n=time(value);return Number.isFinite(n)?new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(n):null;}
function format(value){return Number.isFinite(time(value))?new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(time(value)):'';}
function schedule(phase,config={},catalog=[],now=Date.now()){
 const p=typeof phase==='string'?phases.find(d=>d.id===phase):phase,c=config[p.id]||{},market=catalog.find(s=>s.activity_id===p.marketId);
 const opens=c.opens_at||market?.ended_at,final=p.finalizesAt||c.finalizes_at;
 const validOpen=Number.isFinite(time(opens))&&day(opens)>=p.start&&day(opens)<=p.end;
 return {opensAt:validOpen?opens:null,finalizesAt:Number.isFinite(time(final))&&time(final)>=time(p.end+'T00:00:00+08:00')&&time(final)<=time(p.end+'T23:59:59.999+08:00')+1&&(!validOpen||time(final)>=time(opens))?final:null,open:validOpen&&now>=time(opens),condition:p.condition};
}
function latest(items,key,cutoff,issues){const map=new Map();for(const x of items){if(!x||typeof x!=='object')continue;const id=key(x);if(!id){issues.add('部分记录缺少稳定标识，未计入');continue;}const t=time(x.updated_at||x.verified_at||x.established_at);if(!Number.isFinite(t)||t>cutoff){if(!Number.isFinite(t))issues.add('部分记录缺少有效时间，未计入');continue;}const prev=map.get(id);if(!prev||Number(x.revision||0)>Number(prev.revision||0)||Number(x.revision||0)===Number(prev.revision||0)&&t>time(prev.updated_at||prev.verified_at||prev.established_at))map.set(id,x);}return [...map.values()];}
function build(phaseId,packet,context={}){
 const phase=phases.find(d=>d.id===phaseId);if(!phase)throw Error('Unknown phase');const {userId,catalog=[],reportConfig={},now=Date.now()}=context,status=schedule(phase,reportConfig,catalog,now),issues=new Set();
 const base={phase,status,ready:false,issues:[],rows:[],counts:null,contributions:[],friends:[],companions:[],snapshot:null,cutoff:null,finalized:false};
 if(!packet)return {...base,issues:['活动记录尚未同步']};
 if(packet.user_id!==userId||packet.campaign_id!==CAMPAIGN)throw Error('报告归属不匹配');
 const cutoff=time(packet.cutoff_at),end=time(phase.end+'T23:59:59.999+08:00');
 if(!Number.isFinite(cutoff)||cutoff>now||cutoff<time(phase.start+'T00:00:00+08:00')||cutoff>end+1)throw Error('报告截止时间无效');
 const map=new Map();for(const a of [...catalog,...(packet.sessions||[])]){if(!a?.activity_id)continue;const merged={...map.get(a.activity_id),...a};map.set(a.activity_id,merged);}
 const bySession=new Map();for(const a of map.values())if(a.canonical_session_id)bySession.set(a.canonical_session_id,a);
 function resolve(fact){const activity=map.get(fact.activity_id)||bySession.get(fact.canonical_session_id);if(!activity)return null;return activity;}
 function canonical(f){return f.canonical_session_id||resolve(f)?.canonical_session_id;}
 const checkins=Array.isArray(packet.checkins)?latest(packet.checkins,f=>f.user_id&&canonical(f)?f.user_id+'|'+canonical(f):null,cutoff,issues):null;
 if(!checkins)issues.add('活动打卡记录尚未同步');
 function row(f){const a=resolve(f);if(!a){issues.add('部分活动尚未匹配目录，未计入');return null;}const date=a.event_date||day(a.starts_at),checked=day(f.checked_in_at||f.occurred_at);if(!date||!checked){issues.add('部分打卡日期缺失，未计入');return null;}if(date<phase.start||date>phase.end||checked<phase.start||checked>phase.end||a.enabled===false||a.status==='cancelled'||a.kind==='milestone'||!categories[a.category])return null;if(time(f.checked_in_at||f.occurred_at)>cutoff)return null;return {...a,sessionId:canonical(f),date,checkedDay:checked,checkedAt:f.checked_in_at||f.occurred_at,checkin:f};}
 const valid=(checkins||[]).filter(f=>f.status==='valid'&&(!f.campaign_id||f.campaign_id===CAMPAIGN)).map(f=>({fact:f,row:row(f)})).filter(x=>x.row);
 const rows=valid.filter(x=>x.fact.user_id===userId).map(x=>x.row).sort((a,b)=>a.date.localeCompare(b.date)||String(a.title||'').localeCompare(String(b.title||'')));
 const sessionSet=new Set(rows.map(r=>r.sessionId)),count={learning:0,creation:0,entertainment:0};rows.forEach(r=>count[r.category]++);
 const people=new Map((packet.people||[]).map(p=>[p.user_id,p]));function person(id){return {id,name:people.get(id)?.name||'姓名待同步',avatar:people.get(id)?.avatar_url||null};}
 const participants=Array.isArray(packet.participant_checkins)?latest(packet.participant_checkins,f=>f.user_id&&canonical(f)?f.user_id+'|'+canonical(f):null,cutoff,issues).filter(f=>f.status==='valid'&&(!f.campaign_id||f.campaign_id===CAMPAIGN)).map(f=>({fact:f,row:row(f)})).filter(x=>x.row):null;
 const hosts=Array.isArray(packet.host_facts)?latest(packet.host_facts,f=>f.user_id&&canonical(f)?f.user_id+'|'+canonical(f):null,cutoff,issues):null;
 if(!hosts)issues.add('发起活动记录尚未同步');
 const contributions=(hosts||[]).filter(f=>f.user_id===userId&&f.status==='valid'&&(!f.campaign_id||f.campaign_id===CAMPAIGN)).map(f=>{const a=resolve(f);if(a&&a.status!=='held')issues.add('部分发起活动尚无实际举办确认，未计入');if(a&&!Number.isFinite(time(a.ended_at)))issues.add('部分发起活动缺少结束时间，未计入');if(!a||!a.event_date||a.enabled===false||!categories[a.category]||a.kind==='milestone'||a.event_date<phase.start||a.event_date>phase.end||a.status!=='held'||!Number.isFinite(time(a.ended_at))||time(a.ended_at)>cutoff)return null;const sid=canonical(f),ids=new Set((participants||[]).filter(x=>x.row.sessionId===sid&&x.fact.user_id!==userId).map(x=>x.fact.user_id));return {...a,sessionId:sid,partners:participants?[...ids].map(person):null};}).filter(Boolean);
 const relations=Array.isArray(packet.friendships)?latest(packet.friendships,f=>f.user_id===userId&&f.friend_id?f.friend_id:null,cutoff,issues):null;
 const relationsComplete=!!relations&&!relations.some(f=>f.status==='established'&&!Number.isFinite(time(f.established_at)));if(!relationsComplete)issues.add('好友建立时间尚未同步');
 const established=(relations||[]).filter(f=>f.status==='established'&&Number.isFinite(time(f.established_at))&&time(f.established_at)<=cutoff);
 const allFriendIds=new Set(established.map(f=>f.friend_id));const shared=id=>[...new Set((participants||[]).filter(x=>x.fact.user_id===id&&sessionSet.has(x.row.sessionId)).map(x=>x.row.sessionId))].map(s=>rows.find(r=>r.sessionId===s));
 const friends=established.filter(f=>day(f.established_at)>=phase.start&&day(f.established_at)<=phase.end).map(f=>({...person(f.friend_id),establishedAt:f.established_at,shared:participants?shared(f.friend_id):null}));
 const partnerIds=new Set((participants||[]).filter(x=>sessionSet.has(x.row.sessionId)&&x.fact.user_id!==userId&&!allFriendIds.has(x.fact.user_id)).map(x=>x.fact.user_id));
 const companions=relations?[...partnerIds].map(id=>({...person(id),shared:shared(id)})):[];
 if(!participants)issues.add('实际参与伙伴与共同活动记录尚未同步');
 let snapshot=null;if(packet.snapshot&&time(packet.snapshot.cutoff_at)===cutoff&&packet.snapshot.image_url&&packet.snapshot.view_key)snapshot={...packet.snapshot};else issues.add('该阶段星球留影待补齐');
 let finalized=packet.finalized===true&&Number.isFinite(time(status.finalizesAt))&&cutoff===time(status.finalizesAt)&&now>=cutoff;
 if(packet.finalized&&!finalized)issues.add('定稿时间与阶段配置不一致，暂按更新中展示');
 if(finalized&&(!snapshot||!checkins||!hosts||!relationsComplete||!participants||issues.size)){finalized=false;issues.add('定稿资料尚未齐全，待同步后归档');}
 return {...base,ready:true,cutoff:packet.cutoff_at,issues:[...issues],rows,counts:checkins?{...count,participated:rows.length,days:new Set(rows.map(r=>r.checkedDay)).size}:null,contributions,friends:relationsComplete?friends:null,companions:relationsComplete&&participants?companions:null,hostCount:hosts?contributions.length:null,partnerCount:participants?new Set(contributions.flatMap(a=>(a.partners||[]).map(p=>p.id))).size:null,snapshot,finalized,freezeEligible:finalized&&!!snapshot&&!!checkins&&!!hosts&&relationsComplete&&!!participants&&issues.size===0,packet};
}
const api={CAMPAIGN,TZ,phases,categories,time,day,format,schedule,build};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HerstoryReportModel=api;
})(typeof window==='undefined'?globalThis:window);
