// Disposable local fixtures only, including fake device bindings for eligibility.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDatabase(':memory:');migrate(db);const now=Math.floor(Date.now()/1000),origin='http://127.0.0.1:3358',hash=value=>createHash('sha256').update(value).digest('hex');
function member(nickname,bound=true){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,'member','active',?,?)").run(id,id+'@example.test',nickname,now,now);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,now+3600,now);if(bound)db.raw.prepare('INSERT INTO devices VALUES(?,?,?,NULL,?)').run(randomUUID(),id,hash(id),now);return{id,token};}
const user=member('报名预览邻居'),other=member('其他预览邻居'),unbound=member('未绑定预览邻居',false);
function event(title,start,end,capacity=10){const id=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,status,created_at,updated_at) VALUES(?,?,'本地两周报名测试','活动','线上',?,?,?,1,?,'published',?,?)").run(id,title,start,end,capacity,other.id,now,now);return id;}
const end=now+7*86400,long=event('两周长期活动',now-7*86400,end),ordinary=event('已开始的普通课程',now-3600,now+3600),full=event('已满长期活动',now-7*86400,end,1);
db.raw.prepare("INSERT INTO event_registrations VALUES(?,?,'attendee',?)").run(full,other.id,now);
const config=loadConfig({PORT:'3358',PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')}),server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3358,'127.0.0.1',resolve));
const out=process.env.BROWSER_OUTPUT||'/tmp/longterm-registration';mkdirSync(out,{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'popup_city_session',value:user.token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#event/'+long);await page.getByRole('button',{name:'我要参加 ↗',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'我要参加 ↗',exact:true}).isEnabled(),true);await page.getByText('进行中 · 可报名',{exact:true}).waitFor();
  await page.getByRole('button',{name:'我要参加 ↗',exact:true}).click();await page.getByRole('button',{name:'取消参加',exact:true}).waitFor();assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM event_registrations WHERE event_id=? AND member_id=? AND kind='attendee'").get(long,user.id).n,1);
  await page.getByRole('button',{name:'报名志愿者',exact:true}).click();await page.getByRole('button',{name:'取消志愿者报名',exact:true}).waitFor();
  await page.screenshot({path:`${out}/registered-${width}.png`});
  await page.getByRole('button',{name:'取消参加',exact:true}).click();await page.getByRole('button',{name:'我要参加 ↗',exact:true}).waitFor();await page.getByRole('button',{name:'取消志愿者报名',exact:true}).click();await page.getByRole('button',{name:'报名志愿者',exact:true}).waitFor();
  await page.goto(origin+'/#event/'+ordinary);await page.locator('.detail').waitFor();assert.equal(await page.locator('[data-action=toggle-attendee]').isDisabled(),true);assert.match(await page.locator('[data-action=toggle-attendee]').innerText(),/报名截止/);
  await page.goto(origin+'/#event/'+full);await page.locator('.detail').waitFor();assert.equal(await page.locator('[data-action=toggle-attendee]').isDisabled(),true);
  db.raw.prepare('UPDATE events SET ends_at=? WHERE id=?').run(now-1,long);await page.goto(origin+'/#event/'+long);await page.reload();await page.locator('.detail').waitFor();assert.equal(await page.locator('[data-action=toggle-attendee]').isDisabled(),true);assert.equal(await page.locator('[data-action=toggle-attendee]').innerText(),'已结束');
  db.raw.prepare('UPDATE events SET ends_at=? WHERE id=?').run(end,long);assert.deepEqual(errors,[]);await context.close();
 }
 const context=await browser.newContext();await context.addCookies([{name:'popup_city_session',value:unbound.token,url:origin}]);const page=await context.newPage();await page.goto(origin+'/#event/'+long);await page.getByText('报名活动前，请先联系管理员完成板子绑定。',{exact:true}).waitFor();await page.getByRole('button',{name:'我要参加 ↗',exact:true}).click();await page.locator('#toast.visible').filter({hasText:'绑定'}).waitFor();assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_registrations WHERE member_id=?').get(unbound.id).n,0);await context.close();
 console.log('PASSED: started long-term attendee/volunteer signup and cancellation; end deadline; ordinary and full events remain closed; binding retained; 375/1440px; no script errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();}
