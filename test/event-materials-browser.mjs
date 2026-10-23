// Local-only, fake identities and an in-memory database; no .env or mail.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=3349,origin=`http://127.0.0.1:${port}`,db=openDatabase(':memory:');migrate(db);
const now=Math.floor(Date.now()/1000),out=process.env.BROWSER_OUTPUT||'/tmp/popup-materials';mkdirSync(out,{recursive:true});
const sha=v=>createHash('sha256').update(v).digest('hex');
function member(name,role='member',status='active'){
 const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare('INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,id+'@example.test',name,role,status,now,now);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),id,now+3600,now);return{id,token};
}
const admin=member('预览管理员','admin'),host=member('原导师'),next=member('新导师'),invited=member('仅导入用户','member','invited'),disabled=member('停用用户','member','disabled');
let courseIndex=0;
function course(){const id=randomUUID(),start=now-7200-(courseIndex++)*7200;db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,'已结束的导师课程','课程结束后继续共享资料','学习','E栋课程教室',?,?,20,?,'published',?,?)").run(id,start,start+3600,host.id,now,now);return id;}
const config=loadConfig({PORT:String(port),PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')});
const server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const html=Buffer.from('<!doctype html><html><meta charset="utf-8"><body><h1>导师课程讲义</h1><button id="next">下一页</button><p id="page">第1页</p><script>next.onclick=()=>page.textContent="第2页";try{parent.document.documentElement.dataset.unsafe="yes"}catch{document.body.dataset.isolated="yes"}</script><!--'+ '课件内容'.repeat(1800)+'--></body></html>');
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 for(const width of [375,1440]){
  const id=course(),context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'popup_city_session',value:admin.token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/#event/${id}`);await page.locator('.detail').waitFor();await page.locator('#material-list .empty').waitFor();
  await page.getByRole('button',{name:'上传课件 ＋',exact:true}).click();await page.locator('#material-title').fill('课后讲义');await page.locator('#material-file').setInputFiles({name:'导师讲义.html',mimeType:'text/html',buffer:html});await page.getByRole('button',{name:'上传课件',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});await page.locator('.material-card').waitFor();assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_materials WHERE event_id=?').get(id).n,1);
  await page.locator('.material-preview summary').click();const frame=page.frameLocator('.material-preview iframe');await frame.getByRole('heading',{name:'导师课程讲义'}).waitFor();await frame.getByRole('button',{name:'下一页'}).click();assert.equal(await frame.locator('#page').innerText(),'第2页');assert.equal(await page.evaluate(()=>document.documentElement.dataset.unsafe),undefined);assert.equal(await frame.locator('body').getAttribute('data-isolated'),'yes');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'下载 HTML',exact:true}).click()]);assert.equal(download.suggestedFilename(),'导师讲义.html');
  await page.getByRole('button',{name:'编辑课件',exact:true}).click();await page.locator('#material-title').fill('修订后的课后讲义');await page.getByRole('button',{name:'保存课件',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});await page.getByRole('heading',{name:'修订后的课后讲义',exact:true}).waitFor();
  // Actual file replacement on an ended event, not just metadata editing.
  await page.getByRole('button',{name:'编辑课件',exact:true}).click();await page.locator('#material-file').setInputFiles({name:'修订讲义.html',mimeType:'text/html',buffer:Buffer.from('<html><body><h1>修订课件内容</h1></body></html>')});await page.getByRole('button',{name:'保存课件',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});assert.equal(db.raw.prepare('SELECT version FROM event_materials WHERE event_id=?').get(id).version,3);
  await page.getByRole('button',{name:'修改发起人',exact:true}).click();await page.locator('#event-host-form').waitFor();
  const options=await page.locator('#event-host-select option').allTextContents();assert.ok(options.some(s=>s.includes('新导师')));assert.ok(options.every(s=>!s.includes('仅导入用户')&&!s.includes('停用用户')));
  await page.locator('#host-search').fill('新导师');await page.locator('#event-host-select').selectOption(next.id);await page.getByRole('button',{name:'保存发起人',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});await page.locator('.detail-cover p').filter({hasText:'发起人 新导师'}).waitFor();assert.equal(db.raw.prepare('SELECT host_id FROM events WHERE id=?').get(id).host_id,next.id);
  // Ownership transfer is reflected in real sessions without changing hardware code.
  await context.addCookies([{name:'popup_city_session',value:host.token,url:origin}]);await page.reload();await page.locator('.material-card').waitFor();assert.equal(await page.getByRole('button',{name:'上传课件 ＋',exact:true}).count(),0);
  await context.addCookies([{name:'popup_city_session',value:next.token,url:origin}]);await page.reload();await page.locator('.material-card').waitFor();await page.getByRole('button',{name:'上传课件 ＋',exact:true}).waitFor();
  await page.locator('.material-preview summary').click();await page.frameLocator('.material-preview iframe').getByRole('heading',{name:'修订课件内容'}).waitFor();await page.locator('#event-materials').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/courseware-${width}.png`});
  await page.getByRole('button',{name:'删除课件',exact:true}).click();await page.getByRole('button',{name:'保留课件',exact:true}).click();assert.equal(await page.locator('.material-card').count(),1);
  await page.getByRole('button',{name:'删除课件',exact:true}).click();await page.getByRole('button',{name:'确认删除课件',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});await page.locator('#material-list .empty').waitFor();assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_materials WHERE event_id=?').get(id).n,0);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASSED: ended course upload/rename/replace/download/delete; interactive isolated HTML; registered-user host selection and ownership transfer; 375/1440px; no page errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();}
