'use strict';
// Tab-local reading position only. Activity facts remain owned by the API.
const eventReturnStorage='herstory:event-list-return:v1';
let eventReturnView,clickedEventReturn=false,pendingEventReturn=false,lastEventListY=0;
if('scrollRestoration' in history)history.scrollRestoration='manual';
const eventReturnOwner=()=>state.me?.id||'guest';
const eventRoute=hash=>(hash.replace(/^#/,'')||'events').split('/')[0];
function getEventReturnView(){
  if(eventReturnView===undefined){
    try{const text=sessionStorage.getItem(eventReturnStorage);eventReturnView=text&&text.length<16000?JSON.parse(text):null;}catch{eventReturnView=null;}
  }
  const view=eventReturnView;
  if(!view||view.owner!==eventReturnOwner()||!Number.isFinite(view.y)||view.y<0||typeof view.key!=='string'||typeof view.href!=='string'||!/^#event\/[a-f0-9-]{36}$/.test(view.href))return null;
  return view;
}
function rememberEventList(link,y=scrollY){
  if(state.route!=='events'||!document.querySelector('.discovery-controls'))return;
  const target=link||document.activeElement?.closest?.('a[href^="#event/"]');
  const anchor=target?.closest('[data-interest-surface],.month-cell')||target;
  const key=history.state?.eventListKey||crypto.randomUUID();
  const view={key,owner:eventReturnOwner(),y,href:target?.getAttribute('href')||'',surface:target?.closest('[data-interest-surface]')?.dataset.interestSurface,
    section:target?.closest('[id]')?.id,day:target?.closest('.month-cell')?.querySelector('.month-date')?.dataset.date,
    top:anchor?anchor.getBoundingClientRect().top+scrollY-y:null,width:innerWidth,
    filters:{...discovery},date:calendarDate,days:calendarDays,mode:calendarMode,longOpen:calendarLongtermOpen,pastOpen:discoveryPastOpen,
    details:[...document.querySelectorAll('#main details')].map(e=>({id:e.id,classes:e.className,open:e.open})),
    horizontal:[...document.querySelectorAll('.month-scroll,.calendar-scroll')].map(e=>({classes:e.className,x:e.scrollLeft}))};
  if(!/^#event\/[a-f0-9-]{36}$/.test(view.href))return;
  eventReturnView=view;
  try{history.replaceState({...history.state,eventListKey:key},'');sessionStorage.setItem(eventReturnStorage,JSON.stringify(view));}catch{}
}
function prepareEventReturn(event){
  const from=eventRoute(new URL(event.oldURL).hash),to=eventRoute(location.hash);
  pendingEventReturn=false;
  if(from==='events'&&to==='event'){
    if(!clickedEventReturn){
      const href=location.hash;
      const active=document.activeElement?.closest?.('a');
      rememberEventList(active?.getAttribute('href')===href?active:[...document.querySelectorAll('#main a')].find(a=>a.getAttribute('href')===href),lastEventListY);
    }
    const view=getEventReturnView();
    if(view)try{history.replaceState({...history.state,eventReturnKey:view.key},'');}catch{}
  }else if(from==='event'&&to==='event'){
    try{history.replaceState({...history.state,eventReturnKey:null},'');}catch{}
  }else if(from==='event'&&to==='events'&&!interestNavigation){
    const view=getEventReturnView();
    if(view){
      const f=view.filters;
      if(f&&typeof f.query==='string'&&typeof f.category==='string'&&['all','upcoming','saved','joined'].includes(f.scope)){
        discoveryOwner=state.me?.id||null;discovery={query:f.query.slice(0,120),category:f.category.slice(0,30),scope:f.scope};
      }
      if(/^\d{4}-\d{2}-\d{2}$/.test(view.date)&&view.date>='1970-01-01'&&view.date<='2099-12-31'&&Number.isFinite(dayStart(view.date))){calendarDate=view.date;}
      if([1,3,7].includes(view.days))calendarDays=view.days;
      if(['month','time'].includes(view.mode))calendarMode=view.mode;
      calendarLongtermOpen=Boolean(view.longOpen);discoveryPastOpen=Boolean(view.pastOpen);pendingEventReturn=true;
    }
  }
  clickedEventReturn=false;
  return pendingEventReturn;
}
function eventReturnTarget(view){
  let container=view.surface?[...document.querySelectorAll('[data-interest-surface]')].find(e=>e.dataset.interestSurface===view.surface):null;
  if(!container&&view.day)container=[...document.querySelectorAll('.month-date')].find(e=>e.dataset.date===view.day)?.closest('.month-cell');
  if(!container&&view.section)container=document.getElementById(view.section);
  return [...(container||document.querySelector('#main')).querySelectorAll('a')].find(a=>a.getAttribute('href')===view.href);
}
function finishEventReturn(){
  if(!pendingEventReturn||state.route!=='events')return;
  pendingEventReturn=false;
  const view=getEventReturnView();if(!view)return;
  for(const saved of (Array.isArray(view.details)?view.details:[])){
    if(!saved||typeof saved!=='object')continue;
    const node=[...document.querySelectorAll('#main details')].find(e=>saved.id?e.id===saved.id:e.className===saved.classes);
    if(node)node.open=Boolean(saved.open);
  }
  for(const saved of (Array.isArray(view.horizontal)?view.horizontal:[])){
    if(!saved||typeof saved!=='object')continue;
    const node=[...document.querySelectorAll('.month-scroll,.calendar-scroll')].find(e=>e.className===saved.classes);
    if(node&&Number.isFinite(saved.x))node.scrollLeft=saved.x;
  }
  const target=eventReturnTarget(view),anchor=target?.closest('[data-interest-surface],.month-cell')||target;
  if(!target){
    const id=view.day||view.surface?.startsWith('month:')?'month-day-title':view.surface?.startsWith('calendar:')?'calendar-title':'discovery-title';
    const fallback=document.getElementById(id);fallback?.focus({preventScroll:true});fallback?.scrollIntoView({block:'start',behavior:'instant'});return;
  }
  const restore=()=>{
    const top=anchor&&Number.isFinite(view.top)?scrollY+anchor.getBoundingClientRect().top-view.top:view.y;
    window.scrollTo({top:Math.max(0,top),behavior:'instant'});
  };
  target?.focus({preventScroll:true});restore();
  const epoch=renderEpoch,y=scrollY;
  // Correct one paint of layout without pulling a reader back after they start scrolling.
  requestAnimationFrame(()=>{if(state.route==='events'&&renderEpoch===epoch&&Math.abs(scrollY-y)<2)restore();});
}
function returnToEventList(){
  const view=getEventReturnView();
  if(view&&history.state?.eventReturnKey===view.key)history.back();else location.hash='#events';
}
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href^="#event/"]');
  if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target==='_blank'||eventRoute(location.hash)!=='events')return;
  rememberEventList(link);clickedEventReturn=true;
},true);
window.addEventListener('scroll',()=>{if(eventRoute(location.hash)==='events'&&state.route==='events')lastEventListY=scrollY;},{passive:true});
