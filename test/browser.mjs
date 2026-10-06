// Optional browser regression: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/browser.mjs
import assert from 'node:assert/strict';
import {checkInterestFeedback} from './interest-feedback.mjs';
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { openDatabase,migrate } from '../database.js';
import { loadConfig } from '../config.js';
import { createApplication } from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const db=openDatabase(':memory:');migrate(db);
const origin='http://127.0.0.1:3331',now=Math.floor(Date.now()/1000),out=process.env.BROWSER_OUTPUT||'/tmp/popup-browser-check';mkdirSync(out,{recursive:true});
const config=loadConfig({AUTH_PEPPER:'test-browser-pepper-00000000000000000000',PUBLIC_ORIGIN:origin,FROM_EMAIL:'info@0xherstory.cn'});
function member(nickname,role,superAdmin=0){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,is_super_admin,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?)").run(id,`${id}@example.test`,nickname,role,superAdmin,now,now);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,now+3600,now);return {id,token}}
const owner=member('超级管理员','admin',1),neighbor=member('测试邻居','member');
const eventIds=[];for(const [index,start] of [now+7200,now+3600,now-600].entries()){const id=randomUUID();eventIds.push(id);db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,10,2,?,'published',?,?)").run(id,['一起动手做陶器','早一点相遇','已经开始的活动'][index],'一次开放的共创体验。欢迎带上好奇心，和邻居一起分享、学习。','共创','景德镇 · Herstory 共同空间',start,start+3600,owner.id,now,now)}
const server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3331,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/Los_Angeles'});await context.addCookies([{name:'popup_city_session',value:owner.token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin);await page.locator('#calendar-title').waitFor();
 for(const count of [1,3,7]){await page.locator(`[data-action="calendar-view"][data-days="${count}"]`).click();await page.waitForFunction(n=>document.querySelectorAll('.calendar-day').length===n,count)}
 for(const id of eventIds.slice(0,2))await page.locator(`.event-card [data-action="toggle-interest"][data-id="${id}"]`).click();
 await page.waitForFunction(()=>document.querySelectorAll('.agenda-list li').length===2);assert.deepEqual(await page.locator('.agenda-list a').allTextContents(),['早一点相遇','一起动手做陶器']);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.agenda-list li').length===2);
 // Future interests appear immediately above the calendar, including on another device timezone.
 const futureId=randomUUID();db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,12,?,'published',?,?)").run(futureId,'三天后的相遇','未来活动测试','学习','共创空间',now+3*86400,now+3*86400+3600,owner.id,now,now);
 await page.reload();const heart=page.locator(`.event-card [data-id="${futureId}"]`);await heart.click();await page.locator(`.upcoming-agenda a[href="#event/${futureId}"]`).waitFor();assert.equal(new URL(page.url()).hash,'');
 await page.reload();await page.locator(`.upcoming-agenda a[href="#event/${futureId}"]`).waitFor();await page.locator(`.upcoming-agenda [data-id="${futureId}"]`).click();await page.waitForFunction(id=>!document.querySelector(`.upcoming-agenda a[href="#event/${id}"]`),futureId);
 await page.locator('#calendar-title').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/calendar-desktop.png`});
 await page.goto(`${origin}/#me`);await page.getByRole('button',{name:'设置头像与资料',exact:true}).click();await page.waitForFunction(()=>avatarEditor?.ready);
 await page.locator('[data-action="avatar-layer"][data-id="hst_layer_hoodie"]').click();await page.locator('[data-action="avatar-choice"][data-id="hst_ast_0051"]').click();await page.waitForFunction(()=>avatarEditor?.ready);
 await page.locator('[data-action="avatar-layer"][data-id="hst_layer_body"]').click();
 await page.evaluate(()=>{for(const id of ['hst_ast_0020','hst_ast_0031','hst_ast_0033'])document.querySelector(`[data-action="avatar-choice"][data-id="${id}"]`).click()});
 await page.waitForFunction(()=>avatarEditor?.ready&&avatarEditor.selection.hst_layer_body==='hst_ast_0033');
 const selection=await page.evaluate(()=>({...avatarEditor.selection}));assert.equal(selection.hst_layer_hoodie,'hst_ast_0052');
 const before=await page.locator('#avatar-preview').evaluate(c=>c.toDataURL());
 const expected=await page.evaluate(()=>avatarData({release:catalog.release,selection:{...avatarEditor.selection}}));assert.equal(before,expected);
 await page.screenshot({path:`${out}/avatar-desktop.png`});
 // Finish the one-time combined setup; avatar re-editing is intentionally unavailable afterward.
 await page.getByRole('button',{name:'下一步：填写资料',exact:true}).click();
 await page.getByRole('button',{name:'确认头像并保存资料',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#modal').open);await page.reload();
 await page.locator('.profile-head .avatar img').waitFor();assert.equal(await page.locator('.profile-head .avatar img').getAttribute('src'),before);
 assert.equal(await page.locator('[data-action="edit-avatar"]').count(),0);
 await page.goto(`${origin}/#admin`);await page.locator(`[data-action="set-member-role"][data-id="${neighbor.id}"]`).click();await page.waitForFunction(id=>state.adminMembers.find(m=>m.id===id)?.role==='admin',neighbor.id);
 const otherContext=await browser.newContext();await otherContext.addCookies([{name:'popup_city_session',value:neighbor.token,url:origin}]);const other=await otherContext.newPage();await other.goto(`${origin}/#admin`);await other.getByRole('heading',{name:'让每一位成员顺利加入。'}).waitFor();assert.equal(await other.locator('[data-action="set-member-role"]').count(),0);
 await page.locator(`[data-action="set-member-role"][data-id="${neighbor.id}"]`).click();await page.waitForFunction(id=>state.adminMembers.find(m=>m.id===id)?.role==='member',neighbor.id);
 await page.goto(`${origin}/#event/${eventIds[0]}`);await page.getByRole('button',{name:'生成分享海报',exact:true}).click();await page.waitForFunction(()=>Boolean(posterBlob));
 const withoutQR=await page.locator('#event-poster').evaluate(c=>c.toDataURL());await page.locator('#poster-qr').check();await page.waitForFunction(()=>Boolean(posterBlob));assert.notEqual(await page.locator('#event-poster').evaluate(c=>c.toDataURL()),withoutQR);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载海报 PNG',exact:true}).click();await(await download).saveAs(`${out}/poster.png`);
 await page.screenshot({path:`${out}/poster-desktop.png`});await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await page.setViewportSize({width:375,height:812});await page.goto(origin);await page.locator('#calendar-title').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await page.locator('.card-body .meta').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
 await page.locator('#calendar-title').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/calendar-mobile.png`});
 await page.goto(`${origin}/#me`);await page.locator('.profile-lock-note').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${out}/avatar-mobile.png`});
 await page.goto(origin);await page.locator('.event-card').first().scrollIntoViewIfNeeded();
 const card=page.locator('.event-card').first();const box=await card.boundingBox(),heartBox=await card.locator('.interest-heart').boundingBox();assert.ok(heartBox.y>=box.y&&heartBox.y+heartBox.height<=box.y+box.height);
 const hostBox=await card.locator('.host').boundingBox();assert.ok(box.y+box.height-hostBox.y-hostBox.height<30);await page.screenshot({path:`${out}/event-card-mobile.png`});
 await page.goto(`${origin}/#event/${eventIds[0]}`);await page.locator('.detail-cover').waitFor();assert.ok((await page.locator('.detail-cover').boundingBox()).height<240);await page.screenshot({path:`${out}/event-detail-mobile.png`});
 await page.goto(`${origin}/#admin`);await page.locator('[data-action="admin-tab"][data-tab="events"]').click();await page.getByRole('button',{name:'批量添加活动',exact:true}).click();
 const futureDate=new Date((now+5*86400)*1000+8*3600000).toISOString().slice(0,10);
 await page.locator('#bulk-rows').fill(`批量前端一\t${futureDate} 10:00\t${futureDate} 12:00\t空间\t说明\t学习\t12\t0\n批量前端二\t${futureDate} 14:00\t${futureDate} 16:00\t空间\t说明\t创作\t20\t2`);
 await page.getByRole('button',{name:'检查并预览',exact:true}).click();await page.locator('#bulk-commit:not([hidden])').waitFor();assert.equal(await page.locator('#bulk-preview tbody tr').count(),2);
 await page.locator('#bulk-official').check();assert.equal(await page.locator('#bulk-commit').isHidden(),true);
 await page.getByRole('button',{name:'检查并预览',exact:true}).click();await page.locator('#bulk-commit:not([hidden])').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${out}/bulk-preview-mobile.png`});
 await page.locator('#bulk-commit').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM events WHERE title LIKE '批量前端%' AND official=1").get().n,2);
 // Creating an activity immediately offers its poster; cover-free creation remains supported.
 await page.goto(origin);await page.getByRole('button',{name:'发起一个活动 ＋',exact:true}).click();await page.locator('[name="title"]').fill('新活动海报流程');await page.locator('[name="start"]').fill('2026-10-20T10:00');await page.locator('[name="end"]').fill('2026-10-20T12:00');await page.locator('[name="location"]').fill('测试空间');await page.locator('#event-form [name="description"]').fill('测试说明');await page.getByRole('button',{name:'提交活动',exact:true}).click();await page.locator('#event-poster').waitFor();await page.waitForFunction(()=>Boolean(posterBlob));
 assert.equal(db.raw.prepare('SELECT starts_at FROM events WHERE title=?').get('新活动海报流程').starts_at,Date.parse('2026-10-20T10:00:00+08:00')/1000);assert.deepEqual(errors,[]);await checkInterestFeedback({browser,origin,db,member:neighbor,now,out});console.log('PASSED: browser avatar/rapid switching/one-time finalization/persistence, role delegation, day/3-day/week calendar, interests, poster/QR/download, create-to-poster, 375px layout.');console.log(`Screenshots: ${out}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close()}
