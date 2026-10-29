// Disposable local fixtures only; no production database or hardware is used.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import sharp from 'sharp';
import {openDatabase,migrate} from '../database.js';
import {loadConfig} from '../config.js';
import {createApplication} from '../server.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3364',out=process.env.BROWSER_OUTPUT||'/tmp/popup-planet-report-photo';mkdirSync(out,{recursive:true});
const db=openDatabase(':memory:');migrate(db);
const now=Math.floor(Date.now()/1000),owner=randomUUID(),token=randomBytes(32).toString('hex');
db.raw.prepare("INSERT INTO members(id,email,nickname,status,created_at,updated_at) VALUES(?,?,'星球预览邻居','active',?,?)").run(owner,owner+'@example.test',now,now);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),owner,now+3600,now);
const config=loadConfig({PORT:'3364',PUBLIC_ORIGIN:origin,AUTH_PEPPER:randomBytes(32).toString('hex')}),server=createApplication(config,{db,mailer:null});
await new Promise(resolve=>server.listen(3364,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader']});
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'America/Los_Angeles'});
  await context.addCookies([{name:'popup_city_session',value:token,url:origin}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-30T23:59:59+08:00'));
  await page.goto(origin+'/#planet');
  await page.waitForFunction(()=>document.querySelector('#planet-loading')?.hidden&&document.querySelector('#planet-frame')?.contentWindow?.HerstoryPhoto?.config.day===12);
  const frame=page.frameLocator('#planet-frame'),body=frame.locator('body');
  const initial=await body.evaluate(()=>window.HerstoryApp.getState().snapshot);
  await body.evaluate(()=>{window.photoText=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.photoText.push(String(text));return original.call(this,text,...args);};});
  async function photo(day){
   await frame.getByRole('button',{name:'相机',exact:true}).click();
   await frame.locator('#card-preview').waitFor({state:'visible'});
   const downloading=page.waitForEvent('download');await frame.locator('#save-card').click();const file=await downloading;
   assert.match(file.suggestedFilename(),new RegExp('-DAY'+day+'-202610'+(day===12?'30':'31')+'\\.jpg$'));
   const path=out+'/'+width+'-'+file.suggestedFilename();await file.saveAs(path);
   const image=await sharp(path).metadata();assert.equal(image.width,1080);assert.equal(image.height,1440);
   const text=await body.evaluate(()=>window.photoText.join(''));assert.ok(text.includes('DAY '+day));assert.ok(text.includes('HERSTORY DAY '+day));
   await frame.locator('#close-card').click();await page.waitForFunction(()=>!document.querySelector('#planet-frame').contentWindow.history.state?.herstoryOverlay);
  }
  await photo(12);
  // The same page remains open across Shanghai midnight while the browser uses LA time.
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:01+08:00'));await photo(13);
  await page.getByRole('button',{name:'星球报告',exact:true}).click();
  await frame.getByRole('button',{name:'查看首周回顾',exact:true}).click();
  await frame.locator('img.report-planet').waitFor({state:'visible'});
  assert.equal(await frame.locator('.report-missing').count(),0);
  assert.match(await frame.locator('.report-copy').innerText(),/当前星球.*2026\/10\/31 00:00/);
  const report=await body.evaluate(()=>{const r=window.HerstoryReports.getReport('week');return{source:r.snapshot.source,cutoff:r.cutoff,finalized:r.finalized,freezeEligible:r.freezeEligible,width:document.querySelector('img.report-planet').naturalWidth};});
  assert.equal(report.source,'current');assert.equal(report.cutoff,'2026-10-25T16:00:00.000Z');assert.equal(report.finalized,false);assert.equal(report.freezeEligible,false);assert.equal(report.width,1080);
  await frame.getByRole('button',{name:'保存星球与回顾',exact:true}).waitFor();
  await page.screenshot({path:out+'/report-'+width+'.png'});
  await frame.getByRole('button',{name:'保存星球与回顾',exact:true}).scrollIntoViewIfNeeded();
  const downloading=page.waitForEvent('download');await frame.getByRole('button',{name:'保存星球与回顾',exact:true}).click();
  const file=await downloading;assert.match(file.suggestedFilename(),/首周回顾.*\.png$/);await file.saveAs(out+'/'+width+'-'+file.suggestedFilename());
  const text=await body.evaluate(()=>window.photoText);assert.ok(text.some(t=>t.includes('当前星球')));assert.ok(text.some(t=>t.includes('2026/10/31')));
  assert.ok(await frame.locator('html').evaluate(e=>e.scrollWidth<=innerWidth));
  await frame.locator('#close-reports').click();
  await page.clock.setFixedTime(new Date('2026-10-31T01:30:00+08:00'));
  await page.getByRole('button',{name:'星球报告',exact:true}).click();await frame.getByRole('button',{name:'查看首周回顾',exact:true}).click();
  assert.match(await frame.locator('.report-copy').innerText(),/2026\/10\/31 01:30/);
  await frame.locator('#close-reports').click();
  // A failed capture must leave the real statistics readable and disable image export.
  await body.evaluate(()=>{window.stellarScene.capturePhoto=()=>{throw Error('capture unavailable');};});
  await page.getByRole('button',{name:'星球报告',exact:true}).click();await frame.getByRole('button',{name:'查看首周回顾',exact:true}).click();
  assert.equal(await frame.locator('.report-missing').count(),1);assert.equal(await frame.getByRole('button',{name:'保存星球与回顾',exact:true}).isDisabled(),true);
  const final=await body.evaluate(()=>window.HerstoryApp.getState().snapshot);assert.equal(final.day,initial.day);assert.deepEqual(final.growth,initial.growth);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: current planet in first-week report and exported PNG; dated captures refresh on reopen; failed capture preserves records; DAY12→DAY13 across Shanghai midnight in LA browser; real JPEG labels and names; unchanged runtime growth; 375/1440px.');
 console.log(out);
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
