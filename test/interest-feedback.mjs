import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function checkInterestFeedback({browser,origin,db,member,now,out}) {
 const id=randomUUID(),futureId=randomUUID();
 const insert=(key,title,start)=>db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,12,?,'published',?,?)").run(key,title,'带着好奇心一起试试。','学习','景德镇 · 共同空间的长地点名称',start,start+3600,member.id,now,now);
 insert(id,'一起认识新的创作工具',now+3600);insert(futureId,'三天后一起动手做点新东西',now+3*86400);
 const context=await browser.newContext({viewport:{width:375,height:900},timezoneId:'America/Los_Angeles'});
 await context.addCookies([{name:'popup_city_session',value:member.token,url:origin}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const card=key=>page.locator(`[data-interest-surface="card:${key}"]`);
 const heart=key=>card(key).locator('.interest-heart');
 const confirmed=key=>card(key).locator('.interest-confirmation');
 const writeUrl=`**/api/events/${id}/interest`;
 const waitSelected=async(key,value)=>page.waitForFunction(({key,value})=>Boolean(state.events.find(e=>e.id===key)?.my_interested)===value&&!interestOperations.has(key),{key,value});
 const load=async()=>{await page.goto(origin);await page.locator('#calendar-title').waitFor();};
 let writes=0;page.on('request',r=>{if(r.url().endsWith(`/${id}/interest`))writes++;});
 try {
  await load();
  await card(id).evaluate(e=>e.scrollIntoView({block:'start'}));
  const before=(await card(id).boundingBox()).y;
  await heart(id).click();await waitSelected(id,true);
  assert.ok(Math.abs((await card(id).boundingBox()).y-before)<4,'bookmark preserves card position');
  assert.match(await confirmed(id).innerText(),/已收藏 · .*月.*日.*\d{2}:\d{2}/);
  assert.equal(await card(id).locator('.interest-note').innerText(),'感兴趣不等于报名');
  assert.equal(await page.locator('.card-link [data-action="view-interest-agenda"]').count(),0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_registrations WHERE event_id=?').get(id).n,0);
  await card(id).screenshot({path:`${out}/interest-confirmed-mobile.png`});
  await card(id).getByRole('button',{name:'查看我的安排 →',exact:true}).click();
  await page.waitForFunction(id=>document.activeElement?.getAttribute('href')===`#event/${id}`,id);
  assert.equal(await page.locator(`#interest-agenda-${id}`).getAttribute('class'),'agenda-highlight');
  await page.screenshot({path:`${out}/interest-agenda-mobile.png`});
  // A periodic re-render must not replay the navigation.
  await page.evaluate(async()=>{window.scrollTo(0,0);await render()});
  assert.equal(await page.evaluate(()=>scrollY),0);
  await page.goto(`${origin}/#event/${id}`);await page.locator('.detail .interest-confirmation').waitFor();
  await page.getByRole('button',{name:'查看我的安排 →',exact:true}).click();
  await page.waitForFunction(id=>state.route==='events'&&document.activeElement?.getAttribute('href')===`#event/${id}`,id);
  assert.ok((await page.locator(`#interest-agenda-${id}`).boundingBox()).y<900);
  await page.reload();await confirmed(id).waitFor();
  // Future bookmarks target the future group, including in a different device timezone.
  await heart(futureId).click();await waitSelected(futureId,true);
  await card(futureId).getByRole('button',{name:'查看我的安排 →',exact:true}).click();
  assert.equal(await page.locator(`.upcoming-agenda #interest-agenda-${futureId}.agenda-highlight`).count(),1);
  await page.locator(`#interest-agenda-${futureId} .interest-heart`).click();await waitSelected(futureId,false);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'today-title');
  // Cancelling a bookmark must not cancel attendance.
  db.raw.prepare("INSERT INTO event_registrations(event_id,member_id,kind,created_at) VALUES(?,?,'attendee',?)").run(id,member.id,now);
  await page.reload();await confirmed(id).waitFor();
  assert.equal(await card(id).locator('.interest-note').innerText(),'已报名');
  await heart(id).click();await waitSelected(id,false);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_registrations WHERE event_id=? AND member_id=?').get(id,member.id).n,1);
  // Rejected writes show local errors and leave the old selection unchanged.
  await page.route(writeUrl,r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'活动已开始或未开放，不能再添加感兴趣'})}));
  await heart(id).click();await card(id).locator('.interest-error').waitFor();
  assert.equal(await heart(id).getAttribute('aria-pressed'),'false');assert.equal(await confirmed(id).count(),0);
  await page.unroute(writeUrl);await card(id).getByRole('button',{name:'重试',exact:true}).click();await waitSelected(id,true);
  await heart(id).click();await waitSelected(id,false);
  // All copies become busy, and repeated calls cannot issue duplicate requests.
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route(writeUrl,async r=>{await gate;await r.continue()});
  const initialWrites=writes;await heart(id).click();
  await page.waitForFunction(id=>interestOperations.get(id)?.phase==='pending',id);
  assert.ok(await page.locator(`[data-action="toggle-interest"][data-id="${id}"]`).evaluateAll(es=>es.every(e=>e.getAttribute('aria-busy')==='true')));
  await page.evaluate(id=>{for(const e of document.querySelectorAll(`[data-action="toggle-interest"][data-id="${id}"]`))e.click()},id);
  release();await waitSelected(id,true);assert.equal(writes-initialWrites,1);await page.unroute(writeUrl);
  await heart(id).click();await waitSelected(id,false);
  // Server accepted the bookmark, but its follow-up read failed. Retry reads, never toggles.
  await page.route('**/api/events',r=>r.abort('failed'));
  const beforeUncertain=writes;await heart(id).click();await card(id).getByRole('button',{name:'重新同步',exact:true}).waitFor();
  assert.match(await card(id).locator('.interest-error').innerText(),/操作已提交/);
  assert.equal(await confirmed(id).count(),0);
  await page.evaluate(id=>document.querySelector(`[data-interest-surface="card:${id}"] .interest-heart`).click(),id);
  await page.unroute('**/api/events');await card(id).getByRole('button',{name:'重新同步',exact:true}).click();await waitSelected(id,true);
  assert.equal(writes-beforeUncertain,1);
  // A late response must not change the route or drag the reader back to an activity.
  let releaseLate;const late=new Promise(resolve=>releaseLate=resolve);
  await page.route(writeUrl,async r=>{await late;await r.continue()});
  await heart(id).click();await page.locator('nav a[href="#tasks"]').click();await page.waitForFunction(()=>state.route==='tasks');
  releaseLate();await waitSelected(id,false);assert.equal(new URL(page.url()).hash,'#tasks');await page.unroute(writeUrl);
  await load();await heart(id).click();await waitSelected(id,true);
  // Visual/size checks include ordinary member navigation, dense calendar and detail.
  for(const width of [320,375,768,1440]){
   await page.setViewportSize({width,height:900});await card(id).scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(await card(id).locator('.interest-confirmation').evaluate(e=>getComputedStyle(e).fontSize),'18px');
   await card(id).screenshot({path:`${out}/interest-card-${width}.png`});
  }
  await page.locator('[data-action="calendar-view"][data-days="7"]').click();
  assert.ok(await page.locator('.calendar-event').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth)));
  await page.goto(`${origin}/#event/${id}`);await page.locator('.detail .interest-confirmation').waitFor();
  await page.screenshot({path:`${out}/interest-detail-desktop.png`});
  db.raw.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(id);
  await load();await confirmed(id).waitFor();assert.match(await card(id).locator('.interest-note').innerText(),/已取消/);
  assert.equal(await card(id).locator('[data-action="view-interest-agenda"]').count(),0);
  await heart(id).click();await waitSelected(id,false);assert.equal(await heart(id).isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASSED: interest inline feedback, viewport/focus, future/detail navigation, attendance independence, failure/retry/read recovery, duplicate clicks, late navigation, 320–1440px layouts.');
 }finally{await context.close();db.raw.prepare('DELETE FROM event_registrations WHERE event_id IN (?,?)').run(id,futureId);db.raw.prepare('DELETE FROM event_interests WHERE event_id IN (?,?)').run(id,futureId);db.raw.prepare('DELETE FROM events WHERE id IN (?,?)').run(id,futureId);}
}
