import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/dashboard.js',import.meta.url),'utf8');
function helpers(){
  const context=vm.createContext({document:{addEventListener(){}},setInterval(){},Intl,Date});
  vm.runInContext(readFileSync(new URL('../public/event-tools.js',import.meta.url),'utf8')+'\n'+source+'\n'+readFileSync(new URL('../public/month-calendar.js',import.meta.url),'utf8')+'\nthis.helpers={filterDiscovery,calendarHour,dayStart,dashboardCalendar};',context);
  return {context,...context.helpers};
}
test('discovery combines search and category; personal filters exclude cancelled and ended activities without mutating source',()=>{
  const {filterDiscovery}=helpers(),now=1000;
  const make=(id,extra={})=>({id,title:'一起做陶器',location:'共同客厅',host_nickname:'邻居',category:'共创',status:'published',starts_at:1100,ends_at:1200,...extra});
  const events=[make('b',{my_interested:1}),make('a',{my_attending:1}),make('cancelled',{status:'cancelled',my_interested:1}),make('ended',{starts_at:800,ends_at:900,my_interested:1}),make('active',{starts_at:900,my_attending:1}),make('tech',{title:'Game Jam',category:'科技'})];
  const ids=filters=>Array.from(filterDiscovery(events,{query:'',category:'',scope:'all',...filters},now),e=>e.id);
  assert.deepEqual(ids({scope:'saved'}),['b']);
  assert.deepEqual(ids({scope:'joined'}),['active','a']);
  assert.deepEqual(ids({scope:'upcoming'}),['a','b','tech']);
  assert.deepEqual(ids({query:'  GAME ',category:'科技'}),['tech']);
  assert.deepEqual(ids({query:'共同客厅',scope:'saved'}),['b']);
  assert.deepEqual(ids({query:'不存在'}),[]);
  assert.equal(events[0].id,'b');
});
test('calendar shows cross-midnight events on each occupied venue day and excludes exact-boundary spillover and drafts',()=>{
  const {context,dayStart,dashboardCalendar}=helpers(),start=dayStart('2026-10-19');
  vm.runInContext("calendarDate='2026-10-19';calendarDays=3;calendarMode='time';function esc(value){return String(value??'').replaceAll('<','&lt;')} interestButton=()=>'';interestFeedbackSlot=()=>'';function statusText(status){return status}",context);
  const event=(id,from,to,status='published')=>({id,title:id,category:'共创',location:'客厅',starts_at:start+from,ends_at:start+to,status});
  const html=dashboardCalendar([event('overnight',23*3600,26*3600),event('midnight-end',22*3600,24*3600),event('draft',10*3600,11*3600,'pending'),event('cancelled',10*3600,11*3600,'cancelled')]);
  assert.equal((html.match(/href="#event\/overnight"/g)||[]).length,2);
  assert.equal((html.match(/href="#event\/midnight-end"/g)||[]).length,1);
  assert.ok(!html.includes('href="#event/draft"'));assert.ok(!html.includes('href="#event/cancelled"'));
  assert.match(html,/10月20日周二 00:00/);
  assert.match(html,/跨日 · 23:00/);
});
