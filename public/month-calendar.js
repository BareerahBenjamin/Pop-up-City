'use strict';
// A venue-time month view. The API remains the only source of event/registration data.
let calendarMode='month',calendarLongtermOpen=false;
const isCalendarLongterm=event=>event.ends_at-event.starts_at>=3*86400;
function calendarLongtermSection(events,from,to){
  const previous=document.querySelector?.('.calendar-longterm');if(previous)calendarLongtermOpen=previous.open;
  const items=events.filter(e=>e.status==='published'&&isCalendarLongterm(e)&&e.starts_at<to&&e.ends_at>from).sort((a,b)=>Math.max(a.starts_at,from)-Math.max(b.starts_at,from)||a.ends_at-b.ends_at||a.id.localeCompare(b.id));
  if(!items.length)return '';
  return `<details class="calendar-longterm" ${calendarLongtermOpen?'open':''}><summary>期间的长期活动 <span>${items.length} 场 · 展开查看</span></summary><p>持续 3 天及以上的活动集中展示，不占用每日时段。</p><ul>${items.map(e=>`<li><a href="#event/${esc(e.id)}">${esc(e.title)}</a><span>${dayHeading(eventDay(e.starts_at))} ${eventClock(e.starts_at)} — ${dayHeading(eventDay(e.ends_at))} ${eventClock(e.ends_at)}</span><span>${esc(e.location)}</span></li>`).join('')}</ul></details>`;
}
function calendarTone(category){return ['pink','blue','yellow','neutral'][Array.from(String(category)).reduce((sum,c)=>sum+c.codePointAt(0),0)%4];}
function monthDays(date){
  const first=date.slice(0,7)+'-01',start=dayStart(first),weekday=new Date(start*1000+8*3600000).getUTCDay();
  const next=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),1)).toISOString().slice(0,10);
  const count=(dayStart(next)-start)/86400,rows=Math.ceil((weekday+count)/7);
  return Array.from({length:rows*7},(_,i)=>shiftDay(first,i-weekday));
}
function shiftMonth(date,offset){
  const target=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1+offset,1));
  const year=target.getUTCFullYear(),month=target.getUTCMonth();
  if(year<1970)return '1970-01-01';if(year>2099)return '2099-12-31';
  const day=Math.min(Number(date.slice(8)),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function eventsOnDay(events,day){const start=dayStart(day);return events.filter(e=>e.status==='published'&&!isCalendarLongterm(e)&&e.starts_at<start+86400&&e.ends_at>start).sort((a,b)=>Number(a.starts_at<start)-Number(b.starts_at<start)||a.starts_at-b.starts_at||a.id.localeCompare(b.id));}
function monthEventTime(event,day){return event.starts_at<dayStart(day)?'跨日':eventClock(event.starts_at);}
function monthCalendar(events){
  const month=calendarDate.slice(0,7),days=monthDays(calendarDate),today=eventDay(Date.now()/1000),selected=eventsOnDay(events,calendarDate);
  const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10),count=events.filter(e=>e.status==='published'&&e.starts_at<dayStart(monthEnd)&&e.ends_at>dayStart(month+'-01')).length;
  const categories=[...new Set(events.filter(e=>e.status==='published').map(e=>e.category))].sort();
  const cell=day=>{const items=eventsOnDay(events,day),outside=day.slice(0,7)!==month;return `<td class="month-cell ${outside?'outside-month':''} ${day===today?'month-today':''} ${day===calendarDate?'month-selected':''}"><button type="button" class="month-date" data-action="month-day" data-date="${day}" aria-label="${dayHeading(day)}，${items.length} 场活动" aria-pressed="${day===calendarDate}" ${day<'1970-01-01'||day>'2099-12-31'?'disabled':''}><time datetime="${day}">${Number(day.slice(8))===1?`${Number(day.slice(5,7))}月1日`:Number(day.slice(8))}</time>${day===today?'<span>今天</span>':''}</button><ol class="month-events">${items.slice(0,3).map(e=>`<li><a class="month-event tone-${calendarTone(e.category)} ${e.status==='cancelled'?'is-cancelled':''}" href="#event/${esc(e.id)}" title="${esc(e.title)} · ${monthEventTime(e,day)} · ${esc(e.location)}"><span class="month-dot" aria-hidden="true"></span><time>${monthEventTime(e,day)}</time><span>${e.status==='cancelled'?'[已取消] ':''}${esc(e.title)}</span>${e.my_attending?'<b aria-label="已报名">✓</b>':''}</a></li>`).join('')}</ol>${items.length>3?`<button type="button" class="month-more" data-action="month-day" data-date="${day}" aria-label="查看${dayHeading(day)}全部 ${items.length} 场活动">还有 ${items.length-3} 场 ＋</button>`:''}</td>`;};
  return `<section class="event-calendar month-calendar" aria-labelledby="calendar-title"><div class="section-head"><div><span class="eyebrow">MAKE TIME TO MEET</span><h2 id="calendar-title" tabindex="-1">活动日历总览</h2><p>先看当日安排，再浏览整月活动。</p></div>${calendarViewModes()}</div><div class="month-toolbar"><div class="month-heading"><h3 aria-live="polite">${Number(month.slice(0,4))}年${Number(month.slice(5))}月</h3><span>${count} 场活动 · 景德镇时间 UTC+8</span></div><div class="month-navigation"><button type="button" class="btn light" data-action="month-prev" aria-label="上个月" ${month==='1970-01'?'disabled':''}>←</button><button type="button" class="btn light" data-action="month-today">今天</button><button type="button" class="btn light" data-action="month-next" aria-label="下个月" ${month==='2099-12'?'disabled':''}>→</button><label class="month-picker"><span class="sr-only">选择月份</span><input id="calendar-month" type="month" min="1970-01" max="2099-12" value="${month}" aria-label="选择月份"></label></div></div><section class="month-day-agenda" aria-labelledby="month-day-title"><div class="section-head"><div><span class="eyebrow">当日安排</span><h3 id="month-day-title" tabindex="-1">${dayHeading(calendarDate)} <span class="muted">${selected.length} 场</span></h3></div><button type="button" class="text-button" data-action="month-open-day">查看一天时间表 ↗</button></div>${selected.length?`<ol class="month-day-list">${selected.map(e=>`<li data-interest-surface="month:${calendarDate}:${esc(e.id)}"><div class="month-day-time"><strong>${monthEventTime(e,calendarDate)}</strong><span>${eventClock(e.ends_at)} 结束</span></div><div><span class="eyebrow">${esc(e.category)} · ${esc(eventTimeLabel(e))}</span><a href="#event/${esc(e.id)}">${esc(e.title)}</a><p>${esc(e.location)}${e.my_attending?' · 已报名':''}</p>${interestFeedbackSlot(e)}</div>${interestButton(e,true)}</li>`).join('')}</ol>`:'<p class="month-empty">这一天暂无定时活动，长期活动可在下方展开查看。</p>'}</section><div class="calendar-legend" aria-label="活动类型">${categories.map(c=>`<span class="tone-${calendarTone(c)}"><i class="month-dot" aria-hidden="true"></i>${esc(c)}</span>`).join('')}<span class="legend-hint">点击日期查看当日安排 · 点击活动查看详情</span></div><div class="month-scroll" tabindex="0" role="region" aria-label="整月活动日历，可横向滚动"><table class="month-grid"><caption class="sr-only">${month} 活动日历，周日为每周第一天</caption><thead><tr>${['周日','周一','周二','周三','周四','周五','周六'].map(d=>`<th scope="col">${d}</th>`).join('')}</tr></thead><tbody>${Array.from({length:days.length/7},(_,row)=>`<tr>${days.slice(row*7,row*7+7).map(cell).join('')}</tr>`).join('')}</tbody></table></div>${calendarLongtermSection(events,dayStart(month+'-01'),dayStart(monthEnd))}</section>`;
}
function calendarViewModes(){return `<div class="calendar-modes" role="group" aria-label="日历显示范围"><button type="button" class="filter ${calendarMode==='month'?'selected':''}" data-action="month-view" aria-pressed="${calendarMode==='month'}">月总览</button>${[1,3,7].map(n=>`<button type="button" class="filter ${calendarMode==='time'&&calendarDays===n?'selected':''}" data-action="calendar-view" data-days="${n}" aria-pressed="${calendarMode==='time'&&calendarDays===n}">${{1:'一天',3:'三天',7:'一周'}[n]}</button>`).join('')}</div>`;}
async function handleMonthAction(button){
  const action=button.dataset.action;
  if(action==='calendar-view')calendarMode='time';
  if(!action.startsWith('month-'))return false;
  if(action==='month-view')calendarMode='month';
  else if(action==='month-prev')calendarDate=shiftMonth(calendarDate,-1);
  else if(action==='month-next')calendarDate=shiftMonth(calendarDate,1);
  else if(action==='month-today')calendarDate=eventDay(Date.now()/1000);
  else if(action==='month-day')calendarDate=button.dataset.date;
  else if(action==='month-open-day'){calendarMode='time';calendarDays=1;}
  await render();
  const target=action==='month-day'?document.querySelector(`.month-date[data-date="${calendarDate}"]`):document.querySelector(`[data-action="${action}"]`);
  (target||document.querySelector('#calendar-title'))?.focus({preventScroll:true});
  if(action==='month-day'){const agenda=document.querySelector('#month-day-title');agenda?.focus({preventScroll:true});agenda?.scrollIntoView({block:'center',behavior:'instant'});}
  if(action==='month-open-day')document.querySelector('#calendar-title')?.scrollIntoView({block:'start'});
  return true;
}
document.addEventListener('change',async event=>{
  if(event.target.id==='calendar-month'&&event.target.checkValidity()&&/^\d{4}-\d{2}$/.test(event.target.value)){
    calendarDate=event.target.value+'-01';await render();document.querySelector('#calendar-month')?.focus({preventScroll:true});
  }
});
