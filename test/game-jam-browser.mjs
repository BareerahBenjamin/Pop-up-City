import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { openDatabase,migrate } from '../database.js';
import { createApplication } from '../server.js';
import { loadConfig } from '../config.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3342',out=process.env.BROWSER_OUTPUT||'/tmp/game-jam-browser';mkdirSync(out,{recursive:true});
const db=openDatabase(':memory:');migrate(db);const stamp=Math.floor(Date.now()/1000);
function actor(role,name){const id=randomUUID(),token=createHash('sha256').update(id).digest('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").run(id,id+'@example.test',name,role,stamp,stamp);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,stamp+3600,stamp);return {id,token}}
const author=actor('member','共创成员'),owner=actor('admin','审核管理员');
const server=createApplication(loadConfig({AUTH_PEPPER:'game-jam-browser-test-pepper-000000000000',PUBLIC_ORIGIN:origin}),{db,mailer:null});await new Promise(resolve=>server.listen(3342,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const memberContext=await browser.newContext({viewport:{width:1280,height:900}});await memberContext.addCookies([{name:'popup_city_session',value:author.token,url:origin}]);
 const member=await memberContext.newPage(),errors=[];member.on('pageerror',e=>errors.push(e.message));
 await member.goto(origin+'/#game-jam');await member.locator('#game-jam-form').waitFor();assert.equal(await member.locator('#jam-gallery .jam-card').count(),0);
 await member.locator('[data-action="jam-scroll"][data-target="jam-submit"]').first().click();
 for(const [name,value] of Object.entries({title:'浏览器共创作品',author:'共创团队',description:'三键互动测试',category:'互动游戏'})){const input=member.locator(`#game-jam-form [name="${name}"]`);if(name==='category')await input.selectOption(value);else await input.fill(value)}
 const manifest=JSON.stringify({contract_version:'herstory-event-v1',app_id:'browser_game',version:'1.0.0',save_quota_bytes:1024});
 await member.locator('[name="manifest"]').setInputFiles({name:'event-app.json',mimeType:'application/json',buffer:Buffer.from(manifest)});
 await member.locator('[name="firmware"]').setInputFiles({name:'browser-full.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,1,2,3])});
 await member.getByRole('button',{name:'检查并提交作品',exact:true}).click();await member.locator('#game-jam-form [role="alert"]').filter({hasText:'ESP32镜像头'}).waitFor();assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM game_jam_projects').get().n,0);
 await member.locator('[name="firmware"]').setInputFiles({name:'browser-full.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0xe9,1,2,3])});
 await member.getByRole('button',{name:'检查并提交作品',exact:true}).click();await member.locator('.notice[role="status"]').filter({hasText:'已保存'}).waitFor();assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM game_jam_projects').get().n,1);assert.equal(await member.locator('#jam-gallery .jam-card').count(),0);
 const adminContext=await browser.newContext();await adminContext.addCookies([{name:'popup_city_session',value:owner.token,url:origin}]);const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));await admin.goto(origin+'/#admin');await admin.locator('[data-action="admin-tab"][data-tab="game-jam"]').click();await admin.getByRole('button',{name:'审核并发布',exact:true}).click();await admin.locator('#game-jam-review-form [name="note"]').fill('模拟固件仅用于浏览器联调，审核流程测试。');await admin.getByRole('button',{name:'保存审核结论',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('#modal').open);assert.equal(db.raw.prepare('SELECT status FROM game_jam_projects').get().status,'published');
 await member.reload();await member.locator('#jam-gallery .jam-card h3').waitFor();await member.locator('#jam-search').fill('不存在的作品');await member.waitForFunction(()=>document.querySelectorAll('#jam-gallery .jam-card').length===0);await member.locator('#jam-search').fill('共创');await member.locator('#jam-gallery .jam-card h3').waitFor();await member.getByRole('button',{name:'随身工具',exact:true}).click();assert.equal(await member.locator('#jam-gallery .jam-card').count(),0);await member.getByRole('button',{name:'全部',exact:true}).click();await member.locator('#jam-gallery .jam-card h3').waitFor();
 await member.locator('#jam-gallery details').evaluate(e=>e.open=true);const download=member.waitForEvent('download');await member.locator('#jam-gallery a').filter({hasText:'下载完整固件'}).click();const saved=await download;assert.equal(saved.suggestedFilename(),'browser-full.bin');
 await member.locator('#jam-works').scrollIntoViewIfNeeded();await member.screenshot({path:out+'/game-jam-gallery-desktop.png'});
 await member.setViewportSize({width:375,height:812});await member.goto(origin+'/#game-jam');await member.locator('#game-jam-form').waitFor();assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await member.screenshot({path:out+'/game-jam-mobile.png'});
 await admin.setViewportSize({width:375,height:812});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:out+'/game-jam-admin-mobile.png'});
 const guest=await browser.newPage();await guest.goto(origin+'/#game-jam');await guest.locator('#jam-gallery .jam-card').waitFor();assert.equal(await guest.locator('#game-jam-form').count(),0);await guest.locator('#jam-gallery summary').click();assert.equal(await guest.getByRole('button',{name:'成员登录后下载',exact:true}).count(),1);
 assert.deepEqual(errors,[]);console.log('PASS: Game Jam uses host member, validates upload, persists pending work, admin publishes, gallery/search/categories/download/mobile/anonymous access; no real email or hardware flash.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close()}
