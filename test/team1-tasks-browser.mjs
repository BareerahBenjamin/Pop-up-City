// Only disposable memory fixtures; never uses production sessions or records.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDatabase(':memory:');migrate(db);
const owner='0aeff874-c8e3-49a4-9fe3-eb7b440f5bc0',now=Math.floor(Date.now()/1000),token=randomBytes(32).toString('hex'),origin='http://127.0.0.1:3357';
db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,'fixture@example.test','海椰','admin','active',?,?)").run(owner,now,now);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),owner,now+3600,now);
const ids=['f8fb1d84-74d5-4758-bb07-a2876a3bdbb5','18c62200-f02e-4d64-a0ba-2e1ce48b78e3','e518dfc2-3c25-4262-8347-27fe6ffc2f66'];
for(const [i,id]of [...ids,randomUUID()].entries()){
 db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,'活动','线上',?,?,100,?,'published',?,?)").run(id,i<3?'Team1 任务'+(i+1):'海椰的其他活动',i===2?'#科技碰瓷节 @Avalanche_CN @HerstoryWeb3':'本地任务展示样例',now+(i?0:-86400),now+7*86400,owner,now,now);
 if(i<3)db.raw.prepare('INSERT INTO website_event_pins VALUES(?,?,?)').run(id,owner,now);
}
const config=loadConfig({PORT:'3357',PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')}),server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3357,'127.0.0.1',resolve));
const out=process.env.BROWSER_OUTPUT||'/tmp/team1-tasks-browser';mkdirSync(out,{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'popup_city_session',value:token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const original=CanvasRenderingContext2D.prototype.fillText;window.posterText=[];CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.posterText.push(String(text));return original.call(this,text,...args);};});
  await page.goto(origin+'/#events');await page.locator('.discovery-pinned').waitFor();
  assert.equal(await page.locator('.discovery-pinned .event-card').count(),3);
  assert.deepEqual(await page.locator('.discovery-pinned .host>span:first-child').allTextContents(),['发起人 Team1','发起人 Team1','发起人 Team1']);
  const search=page.locator('#discovery-query');await search.fill('Team1');await search.press('Enter');await page.locator('.discovery-pinned').waitFor();assert.equal(await page.locator('.discovery-gallery .card-link').count(),3);
  await page.locator('.discovery-pinned').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/pinned-${width}.png`});
  await page.goto(origin+'/#event/'+ids[2]);await page.getByText('发起人 Team1',{exact:true}).waitFor();await page.getByRole('button',{name:'修改发起人',exact:true}).click();
  await page.getByText('当前发起人：Team1（管理账号：海椰）',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'生成分享海报',exact:true}).click();await page.getByText('海报已生成',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>window.posterText.includes('发起人 / Team1')));await page.keyboard.press('Escape');
  await page.screenshot({path:`${out}/detail-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(db.raw.prepare('SELECT nickname FROM members WHERE id=?').get(owner).nickname,'海椰');assert.ok(db.raw.prepare('SELECT host_id FROM events').all().every(row=>row.host_id===owner));
 console.log('PASSED: three pinned Team1 tasks; search; details; real manager visible to admin; poster label; untouched account identity; 375/1440px; no page errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();}
