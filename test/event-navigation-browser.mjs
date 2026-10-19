// Local regression only: disposable database, fake sessions, no real email or accounts.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDatabase(':memory:');migrate(db);
const origin='http://127.0.0.1:3348',now=Math.floor(Date.now()/1000),out=process.env.BROWSER_OUTPUT||'/tmp/popup-event-navigation';mkdirSync(out,{recursive:true});
const token=randomBytes(32).toString('hex'),member=randomUUID(),host=randomUUID();
for(const [id,name] of [[member,'选课邻居'],[host,'课程发起人']])db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(id,id+'@example.test',name,now,now);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),member,now+86400,now);
db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(randomUUID(),member,createHash('sha256').update(randomBytes(32)).digest('hex'),now);
const day=new Date((now+86400+8*3600)*1000).toISOString().slice(0,10),base=Date.parse(day+'T00:00:00+08:00')/1000;
const ids=[];
for(let i=0;i<18;i++){
  const id=randomUUID(),start=base+Math.floor(i/6)*86400+(10+i%6)*3600;ids.push(id);
  db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,20,?,'published',?,?)").run(id,`返回测试课程 ${i+1}`,'在隔离本地环境检查报名和返回原来的选课位置。',i%2?'共创':'学习','E栋2层 · 课程教室',start,start+1800,host,now,now);
}
const config=loadConfig({PORT:'3348',PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')});
const server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3348,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Los_Angeles'});
  await context.addCookies([{name:'popup_city_session',value:token,url:origin}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const waitList=()=>page.waitForFunction(()=>state.route==='events'&&document.querySelector('.discovery-gallery'));
  const position=locator=>locator.evaluate(e=>({y:scrollY,top:e.getBoundingClientRect().top}));
  const checkPosition=async(locator,before)=>{
    const after=await position(locator);assert.ok(Math.abs(after.y-before.y)<8,`scroll at ${width}: ${before.y} -> ${after.y}`);
    assert.ok(Math.abs(after.top-before.top)<8,`anchor at ${width}: ${before.top} -> ${after.top}`);
    assert.equal(await locator.evaluate(e=>e===document.activeElement),true);
  };
  await page.goto(origin+'/#events');await waitList();await page.evaluate(()=>document.fonts.ready);
  await page.locator('#discovery-query').fill('返回测试');await page.locator('#discovery-form button').click();
  await page.locator('#discovery-category').selectOption('学习');await page.locator('.discovery-scopes [data-scope=upcoming]').click();
  const card=page.locator(`.discovery-gallery a[href="#event/${ids[10]}"]`);
  await card.evaluate(e=>e.scrollIntoView({block:'center'}));const before=await position(card);
  await card.click();await page.locator('.detail').waitFor();
  assert.equal(await page.locator('[data-action=return-event-list]').innerText(),'← 返回刚才的位置');
  await page.getByRole('button',{name:'我要参加 ↗',exact:true}).click();
  await page.getByRole('button',{name:'取消参加',exact:true}).waitFor();
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM event_registrations WHERE event_id=? AND member_id=? AND kind='attendee'").get(ids[10],member).n,1);
  await page.locator('[data-action=return-event-list]').click();await waitList();await checkPosition(card,before);
  assert.equal(await page.locator('#discovery-query').inputValue(),'返回测试');
  assert.equal(await page.locator('#discovery-category').inputValue(),'学习');
  assert.equal(await page.locator('.discovery-scopes [data-scope=upcoming]').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:`${out}/returned-card-${width}.png`});
  // The back link consumes the detail history entry; browser Forward / Back is also stable.
  await page.goForward();await page.locator('.detail').waitFor();await page.goBack();await waitList();await checkPosition(card,before);
  // Returning before the enrollment response arrives must not allow its later render to jump.
  const lateCard=page.locator(`.discovery-gallery a[href="#event/${ids[12]}"]`);
  await lateCard.evaluate(e=>e.scrollIntoView({block:'center'}));const lateBefore=await position(lateCard);
  await lateCard.click();await page.locator('.detail').waitFor();
  let release;const gate=new Promise(resolve=>release=resolve);
  const writeUrl=`**/api/events/${ids[12]}/attendees`;
  await page.route(writeUrl,async route=>{await gate;await route.continue()});
  const request=page.waitForRequest(r=>r.url().endsWith(`/${ids[12]}/attendees`)&&r.method()==='POST');
  await page.getByRole('button',{name:'我要参加 ↗',exact:true}).click();await request;
  await page.locator('[data-action=return-event-list]').click();await waitList();await checkPosition(lateCard,lateBefore);
  release();await page.waitForFunction(id=>state.events.find(e=>e.id===id)?.my_attending,ids[12]);await checkPosition(lateCard,lateBefore);
  await page.unroute(writeUrl);
  // Return from a chosen calendar date, including a detail-page reload.
  await page.locator('.discovery-controls [data-action=discovery-reset]').click();
  await page.locator('#calendar-month').fill(day.slice(0,7));await page.locator(`.month-date[data-date="${day}"]`).click();
  const row=page.locator(`.month-day-list a[href="#event/${ids[2]}"]`);
  await row.evaluate(e=>e.scrollIntoView({block:'center'}));const calendarBefore=await position(row);
  await row.focus();await page.keyboard.press('Enter');await page.locator('.detail').waitFor();
  await page.reload();await page.locator('.detail').waitFor();
  await page.locator('[data-action=return-event-list]').click();await waitList();await checkPosition(row,calendarBefore);
  assert.equal(await page.locator('.month-selected .month-date').getAttribute('data-date'),day);
  const monthLink=page.locator(`.month-selected .month-event[href="#event/${ids[2]}"]`);
  await monthLink.scrollIntoViewIfNeeded();const monthBefore=await position(monthLink),monthLeft=await page.locator('.month-scroll').evaluate(e=>e.scrollLeft);
  await monthLink.click();await page.locator('.detail').waitFor();await page.locator('[data-action=return-event-list]').click();await waitList();await checkPosition(monthLink,monthBefore);
  assert.ok(Math.abs(await page.locator('.month-scroll').evaluate(e=>e.scrollLeft)-monthLeft)<2);
  // Week view and inner horizontal scroll are preserved as well.
  await page.locator('[data-action=calendar-view][data-days="7"]').click();
  const week=page.locator(`.calendar-event a[href="#event/${ids[14]}"]`);
  await page.locator('.calendar-scroll').evaluate(e=>e.scrollLeft=300);await week.scrollIntoViewIfNeeded();const weekBefore=await position(week),left=await page.locator('.calendar-scroll').evaluate(e=>e.scrollLeft);
  await week.click();await page.locator('.detail').waitFor();await page.goBack();await waitList();await checkPosition(week,weekBefore);
  assert.equal(await page.locator('.calendar-grid').getAttribute('data-days'),'7');
  assert.ok(Math.abs(await page.locator('.calendar-scroll').evaluate(e=>e.scrollLeft)-left)<2);
  await page.screenshot({path:`${out}/returned-calendar-${width}.png`});
  // Ordinary route changes still start at the top; restoration is scoped to detail -> list.
  await page.locator('nav a[href="#tasks"]').click();await page.waitForFunction(()=>state.route==='tasks');
  await page.locator('nav a[href="#events"]').click();await waitList();assert.equal(await page.evaluate(()=>scrollY),0);
  assert.deepEqual(errors,[]);await context.close();db.raw.prepare('DELETE FROM event_registrations WHERE event_id IN (?,?) AND member_id=?').run(ids[10],ids[12],member);
 }
 const guest=await browser.newContext({viewport:{width:375,height:900}}),page=await guest.newPage();
 await page.goto(`${origin}/#event/${ids[0]}`);await page.locator('.detail').waitFor();
 assert.equal(await page.locator('[data-action=return-event-list]').innerText(),'← 全部活动');
 await page.locator('[data-action=return-event-list]').click();await page.locator('.discovery-gallery').waitFor();assert.equal(await page.evaluate(()=>scrollY),0);
 await guest.close();
 console.log('PASSED: enrollment then return to original card; filters, date and week/horizontal scroll; browser back/forward; detail reload; keyboard focus; direct-link fallback; 375/1440px layouts; no page errors.');
 console.log(`Screenshots: ${out}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close()}
