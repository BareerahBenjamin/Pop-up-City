'use strict';
const roleLabel=member=>member?.is_super_admin?'超级管理员':member?.role==='admin'?'管理员':'成员';
// All event days use the venue's UTC+8 timezone, independent of the visitor's device.
const eventDay=seconds=>new Date(seconds*1000+8*3600000).toISOString().slice(0,10);
const dayStart=day=>Date.parse(`${day}T00:00:00+08:00`)/1000;
const shiftDay=(day,count)=>eventDay(dayStart(day)+count*86400);
const eventClock=seconds=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(seconds*1000));
const dayHeading=day=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short'}).format(new Date(dayStart(day)*1000));
let calendarDays=3,calendarDate=eventDay(Date.now()/1000),posterVersion=0,posterEvent=null,posterBlob=null;
function eventTimeLabel(event,seconds=Date.now()/1000){return event.status!=='published'?statusText(event.status):event.ends_at<=seconds?'已结束':event.starts_at<=seconds?'已开始 · 报名截止':'未开始'}
const interestOperations=new Map();
let interestOwner=null,interestReads=Promise.resolve(),interestNavigation=null,highlightedInterestId=null;
function reconcileInterestOwner(){
  const owner=state.me?.id||null;
  if(owner!==interestOwner){interestOwner=owner;interestOperations.clear();interestNavigation=null;highlightedInterestId=null;}
  if(highlightedInterestId&&!hasInterestAgenda(state.events.find(e=>e.id===highlightedInterestId)))highlightedInterestId=null;
}
function hasInterestAgenda(event){return Boolean(event&&(interestedToday([event]).length||upcomingInterests([event]).length));}
function interestFeedback(event,agenda=false){
  const operation=interestOperations.get(event.id);
  if(operation?.phase==='pending')return `<p class="interest-progress" role="status">${operation.sync?'正在同步收藏状态…':operation.remove?'正在取消收藏…':'正在收藏…'}</p>`;
  if(operation?.phase==='error')return `<p class="interest-error" role="status">${esc(operation.message)}</p><button class="text-button" data-action="${operation.needsSync?'sync-interest':'toggle-interest'}" data-id="${esc(event.id)}">${operation.needsSync?'重新同步':'重试'}</button>`;
  if(agenda||!event.my_interested)return '';
  const ended=eventTimeLabel(event)!=='未开始';
  return `<p class="interest-confirmation">已收藏 · <time datetime="${new Date(event.starts_at*1000).toISOString()}">${dayHeading(eventDay(event.starts_at))} ${eventClock(event.starts_at)}</time></p><p class="interest-note">${event.my_attending?'已报名':'感兴趣不等于报名'}${ended?` · ${esc(eventTimeLabel(event))}`:''}</p>${hasInterestAgenda(event)?`<button class="text-button" data-action="view-interest-agenda" data-id="${esc(event.id)}">查看我的安排 →</button>`:''}`;
}
function interestFeedbackSlot(event,agenda=false){return `<div class="interest-feedback" data-interest-feedback="${esc(event.id)}">${interestFeedback(event,agenda)}</div>`;}
// Capture the current reading position at render time, not when a slow request began.
function captureInterestView(){
  if(!['events','event'].includes(state.route)||(location.hash.slice(1)||'events').split('/')[0]!==state.route)return null;
  const surfaces=[...document.querySelectorAll('[data-interest-surface]')];
  const anchor=surfaces.find(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
  const active=document.activeElement,surface=active?.closest('[data-interest-surface]');
  return {y:scrollY,key:anchor?.dataset.interestSurface,top:anchor?.getBoundingClientRect().top,
    focus:surface?{key:surface.dataset.interestSurface,action:active.dataset.action,id:active.dataset.id,href:active.getAttribute('href'),future:Boolean(surface.closest('.upcoming-agenda'))}:null};
}
function restoreInterestView(view){
  if(!view)return;
  const surface=key=>[...document.querySelectorAll('[data-interest-surface]')].find(e=>e.dataset.interestSurface===key);
  const anchor=surface(view.key);
  window.scrollTo({top:anchor?scrollY+anchor.getBoundingClientRect().top-view.top:view.y,behavior:'instant'});
  if(!view.focus||$('#modal').open)return;
  const f=view.focus,container=surface(f.key);
  const target=container&&[...container.querySelectorAll('button,a')].find(e=>f.action?e.dataset.action===f.action&&e.dataset.id===f.id:e.getAttribute('href')===f.href);
  if(target&&!target.disabled){target.focus({preventScroll:true});return;}
  if(f.key.startsWith('agenda:'))document.getElementById(f.future&&document.getElementById('upcoming-title')?'upcoming-title':'today-title')?.focus({preventScroll:true});
}
function focusInterestAgenda(id){
  const event=state.events.find(e=>e.id===id);
  const row=document.getElementById(`interest-agenda-${id}`);
  if(!hasInterestAgenda(event)||!row){toast('这场活动已不在今日或未来安排中。');return;}
  highlightedInterestId=id;
  document.querySelectorAll('.agenda-highlight').forEach(e=>e.classList.remove('agenda-highlight'));
  row.classList.add('agenda-highlight');
  row.querySelector('a').focus({preventScroll:true});
  row.scrollIntoView({block:'center',behavior:'instant'});
}
function finishInterestNavigation(){
  if(!interestNavigation||state.route!=='events')return;
  const intent=interestNavigation;interestNavigation=null;
  if(state.me?.id===intent.owner)focusInterestAgenda(intent.id);
}
function interestRouteChanged(event){
  highlightedInterestId=null;
  if(interestNavigation&&(location.hash!=='#events'||new URL(event.oldURL).hash!==interestNavigation.from))interestNavigation=null;
}
function syncInterestEvents(owner){
  // Serialize reads after writes so concurrent events cannot overwrite a newer snapshot.
  const request=interestReads.catch(()=>{}).then(async()=>{
    const data=await api('/api/events');
    if(state.me?.id===owner)state.events=data.events;
  });
  interestReads=request;return request;
}
async function updateInterest(button,sync=false){
  if(!requireLogin())return;
  reconcileInterestOwner();
  const id=button.dataset.id,event=state.events.find(e=>e.id===id),existing=interestOperations.get(id);
  if(!event||existing?.phase==='pending')return;
  if(existing?.needsSync&&!sync)return;
  const operation={phase:'pending',owner:state.me.id,remove:Boolean(event.my_interested),sync};
  const originHash=location.hash;interestOperations.set(id,operation);
  await render();
  let submitted=false;
  try{
    if(!sync){await api(`/api/events/${id}/interest`,{method:operation.remove?'DELETE':'POST'});submitted=true;}
    await syncInterestEvents(operation.owner);
    if(state.me?.id!==operation.owner||interestOperations.get(id)!==operation)return;
    interestOperations.delete(id);
    if(!sync&&operation.remove&&location.hash===originHash)toast('已取消感兴趣');
  }catch(error){
    if(state.me?.id!==operation.owner||interestOperations.get(id)!==operation)return;
    const needsSync=sync||submitted||!error.status||error.status>=500;
    interestOperations.set(id,{phase:'error',needsSync,message:submitted?'操作已提交，状态待同步。':needsSync?'未能确认收藏状态，请重新同步。':error.message});
  }
  if(state.me?.id===operation.owner&&['events','event'].includes(state.route))await render();
}
function interestButton(event,iconOnly=false){
  const selected=Boolean(event.my_interested),closed=event.status!=='published'||event.starts_at<=Date.now()/1000;
  const operation=interestOperations.get(event.id),busy=operation?.phase==='pending',blocked=busy||operation?.needsSync;
  const label=busy?(operation.sync?'正在同步…':operation.remove?'正在取消…':'正在收藏…'):selected?'取消感兴趣':closed?'已截止':'感兴趣';
  return `<button type="button" class="btn light interest-button ${iconOnly?'interest-heart':''}" data-action="toggle-interest" data-id="${esc(event.id)}" aria-label="${esc(label+'：'+event.title)}" title="${label}" data-interest-icon="${iconOnly}" aria-busy="${busy}" aria-disabled="${Boolean(blocked||closed&&!selected)}" aria-pressed="${selected}" ${closed&&!selected?'disabled':''}>${iconOnly?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>`:busy?label:selected?'♥ 已感兴趣':closed?'已截止':'♡ 感兴趣'}</button>`;
}
function interestedToday(events,seconds=Date.now()/1000){const day=eventDay(seconds),start=dayStart(day);return events.filter(e=>e.my_interested&&e.status==='published'&&e.starts_at<start+86400&&e.ends_at>start).sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id))}
function upcomingInterests(events,seconds=Date.now()/1000){const tomorrow=dayStart(eventDay(seconds))+86400;return events.filter(e=>e.my_interested&&e.status==='published'&&e.starts_at>=tomorrow).sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id))}
function interestAgenda(events,future=false){return `<ol class="agenda-list ${future?'upcoming-agenda':'today-agenda'}">${events.map(e=>`<li id="interest-agenda-${esc(e.id)}" data-interest-surface="agenda:${esc(e.id)}" class="${highlightedInterestId===e.id?'agenda-highlight':''}"><time datetime="${new Date(e.starts_at*1000).toISOString()}">${future?`${dayHeading(eventDay(e.starts_at))}<br>`:eventDay(e.starts_at)!==eventDay(Date.now()/1000)?'跨日 ':''}${eventClock(e.starts_at)}</time><div><a href="#event/${esc(e.id)}">${esc(e.title)}</a><p>${esc(e.location)} · ${eventTimeLabel(e)}${e.my_attending?' · 已报名':''}</p></div>${interestButton(e,true)}${interestFeedbackSlot(e,true)}</li>`).join('')}</ol>`}
function todaySchedule(){
  const events=interestedToday(state.events),upcoming=upcomingInterests(state.events);
  return `<section class="today-schedule" aria-labelledby="today-title"><div class="section-head"><div><span class="eyebrow">MY DAY / ${dayHeading(eventDay(Date.now()/1000))}</span><h2 id="today-title" tabindex="-1">今日感兴趣</h2><p>感兴趣不等于报名。请提前到场，活动开始后不可补报或迟到签到。</p></div></div>${!state.me?`<div class="empty">登录后，收藏你的活动安排。<button class="btn light" data-action="login">成员登录</button></div>`:`${events.length?interestAgenda(events):'<p class="schedule-empty">今天暂无感兴趣活动。点活动卡片上的爱心，收藏你的安排。</p>'}${upcoming.length?`<h3 class="upcoming-title" id="upcoming-title" tabindex="-1">未来感兴趣 <span class="muted">${upcoming.length} 场</span></h3>${interestAgenda(upcoming,true)}`:''}`}</section>`;
}
function calendarSection(events){
  const start=dayStart(calendarDate),published=events.filter(e=>e.status==='published'||e.status==='cancelled').sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id));
  const days=Array.from({length:calendarDays},(_,i)=>{const from=start+i*86400,day=eventDay(from),items=published.filter(e=>e.starts_at<from+86400&&e.ends_at>from);return `<section class="calendar-day ${day===eventDay(Date.now()/1000)?'is-today':''}" aria-label="${dayHeading(day)}"><h3>${dayHeading(day)}</h3>${items.length?items.map(e=>`<article class="calendar-event" data-interest-surface="calendar:${day}:${esc(e.id)}"><p class="calendar-time">${e.starts_at<from?'跨日 · ':''}${eventClock(e.starts_at)} — ${e.ends_at>from+86400?'次日 ':''}${eventClock(e.ends_at)}</p><a href="#event/${esc(e.id)}">${esc(e.title)}</a><p>${esc(e.location)}</p><span class="muted">${eventTimeLabel(e)}</span>${interestButton(e)}${interestFeedbackSlot(e)}</article>`).join(''):'<p class="muted">当天暂无活动</p>'}</section>`}).join('');
  return `<section class="event-calendar" aria-labelledby="calendar-title"><div class="section-head"><div><span class="eyebrow">MAKE TIME TO MEET</span><h2 id="calendar-title">活动日历</h2><p>景德镇时间（UTC+8）· 按开始时间排列</p></div><div class="calendar-modes" aria-label="日历显示范围">${[1,3,7].map(n=>`<button type="button" class="filter ${calendarDays===n?'selected':''}" data-action="calendar-view" data-days="${n}" aria-pressed="${calendarDays===n}">${{1:'一天',3:'三天',7:'一周'}[n]}</button>`).join('')}</div></div><div class="calendar-toolbar"><button class="btn light" data-action="calendar-prev" aria-label="上一段日期">← 前${calendarDays}天</button><label>查看日期 <input id="calendar-date" type="date" min="1970-01-01" max="2099-12-31" value="${calendarDate}"></label><button class="btn light" data-action="calendar-today">今天</button><button class="btn light" data-action="calendar-next" aria-label="下一段日期">后${calendarDays}天 →</button></div><div class="calendar-grid" data-days="${calendarDays}" style="--calendar-columns:${calendarDays}">${days}</div></section>`;
}
document.addEventListener('change',event=>{
  if(event.target.id==='calendar-date'&&event.target.checkValidity()&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){calendarDate=event.target.value;render()}
  if(event.target.id==='poster-qr')renderEventPoster();
});
async function handleEventTools(button){
  const action=button.dataset.action,id=button.dataset.id;
  if(action.startsWith('calendar-')){
    if(action==='calendar-view'&&[1,3,7].includes(Number(button.dataset.days)))calendarDays=Number(button.dataset.days);
    else if(action==='calendar-prev')calendarDate=shiftDay(calendarDate,-calendarDays);
    else if(action==='calendar-next')calendarDate=shiftDay(calendarDate,calendarDays);
    else if(action==='calendar-today')calendarDate=eventDay(Date.now()/1000);
    if(calendarDate<'1970-01-01')calendarDate='1970-01-01';if(calendarDate>'2099-12-25')calendarDate='2099-12-25';
    await render();document.querySelector(`[data-action="${action}"]${action==='calendar-view'?`[data-days="${calendarDays}"]`:''}`)?.focus({preventScroll:true});return true;
  }
  if(action==='view-interest-agenda'){
    if(!requireLogin())return true;
    if(state.route==='events')focusInterestAgenda(id);
    else {interestNavigation={id,owner:state.me.id,from:location.hash};location.hash='#events';}
    return true;
  }
  if(action==='toggle-interest'||action==='sync-interest'){await updateInterest(button,action==='sync-interest');return true;}
  if(action==='event-poster'){const event=state.events.find(e=>e.id===id);if(event)showEventPoster(event);return true}
  if(action==='retry-poster'){await renderEventPoster();return true}
  if(action==='download-poster'||action==='share-poster'){
    if(!posterBlob)return true;
    const file=new File([posterBlob],'herstory-event.png',{type:'image/png'});
    if(action==='share-poster'&&navigator.canShare?.({files:[file]})){
      try{await navigator.share({files:[file],title:posterEvent.title})}catch(error){if(error.name!=='AbortError')toast('系统分享未完成，可以下载海报后分享。')}return true;
    }
    const url=URL.createObjectURL(posterBlob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('海报已下载，可发送给朋友。');return true;
  }
  if(action==='copy-event-link'){
    try{await navigator.clipboard.writeText(`${location.origin}/#event/${posterEvent.id}`);toast('活动链接已复制')}
    catch{const input=$('#poster-link');input.focus();input.select();toast('请复制已选中的活动链接。')}return true;
  }
  return false;
}
function showEventPoster(event){
  posterEvent={...event};posterBlob=null;const published=event.status==='published';
  modal(`<h2 id="dialog-title">把这场相遇分享出去。</h2><p>${published?'下载海报，或使用手机系统分享给朋友。':'活动还未发布，当前海报会标注草稿；审核发布后可添加报名二维码。'}</p><label class="check"><input id="poster-qr" type="checkbox" ${published?'':'disabled'}>在海报上添加活动二维码（可选）</label><canvas id="event-poster" width="1080" height="1400" role="img" aria-label="${esc(event.title)}活动海报预览"></canvas><p id="poster-status" role="status">正在生成海报…</p><p id="poster-error" class="error" role="alert"></p><button class="btn light" data-action="retry-poster" hidden>重试生成</button><div class="modal-actions"><button class="btn" data-action="download-poster" disabled>下载海报 PNG</button><button class="btn light" data-action="share-poster" disabled>分享海报</button></div>${published?`<label class="field">活动链接<input id="poster-link" readonly value="${esc(location.origin)}/#event/${esc(event.id)}"></label><button class="text-button" data-action="copy-event-link">复制活动链接</button>`:''}`);
  renderEventPoster();
}
function posterLines(ctx,text,width){const lines=[];for(const paragraph of String(text).split(/\r?\n/)){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char}else line+=char}lines.push(line)}return lines}
async function posterImage(src){const image=new Image();image.src=src;await image.decode();return image}
async function renderEventPoster(){
  const event=posterEvent,canvas=$('#event-poster'),version=++posterVersion;if(!event||!canvas)return;
  posterBlob=null;const qr=$('#poster-qr').checked&&event.status==='published';
  const current=()=>version===posterVersion&&canvas===$('#event-poster')&&$('#modal').open;
  $('[data-action="download-poster"]').disabled=true;$('[data-action="share-poster"]').disabled=true;$('[data-action="retry-poster"]').hidden=true;
  $('#poster-status').textContent='正在生成海报…';$('#poster-error').textContent='';
  try{
    await document.fonts.ready;
    const [cover,logo,code]=await Promise.all([posterImage(event.cover_url||'/assets/series/heart.png'),posterImage('/assets/series/herstory-logo.png'),qr?posterImage(`/api/events/${event.id}/qr`):null]);
    if(!current())return;
    let ctx=canvas.getContext('2d');ctx.font='bold 62px sans-serif';const title=posterLines(ctx,event.title,936);
    ctx.font='32px sans-serif';const place=posterLines(ctx,`地点 / ${event.location}`,936),host=posterLines(ctx,`发起人 / ${event.host_nickname||state.me?.nickname||'Herstory'}`,936);
    const description=event.description.length>160?event.description.slice(0,160)+'…':event.description;const descriptionLines=posterLines(ctx,description,936);
    canvas.height=1100+title.length*80+(place.length+host.length+descriptionLines.length)*48+(qr?250:100);
    ctx=canvas.getContext('2d');ctx.fillStyle='#fff5f8';ctx.fillRect(0,0,1080,canvas.height);
    ctx.drawImage(logo,72,64,350,350*logo.height/logo.width);
    ctx.fillStyle='#bd2869';ctx.font='26px sans-serif';ctx.fillText('POP-UP CITY / 一起让事情发生',72,210);
    ctx.fillStyle='#f1d2df';ctx.fillRect(72,254,936,420);
    const fit=event.cover_url?Math.max(936/cover.width,420/cover.height):Math.min(720/cover.width,360/cover.height);
    ctx.save();ctx.beginPath();ctx.rect(72,254,936,420);ctx.clip();ctx.drawImage(cover,72+(936-cover.width*fit)/2,254+(420-cover.height*fit)/2,cover.width*fit,cover.height*fit);ctx.restore();
    let y=750;ctx.fillStyle='#301c29';ctx.font='bold 62px sans-serif';for(const line of title){ctx.fillText(line,72,y);y+=80}
    y+=22;ctx.font='32px sans-serif';ctx.fillStyle='#5f4354';
    for(const line of [`时间 / ${datetime(event.starts_at)}`,`结束 / ${datetime(event.ends_at)}（UTC+8）`,...place,...host,'',...descriptionLines]){ctx.fillText(line,72,y);y+=48}
    const bottom=canvas.height-70;
    if(code){ctx.drawImage(code,740,bottom-240,240,240);ctx.font='26px sans-serif';ctx.fillText('扫码查看详情与报名',72,bottom-140)}
    ctx.font='28px sans-serif';ctx.fillStyle='#bd2869';ctx.fillText(event.status==='published'?eventTimeLabel(event)==='未开始'?'请提前到场 · 活动开始后停止报名与签到':eventTimeLabel(event):`草稿 · ${statusText(event.status)} · 暂不可报名`,72,bottom-60);
    ctx.font='24px sans-serif';ctx.fillStyle='#5f4354';ctx.fillText('HERSTORY / 学习、链接、创造、玩。',72,bottom);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!current())return;if(!blob)throw new Error('生成失败');posterBlob=blob;
    $('#poster-status').textContent='海报已生成';$('[data-action="download-poster"]').disabled=false;$('[data-action="share-poster"]').disabled=false;
  }catch{
    if(!current())return;$('#poster-status').textContent='海报未完成';$('#poster-error').textContent='图片或二维码未能加载。请重试，或取消二维码后再生成。';$('[data-action="retry-poster"]').hidden=false;
  }
}
// Refresh deadline labels while the page is open, without replacing an active dialog or form.
setInterval(()=>{if(state.route==='events'&&!$('#modal').open&&!document.activeElement?.matches('input,textarea,select'))render()},30000);
