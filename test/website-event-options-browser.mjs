// Isolated memory data and fake identities only.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDatabase(':memory:');migrate(db);const now=Math.floor(Date.now()/1000),origin='http://127.0.0.1:3354',out=process.env.BROWSER_OUTPUT||'/tmp/website-options';mkdirSync(out,{recursive:true});
const admin=randomUUID(),token=randomBytes(32).toString('hex'),hash=v=>createHash('sha256').update(v).digest('hex');
db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,'预览管理员','admin','active',?,?)").run(admin,'preview@example.test',now,now);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),admin,now+3600,now);
const device=randomUUID();db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(device,admin,hash(device),now);
function event(title,start,end){const id=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,'本地示例','学习','课程教室',?,?,20,?,'published',?,?)").run(id,title,start,end,admin,now,now);return id;}
event('更早的课程',now+86400,now+90000);const pinned=event('置顶的课程',now+2*86400,now+2*86400+3600);
const historical=event('首周已签到课程',Date.parse('2026-10-21T10:00:00+08:00')/1000,Date.parse('2026-10-21T11:00:00+08:00')/1000);
db.raw.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(historical,admin,device,Date.parse('2026-10-21T09:30:00+08:00')/1000,'actual-local-fact');
const config=loadConfig({PORT:'3354',PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')}),server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3354,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'popup_city_session',value:token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/#event/${pinned}`);await page.getByRole('button',{name:'置顶活动',exact:true}).click();await page.getByRole('button',{name:'取消置顶',exact:true}).waitFor();
  await page.goto(`${origin}/#events`);await page.locator('.discovery-pinned').waitFor();assert.equal(await page.locator('.discovery-pinned .card-link').getAttribute('href'),'#event/'+pinned);
  assert.equal(await page.locator(`.discovery-gallery a.card-link[href="#event/${pinned}"]`).count(),1);
  assert.ok(await page.locator('.discovery-pinned').evaluate(e=>Boolean(e.compareDocumentPosition(document.querySelector('[data-event-group=nearby]'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.reload();await page.locator('.discovery-pinned').waitFor();await page.locator('.discovery-pinned').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/pinned-${width}.png`});
  await page.goto(`${origin}/#event/${pinned}`);await page.getByRole('button',{name:'取消置顶',exact:true}).click();await page.getByRole('button',{name:'置顶活动',exact:true}).waitFor();
  await page.goto(`${origin}/#planet`);await page.getByRole('button',{name:'星球报告',exact:true}).waitFor();
  const inner=page.frameLocator('#planet-frame').locator('.bottom-nav [data-tab=reports]');await inner.waitFor();
  await page.waitForFunction(()=>document.querySelector('#planet-frame')?.contentDocument?.querySelector('.bottom-nav [data-tab=reports]')?.disabled===false);
  const reportFrame=page.frameLocator('#planet-frame');
  await inner.click();await reportFrame.getByRole('button',{name:'查看首周回顾',exact:true}).waitFor();
  assert.equal(await page.locator('#planet-frame').evaluate(e=>Math.round(e.getBoundingClientRect().height)),1000);
  assert.equal(await reportFrame.locator('#report-list .report-entry').count(),2);
  assert.equal(await reportFrame.getByRole('button',{name:'尚未开放',exact:true}).count(),1);
  await reportFrame.getByRole('button',{name:'查看首周回顾',exact:true}).click();
  await reportFrame.getByRole('heading',{name:'我的星球足迹',exact:true}).waitFor();
  await reportFrame.getByText('首周已签到课程',{exact:true}).waitFor();
  assert.equal(await reportFrame.locator('.report-totals strong').first().innerText(),'1');
  assert.equal(await reportFrame.locator('.report-stats strong').first().innerText(),'1');
  assert.match(await reportFrame.locator('#report-reading').innerText(),/尚未归档/);
  assert.equal(await reportFrame.getByRole('button',{name:'保存星球与回顾',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('#planet-report-content').count(),0);
  assert.ok(await reportFrame.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/reports-${width}.png`});
  await reportFrame.locator('.report-activity').first().click();
  await reportFrame.locator('#report-inspect').getByRole('heading',{name:'首周已签到课程',exact:true}).waitFor();
  await reportFrame.locator('#report-back').click();await reportFrame.locator('#report-reading').waitFor({state:'visible'});
  await reportFrame.locator('#close-reports').click();
  await page.getByRole('button',{name:'星球报告',exact:true}).click();
  await reportFrame.getByRole('button',{name:'查看首周回顾',exact:true}).waitFor();
  await reportFrame.locator('#close-reports').focus();await page.keyboard.press('Escape');
  await reportFrame.locator('#reports-view').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-action="planet-reports"]'));
  assert.equal(await page.locator('#planet-frame.planet-report-expanded').count(),0);
  assert.equal(await page.locator('body').evaluate(e=>e.style.overflow),'');
  // Use the real event form twice with identical time ranges and different titles.
  await page.goto(`${origin}/#events`);const day=new Date((now+7*86400+8*3600)*1000).toISOString().slice(0,10);
  for(let i=0;i<2;i++){
   await page.getByRole('button',{name:'发起一个活动 ＋',exact:true}).click();await page.locator('#event-form [name=title]').fill(`同时间活动${width}-${i}`);await page.locator('#event-form [name=start]').fill(day+'T10:00');await page.locator('#event-form [name=end]').fill(day+'T11:00');await page.locator('#event-form [name=location]').fill('共创空间');await page.locator('#event-form [name=description]').fill('本地验证相同发起人、相同时间段多个活动');
   await page.getByRole('button',{name:'提交活动',exact:true}).click();await page.locator('#event-poster').waitFor();await page.keyboard.press('Escape');await page.goto(`${origin}/#events`);
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM events WHERE title LIKE ?').get(`同时间活动${width}-%`).n,2);
  assert.deepEqual(errors,[]);await context.close();
 }
 const guest=await browser.newContext(),page=await guest.newPage();await page.goto(`${origin}/#event/${pinned}`);await page.locator('.detail').waitFor();assert.equal(await page.locator('[data-action=toggle-event-pin]').count(),0);await guest.close();
 console.log('PASSED: pin/unpin and persistence; one pinned listing above chronological activities; real overlapping activity forms; first-week report through iframe entry; authenticated real records; 375/1440px; no page errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();}
