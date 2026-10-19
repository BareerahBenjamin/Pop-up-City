'use strict';
// View preferences only; registrations and interests remain owned by the API.
let discovery={query:'',category:'',scope:'all'},discoveryOwner=null;
function filterDiscovery(events,filters=discovery,now=Date.now()/1000){
  const query=filters.query.trim().toLocaleLowerCase();
  return events.filter(e=>(!query||[e.title,e.location,e.host_nickname,e.category].some(value=>String(value||'').toLocaleLowerCase().includes(query)))
    &&(!filters.category||e.category===filters.category)
    &&(filters.scope==='all'||e.status==='published'&&e.ends_at>now&&(filters.scope==='upcoming'&&e.starts_at>now||filters.scope==='saved'&&e.my_interested||filters.scope==='joined'&&e.my_attending)))
    .sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id));
}
function dashboardPage(events){
  const owner=state.me?.id||null;
  if(owner!==discoveryOwner){discoveryOwner=owner;discovery={...discovery,scope:'all'};}
  const filtered=filterDiscovery(events),categories=[...new Set(events.map(e=>e.category))].sort();
  if(discovery.category&&!categories.includes(discovery.category)){discovery.category='';return dashboardPage(events);}
  const upcoming=events.filter(e=>e.status==='published'&&e.ends_at>Date.now()/1000);
  const metrics=[['upcoming','即将发生',upcoming.filter(e=>e.starts_at>Date.now()/1000).length,'看看接下来的相遇','yellow'],['saved','我的感兴趣',state.me?upcoming.filter(e=>e.my_interested).length:'—',state.me?'收藏想参加的活动':'登录后收藏你的安排','pink'],['joined','我的报名',state.me?upcoming.filter(e=>e.my_attending).length:'—',state.me?'为已经约好的相遇留出时间':'登录后查看报名活动','blue']];
  return `${hero()}<section class="dashboard-intro"><div><span class="eyebrow">HERSTORY / POP-UP CITY</span><h2>${state.me?`${esc(state.me.nickname)}，`:'一起'}安排下一场相遇。</h2><p>学习、链接、创造、玩。<span>2026.10.19 — 11.01 · 景德镇</span></p></div></section>
    <section class="dashboard-overview" aria-label="活动安排概览">${metrics.map(([scope,title,count,note,tone])=>`<button type="button" class="overview-card ${tone}" data-action="discovery-scope" data-scope="${scope}" aria-pressed="${discovery.scope===scope}"><span class="overview-label">${title}<span aria-hidden="true">↗</span></span><strong>${count}<small>${typeof count==='number'?' 场':''}</small></strong><span>${note}</span></button>`).join('')}</section>
    <div class="city-section-links" role="group" aria-label="活动页内容导航"><button type="button" class="text-button" data-action="city-jump" data-target="calendar-title">▦ 活动日历总览 ↓</button><button type="button" class="text-button" data-action="city-jump" data-target="campus-map-title">⌖ Herstory 生活地图 ↓</button><button type="button" class="text-button" data-action="city-jump" data-target="discovery-title">全部活动 ↓</button></div><section class="discovery-controls" aria-label="筛选活动"><form id="discovery-form" role="search"><label class="discovery-search"><span aria-hidden="true">⌕</span><span class="sr-only">搜索活动</span><input id="discovery-query" name="query" type="search" maxlength="120" placeholder="搜索活动、地点或发起人" value="${esc(discovery.query)}"></label><button class="btn light" type="submit">搜索</button></form><label class="category-select">活动类型<select id="discovery-category"><option value="">全部类型</option>${categories.map(c=>`<option value="${esc(c)}" ${discovery.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><div class="discovery-scopes" role="group" aria-label="活动范围">${[['all','全部活动'],['upcoming','即将发生'],['saved','感兴趣'],['joined','已报名']].map(([scope,label])=>`<button type="button" class="filter ${discovery.scope===scope?'selected':''}" data-action="discovery-scope" data-scope="${scope}" aria-pressed="${discovery.scope===scope}">${label}</button>`).join('')}</div><p id="discovery-result" role="status">${discovery.query?`“${esc(discovery.query)}” · `:''}找到 ${filtered.length} 场活动${discovery.category?` · ${esc(discovery.category)}`:''}</p>${discovery.query||discovery.category||discovery.scope!=='all'?'<button type="button" class="text-button" data-action="discovery-reset">清除筛选</button>':''}</section>
${calendarSection(filtered)}<details class="dashboard-agenda" ${state.me&&(interestedToday(events).length||upcomingInterests(events).length)?'open':''}><summary><h2 class="agenda-title">我的感兴趣</h2> <span>查看今日与未来收藏</span></summary>${todaySchedule()}</details>
    ${campusMapSection()}<section class="discovery-gallery" aria-labelledby="discovery-title"><div class="section-head"><div><span class="eyebrow">DISCOVER / TOGETHER</span><h2 id="discovery-title" tabindex="-1">在这里，让想法碰面。</h2><p>找一件想做的事，或者发起你自己的活动。</p></div><span class="badge neutral">${filtered.length} 场活动</span></div><div class="grid">${filtered.length?filtered.map(eventCard).join(''):empty(events.length?'没有符合筛选条件的活动。':'活动正在筹备中。发布后会在这里出现。',events.length?'<button class="btn light" data-action="discovery-reset">查看全部活动</button>':'<button class="btn light" data-action="new-event">发起一个活动 ＋</button>')}</div></section>`;
}
function calendarHour(event,from){return event.starts_at<from?0:Number(eventClock(event.starts_at).slice(0,2));}
function dashboardCalendar(events){
  if(calendarMode==='month')return monthCalendar(events);
  return dashboardTimeCalendar(events);
}
function dashboardTimeCalendar(events){
  const start=dayStart(calendarDate),published=events.filter(e=>e.status==='published').sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id));
  const days=Array.from({length:calendarDays},(_,i)=>{const from=start+i*86400;return {from,day:eventDay(from),items:published.filter(e=>e.starts_at<from+86400&&e.ends_at>from)};});
  const occupied=days.flatMap(d=>d.items.map(e=>calendarHour(e,d.from)));
  const first=Math.min(9,...occupied),last=Math.max(18,...occupied),hours=Array.from({length:last-first+1},(_,i)=>first+i);
  const tones=new Map([...new Set(published.map(e=>e.category))].map(c=>[c,['pink','blue','yellow','neutral'][Array.from(c).reduce((sum,char)=>sum+char.codePointAt(0),0)%4]]));
  const cells=days.map(({from,day,items},i)=>`<section class="calendar-day ${day===eventDay(Date.now()/1000)?'is-today':''}" aria-label="${dayHeading(day)}" style="--day-column:${i+2}"><h3><span>${dayHeading(day)}</span><small>${items.length} 场活动</small></h3>${hours.map((hour,row)=>{const slot=items.filter(e=>calendarHour(e,from)===hour);return `<div class="calendar-slot" style="--hour-row:${row+2}">${slot.map(e=>`<article class="calendar-event tone-${tones.get(e.category)} ${e.status==='cancelled'?'is-cancelled':''}" data-interest-surface="calendar:${day}:${esc(e.id)}"><span class="calendar-category">${esc(e.category)}${e.my_attending?' · 已报名':''}</span><a href="#event/${esc(e.id)}">${esc(e.title)}</a><p class="calendar-time">${e.starts_at<from?'跨日 · ':''}${eventClock(e.starts_at)} — ${e.ends_at>=from+86400?`${dayHeading(eventDay(e.ends_at))} `:''}${eventClock(e.ends_at)}</p><p>${esc(e.location)}</p><div class="calendar-card-foot"><span>${esc(eventTimeLabel(e))}</span>${interestButton(e,true)}</div>${e.my_interested?`<button type="button" class="text-button calendar-saved" data-action="view-interest-agenda" data-id="${esc(e.id)}">已收藏 · 查看安排 →</button><p class="calendar-save-note">感兴趣不等于报名</p>`:""}${interestFeedbackSlot(e,true)}</article>`).join('')}${!items.length&&row===0?'<p class="calendar-empty">当天暂无活动<br><span>留一点空白给新的相遇。</span></p>':''}</div>`}).join('')}</section>`).join('');
  const next=published.find(e=>e.starts_at>=Date.now()/1000);
  return `<section class="event-calendar" aria-labelledby="calendar-title"><div class="section-head"><div><span class="eyebrow">MAKE TIME TO MEET</span><h2 id="calendar-title" tabindex="-1">活动日历</h2><p>景德镇时间（UTC+8）· 按开始时间分行，同一时段的活动集中展示。</p></div>${calendarViewModes()}</div><div class="calendar-toolbar"><div class="calendar-pagination"><button class="btn light" data-action="calendar-prev" aria-label="上一段日期">← 前${calendarDays}天</button><button class="btn light" data-action="calendar-next" aria-label="下一段日期">后${calendarDays}天 →</button></div><label>查看日期 <input id="calendar-date" type="date" min="1970-01-01" max="2099-12-25" value="${calendarDate}"></label><button class="btn light" data-action="calendar-today">今天</button>${next?`<button class="text-button" data-action="discovery-next" data-date="${eventDay(next.starts_at)}">跳到下场活动 ↗</button>`:''}</div><p class="calendar-range">${dayHeading(calendarDate)}${calendarDays>1?` — ${dayHeading(shiftDay(calendarDate,calendarDays-1))}`:''}<span>横向滚动可查看整周；卡片高度随内容展开。</span></p><div class="calendar-scroll" tabindex="0" role="region" aria-label="活动日历，可横向滚动"><div class="calendar-grid" data-days="${calendarDays}" style="--calendar-columns:${calendarDays}"><span class="calendar-axis-title" aria-hidden="true">时间</span>${hours.map((hour,row)=>`<time class="calendar-axis" style="grid-row:${row+2}" aria-hidden="true">${String(hour).padStart(2,'0')}:00</time>`).join('')}${cells}</div></div></section>`;
}
async function updateDiscovery(focus){
  await render();
  if(focus==='query')$('#discovery-query')?.focus({preventScroll:true});
  else if(focus==='category')$('#discovery-category')?.focus({preventScroll:true});
  else if(focus)document.querySelector(`.discovery-scopes [data-scope="${focus}"]`)?.focus({preventScroll:true});
}
async function handleDashboardAction(button){
  const action=button.dataset.action;
  if(await handleMonthAction(button))return true;
  if(action==='city-jump'){const target=document.getElementById(button.dataset.target);target?.focus({preventScroll:true});target?.scrollIntoView({block:'start',behavior:'instant'});return true;}
  if(action==='discovery-scope'){
    const scope=button.dataset.scope;
    if(!['all','upcoming','saved','joined'].includes(scope))return true;
    if(['saved','joined'].includes(scope)&&!requireLogin())return true;
    discovery.scope=scope;await updateDiscovery(scope);return true;
  }
  if(action==='discovery-reset'){discovery={query:'',category:'',scope:'all'};await updateDiscovery('query');return true;}
  if(action==='discovery-next'){calendarDate=button.dataset.date;await render();$('#calendar-title')?.scrollIntoView({block:'start'});document.querySelector('[data-action="discovery-next"]')?.focus({preventScroll:true});return true;}
  return false;
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='discovery-form')return;
  event.preventDefault();discovery.query=String(new FormData(event.target).get('query')||'').slice(0,120);updateDiscovery('query');
});
document.addEventListener('change',event=>{
  if(event.target.id==='discovery-category'){discovery.category=event.target.value;updateDiscovery('category');}
});
