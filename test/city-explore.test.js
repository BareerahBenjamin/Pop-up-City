import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function helpers(){
  const context=vm.createContext({document:{addEventListener(){}},window:{addEventListener(){}},setInterval(){},Intl,Date});
  vm.runInContext(['event-tools.js','dashboard.js','month-calendar.js','campus-map.js'].map(name=>readFileSync(new URL(`../public/${name}`,import.meta.url),'utf8')).join('\n')+`
    function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')}
    function statusText(value){return value}
    interestButton=()=>'';interestFeedbackSlot=()=>'';
    this.helpers={monthDays,shiftMonth,eventsOnDay,monthCalendar,campusPlaceFor,dayStart};`,context);
  return {context,...context.helpers};
}
test('month grid covers full weeks, leap February, six-row months and year boundaries in venue time',()=>{
  const {monthDays,shiftMonth}=helpers();
  const oct=Array.from(monthDays('2026-10-19'));
  assert.equal(oct.length,35);assert.equal(oct[0],'2026-09-27');assert.equal(oct.at(-1),'2026-10-31');
  assert.equal(Array.from(monthDays('2026-08-01')).length,42);
  assert.ok(Array.from(monthDays('2028-02-01')).includes('2028-02-29'));
  assert.equal(shiftMonth('2028-01-31',1),'2028-02-29');
  assert.equal(shiftMonth('2026-01-31',1),'2026-02-28');
  assert.equal(shiftMonth('2026-12-31',1),'2027-01-31');
  assert.equal(shiftMonth('1970-01-01',-1),'1970-01-01');
  assert.equal(shiftMonth('2099-12-31',1),'2099-12-31');
});
test('month day selection includes cross-midnight events but never exact-midnight endings, drafts or other dates',()=>{
  const {dayStart,eventsOnDay}=helpers(),start=dayStart('2026-10-19');
  const make=(id,from,to,status='published')=>({id,starts_at:start+from,ends_at:start+to,status});
  const events=[make('overnight',23*3600,26*3600),make('ends-at-midnight',22*3600,86400),make('pending',25*3600,26*3600,'pending'),make('cancelled',25*3600,26*3600,'cancelled')];
  assert.deepEqual(Array.from(eventsOnDay(events,'2026-10-20'),e=>e.id),['overnight']);
  assert.equal(events[0].id,'overnight');
});
test('month renders safe event labels, overflow access and every selected-day activity including final supported date',()=>{
  const {context,dayStart,monthCalendar}=helpers();
  vm.runInContext("calendarDate='2099-12-31'",context);
  const events=Array.from({length:5},(_,index)=>({id:String(index),title:index===0?'<img onerror="bad()">':`活动${index}`,category:'共创',location:'E栋2层',starts_at:dayStart('2099-12-31')+index*3600,ends_at:dayStart('2099-12-31')+(index+1)*3600,status:'published'}));
  const html=monthCalendar(events);
  assert.match(html,/5 场活动 · 景德镇/);assert.match(html,/还有 2 场/);
  assert.ok(!html.includes('<img onerror='));assert.match(html,/&lt;img onerror=&quot;bad\(\)&quot;>/);
  assert.equal((html.match(/data-interest-surface="month:2099-12-31:/g)||[]).length,5);
});
test('map resolves only known venue aliases and gives specific floor names priority',()=>{
  const {campusPlaceFor}=helpers(),find=location=>campusPlaceFor({location})?.id||null;
  assert.equal(find('E栋2楼 · 课程教室'),'e');
  assert.equal(find('C 栋2层公开活动区'),'shared');
  assert.equal(find('C栋居住区'),'c');
  assert.equal(find('B栋办理入住'),'b');
  assert.equal(find('cue-D打车定位'),'taxi');
  assert.equal(find('迎新点'),'welcome');
  assert.equal(find('共创空间'),null);assert.equal(find('陶邑潮生酒店'),null);assert.equal(find(''),null);
});
