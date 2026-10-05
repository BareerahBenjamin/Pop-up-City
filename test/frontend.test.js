import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../public/event-tools.js',import.meta.url),'utf8');
function tools(){const context=vm.createContext({document:{addEventListener(){}},setInterval(){},Intl,Date});vm.runInContext(code+'\nthis.helpers={eventDay,dayStart,shiftDay,interestedToday};',context);return context.helpers}
test('calendar uses venue date across UTC midnight and sorts only the current member interests',()=>{
  const h=tools(),now=Date.parse('2026-10-19T00:15:00+08:00')/1000;
  assert.equal(h.eventDay(now),'2026-10-19');assert.equal(h.eventDay(now-1800),'2026-10-18');
  assert.equal(h.shiftDay('2026-12-31',1),'2027-01-01');assert.equal(h.shiftDay('2026-10-01',-1),'2026-09-30');
  const make=(id,starts,ends,extra={})=>({id,status:'published',my_interested:1,starts_at:now+starts,ends_at:now+ends,...extra});
  const events=[make('later',3000,5000),make('first',100,1000),make('overnight',-3600,1800),make('cancelled',100,500,{status:'cancelled'}),make('private',100,500,{my_interested:0}),make('tomorrow',86400,90000),make('ended-yesterday',-5000,-1000)];
  assert.deepEqual(Array.from(h.interestedToday(events,now),e=>e.id),['overnight','first','later']);
});

test('future interests stay visible and sorted without leaking other members or cancelled events',()=>{
  const context=vm.createContext({document:{addEventListener(){}},setInterval(){},Intl,Date});
  vm.runInContext(code+'\nthis.upcoming=upcomingInterests;',context);
  const now=Date.parse('2026-10-19T12:00:00+08:00')/1000;
  const e=(id,offset,extra={})=>({id,starts_at:now+offset,ends_at:now+offset+3600,my_interested:1,status:'published',...extra});
  assert.deepEqual(Array.from(context.upcoming([e('late',86400*3),e('today',1800),e('first',86400),e('private',86400,{my_interested:0}),e('cancelled',86400,{status:'cancelled'})],now),e=>e.id),['first','late']);
});

test('bulk parser handles Excel, quoted CSV, UTF-8 BOM, and rejects invalid calendar dates',()=>{
  const context=vm.createContext({});vm.runInContext(readFileSync(new URL('../public/bulk-events.js',import.meta.url),'utf8')+'\nthis.parse=parseEventRows;',context);
  const csv='\uFEFF活动名称,开始时间,结束时间,地点,介绍,类型,参与名额,志愿者名额\r\n"一起,共创",2027-10-19 10:00,2027-10-19 12:00,空间,"两行\n介绍与""引号""",学习,12,0';
  const result=context.parse(csv);assert.equal(result[0].title,'一起,共创');assert.equal(result[0].description,'两行\n介绍与"引号"');assert.equal(result[0].starts_at,Date.parse('2027-10-19T10:00:00+08:00')/1000);
  assert.equal(context.parse('共创\t2027/10/19 10:00\t2027/10/19 12:00\t空间\t说明\t学习\t12\t0')[0].capacity,12);
  assert.throws(()=>context.parse(csv.replace('2027-10-19 10:00','2027-02-30 10:00')),/日期无效/);
  assert.throws(()=>context.parse(csv+'"'),/引号/);
  assert.throws(()=>context.parse('wrong,columns'),/8 列/);
});
