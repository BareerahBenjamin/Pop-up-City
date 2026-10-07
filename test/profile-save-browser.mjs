import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3337',db=openDatabase(':memory:');migrate(db);
const stamp=Math.floor(Date.now()/1000),actors=[];
for(const name of ['新成员','另一个成员']){const id=randomUUID(),token=randomBytes(32).toString('hex');db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(id,id+'@example.test',name,stamp,stamp);db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,stamp+3600,stamp);actors.push({id,token})}
const config=loadConfig({AUTH_PEPPER:'profile-save-browser-test-pepper-00000000000',PUBLIC_ORIGIN:origin});const server=createApplication(config,{db,mailer:null});await new Promise(resolve=>server.listen(3337,'127.0.0.1',resolve));
const out=process.env.BROWSER_OUTPUT||'/tmp/herstory-profile-save-browser';mkdirSync(out,{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:375,height:812}});await context.addCookies([{name:'popup_city_session',value:actors[0].token,url:origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/#setup');await page.locator('#profile-setup-form').waitFor();
 for(const [key,value] of Object.entries({nickname:'Rae',bio:'hihi',skills:'睡觉',needs:'睡觉的地方'}))await page.locator(`#profile-setup-form [name=${key}]`).fill(value);
 await page.locator('#profile-setup-form [name=card_public]').check();
 await page.reload();await page.locator('#profile-setup-form').waitFor();assert.equal(await page.locator('#profile-setup-form [name=skills]').inputValue(),'睡觉');
 async function finalForm(){await page.getByRole('button',{name:'下一步：设置头像',exact:true}).click();await page.waitForFunction(()=>avatarEditor?.ready);await page.getByRole('button',{name:'下一步：确认资料',exact:true}).click();await page.locator('#profile-form').waitFor()}
 await finalForm();const draftAvatar=await page.evaluate(()=>JSON.stringify(setupDraft.avatar));
 // Total outage: remain on setup, preserve text and avatar draft, never claim success.
 await page.route(origin+'/api/me',route=>route.abort('connectionclosed'));
 await page.getByRole('button',{name:'确认头像并保存资料',exact:true}).click();await page.locator('#profile-form [role=alert]').filter({hasText:'网络连接中断'}).waitFor();
 assert.equal(db.raw.prepare('SELECT profile_completed_at FROM members WHERE id=?').get(actors[0].id).profile_completed_at,null);assert.equal(new URL(page.url()).hash,'#setup');assert.equal(await page.locator('#profile-form [name=nickname]').inputValue(),'Rae');assert.equal(await page.getByRole('button',{name:'确认头像并保存资料',exact:true}).isEnabled(),true);assert.equal(await page.evaluate(()=>JSON.stringify(setupDraft.avatar)),draftAvatar);await page.screenshot({path:out+'/profile-outage-draft-preserved.png'});
 await page.unroute(origin+'/api/me');await page.reload();await page.locator('#profile-setup-form').waitFor();assert.equal(await page.locator('#profile-setup-form [name=nickname]').inputValue(),'Rae');assert.equal(await page.evaluate(()=>JSON.stringify(setupDraft.avatar)),draftAvatar);await finalForm();
 // Write succeeds but response is lost, and unrelated list refresh fails: still enter next step.
 let patches=0;await page.route(origin+'/api/me',async route=>{if(route.request().method()==='PATCH'){patches++;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('connectionclosed')}else await route.continue()});await page.route(origin+'/api/events',route=>route.abort('connectionclosed'));
 await page.getByRole('button',{name:'确认头像并保存资料',exact:true}).click();await page.waitForURL('**/#planet/welcome');await page.locator('#planet-frame').waitFor();assert.equal(patches,1);assert.ok(db.raw.prepare('SELECT profile_completed_at FROM members WHERE id=?').get(actors[0].id).profile_completed_at);assert.equal(await page.evaluate(()=>state.me.nickname),'Rae');assert.equal(await page.evaluate(()=>sessionStorage.getItem(profileDraftKey(state.me.id))),null);await page.screenshot({path:out+'/profile-recovered-next-step.png'});
 await page.unroute(origin+'/api/me');await page.unroute(origin+'/api/events');await page.goto(origin+'/#me');await page.locator('.profile-lock-note').waitFor();
 const savedAvatar=db.raw.prepare('SELECT avatar_json FROM members WHERE id=?').get(actors[0].id).avatar_json;
 await page.getByRole('button',{name:'编辑个人资料',exact:true}).click();await page.locator('#profile-form [name=bio]').fill('资料仍可修改');await page.route(origin+'/api/me',async route=>{if(route.request().method()==='GET')await route.abort('connectionclosed');else await route.continue()});
 await page.getByRole('button',{name:'保存资料',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);assert.equal(db.raw.prepare('SELECT bio FROM members WHERE id=?').get(actors[0].id).bio,'资料仍可修改');assert.equal(await page.evaluate(()=>state.me.id),actors[0].id);assert.equal(await page.evaluate(()=>state.me.bio),'资料仍可修改');assert.equal(db.raw.prepare('SELECT avatar_json FROM members WHERE id=?').get(actors[0].id).avatar_json,savedAvatar);await page.unroute(origin+'/api/me');
 // A stale profile form cannot update a newly signed-in account.
 await page.getByRole('button',{name:'编辑个人资料',exact:true}).click();await page.locator('#profile-form [name=nickname]').fill('不应保存到另一个账号');await context.addCookies([{name:'popup_city_session',value:actors[1].token,url:origin}]);await page.getByRole('button',{name:'保存资料',exact:true}).click();await page.locator('#profile-form [role=alert]').filter({hasText:'登录账号已改变'}).waitFor();assert.equal(db.raw.prepare('SELECT nickname FROM members WHERE id=?').get(actors[1].id).nickname,'另一个成员');
 await page.goto(origin+'/#setup');await page.reload();await page.locator('#profile-setup-form').waitFor();assert.equal(await page.locator('#profile-setup-form [name=nickname]').inputValue(),'另一个成员');assert.equal(await page.evaluate(()=>setupDraft?.avatar||null),null);
 assert.deepEqual(errors,[]);console.log('PASS: outage preserves draft, reload restores own draft, lost committed response recovers without duplicate write, next step survives unrelated refresh failure, profile edits preserve avatar, switched account protected.');await context.close();
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close()}
