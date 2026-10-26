'use strict';
// Website facts -> the original report presenter. No changes to the planet runtime,
// growth rules or historical archives; missing facts remain explicitly unknown.
const planetReportFrames=new WeakMap();
function expandPlanetReport(adapter){
 if(adapter.restore)return;
 const {frame}=adapter,hidden=[],overflow=document.body.style.overflow;
 for(let node=frame;node.parentElement&&node!==document.body;node=node.parentElement){
  for(const sibling of node.parentElement.children)if(sibling!==node){hidden.push([sibling,sibling.inert]);sibling.inert=true;}
 }
 frame.classList.add('planet-report-expanded');document.body.style.overflow='hidden';
 const observer=new MutationObserver(()=>{if(!frame.isConnected)adapter.restore?.();});observer.observe(document.body,{childList:true,subtree:true});
 adapter.restore=()=>{observer.disconnect();frame.classList.remove('planet-report-expanded');document.body.style.overflow=overflow;for(const [node,inert]of hidden)node.inert=inert;adapter.restore=null;};
}
function websitePlanetReport(model,base,report){
 if(!report)return base;
 const status={...base.status,open:report.open===true,opensAt:report.opens_at};
 if(!report.open)return {...base,status};
 const iso=seconds=>new Date(seconds*1000).toISOString(),unmapped=new Set();
 function category(label){
  const known={学习:'learning',创造:'creation',娱乐:'entertainment',learning:'learning',creation:'creation',entertainment:'entertainment'};
  if(Object.hasOwn(known,label))return known[label];
  const key='website-category:'+label;
  // Preserve original labels without inventing a growth-category mapping.
  if(!Object.hasOwn(model.categories,key))Object.defineProperty(model.categories,key,{value:{label,color:'#65705e'},configurable:true});
  unmapped.add(label);return key;
 }
 function activity(row){const start=iso(row.starts_at);return {activity_id:row.id,sessionId:row.id,title:row.title,category:category(row.category),date:model.day(start),event_date:model.day(start),starts_at:start,ended_at:iso(row.ends_at)};}
 const rows=report.records.checkins.map(row=>({...activity(row),checkedAt:iso(row.checked_at)})).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.activity_id.localeCompare(b.activity_id));
 const contributions=report.records.hosted.map(row=>({...activity(row),partners:null}));
 const counts={learning:0,creation:0,entertainment:0,participated:report.counts.checkins,days:report.counts.days};
 for(const row of rows)if(Object.hasOwn(counts,row.category))counts[row.category]++;
 const issues=[report.note,'实际参与伙伴与共同活动记录尚未同步'];
 if(unmapped.size)issues.push('部分活动沿用原分类（'+[...unmapped].join('、')+'），计入参与／发起总数，未换算为学习、创造或娱乐。');
 return {...base,status,ready:true,cutoff:report.cutoff_at,rows,counts,contributions,hostCount:report.counts.hosted,partnerCount:null,
  friends:report.records.friends.map(person=>({id:person.id,name:person.nickname,avatar:null,establishedAt:iso(person.established_at),shared:null})),
  companions:null,snapshot:null,finalized:false,freezeEligible:false,issues};
}
function mountPlanetReportEntry(){
 const frame=document.getElementById('planet-frame');if(!frame)return null;
 const view=frame.contentWindow,doc=frame.contentDocument,model=view?.HerstoryReportModel,reports=view?.HerstoryReports;
 if(!model||!reports||!state.me)return null;
 if(planetReportFrames.has(doc))return planetReportFrames.get(doc);
 const owner=state.me.id;if(view.HerstoryIdentity.getProfile().userId!==owner)return null;
 const originalBuild=model.build,adapter={frame,view,doc,owner,reports,data:null,request:0,trigger:null};
 // Use the original presenter's view-model contract. The server controls phase
 // availability, including midnight openings outside the reference phase dates.
 model.build=(id,packet,context)=>websitePlanetReport(model,originalBuild(id,null,{...context,catalog:[],reportConfig:{}}),adapter.data?.reports.find(report=>report.id===id));
 const button=doc.querySelector('.bottom-nav [data-tab="reports"]');
 button.disabled=false;button.title='查看我的阶段报告';button.querySelector('span').textContent='星球报告';
 button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();showPlanetReports(button);},true);
 // The in-planet hint fetches fresh authenticated facts through the same entry.
 doc.getElementById('report-hint').addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();showPlanetReports(button);},true);
 doc.getElementById('reports-view').addEventListener('close',()=>{++adapter.request;adapter.restore?.();adapter.trigger?.isConnected&&adapter.trigger.focus({preventScroll:true});adapter.trigger=null;});
 planetReportFrames.set(doc,adapter);return adapter;
}
async function showPlanetReports(trigger){
 if(!requireLogin())return;
 const adapter=mountPlanetReportEntry();if(!adapter){toast('星球正在加载，请稍后再打开报告');return;}
 const {frame,view,doc,owner,reports}=adapter,request=++adapter.request;
 adapter.trigger=trigger;expandPlanetReport(adapter);reports.openSheet();
 if(!doc.getElementById('reports-view').open){adapter.restore?.();return;}
 const target=doc.getElementById('report-list');
 target.replaceChildren();target.setAttribute('aria-busy','true');
 const loading=doc.createElement('p');loading.className='report-note';loading.setAttribute('role','status');loading.textContent='正在读取你的阶段记录…';target.append(loading);
 doc.getElementById('close-reports').focus({preventScroll:true});
 try{
  const data=await api('/api/herstory/planet-reports');
  if(request!==adapter.request||state.me?.id!==owner||!frame.isConnected||frame.contentWindow!==view)return;
  if(data.owner?.id!==owner||data.campaign_id!==view.HerstoryReportModel.CAMPAIGN)throw Error('报告数据归属不匹配');
  adapter.data=data;target.removeAttribute('aria-busy');
  reports.applyData({user_id:owner,campaign_id:data.campaign_id,revision:Date.parse(data.generated_at),phases:{}});
 }catch(error){
  if(request!==adapter.request||!frame.isConnected||state.me?.id!==owner)return;
  target.removeAttribute('aria-busy');target.replaceChildren();const message=doc.createElement('p');message.className='report-note';message.setAttribute('role','alert');message.textContent=error.message;
  const retry=doc.createElement('button');retry.type='button';retry.className='report-gold';retry.textContent='重新加载报告';retry.onclick=()=>showPlanetReports(trigger);target.append(message,retry);
 }
}
window.addEventListener('message',event=>{const frame=document.getElementById('planet-frame');if(event.origin===location.origin&&frame&&event.source===frame.contentWindow&&event.data?.type==='herstory:planet-ready')mountPlanetReportEntry();});
document.addEventListener('click',event=>{const button=event.target.closest('[data-action="planet-reports"]');if(!button)return;event.preventDefault();showPlanetReports(button);});
