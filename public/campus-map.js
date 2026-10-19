'use strict';
// Normalized image coordinates, based on the user-provided illustrated site plan.
const campusPlaces=[
  {id:'welcome',name:'迎新点',label:'从这里认识 Herstory',type:'arrival',number:'01',x:59,y:68,description:'抵达后，先到迎新点与大家见面，再前往 B 栋办理入住。',aliases:/迎新|接待点/},
  {id:'b',name:'B栋 · 办理入住',label:'先安顿下来',type:'arrival',number:'02',x:36,y:54,description:'入住办理位于 B 栋。带上你的行李，从迎新点跟随现场指引前往。',aliases:/B\s*栋|Ｂ栋|办理入住/i},
  {id:'c',name:'C栋 · 居住区',label:'在城市里，有个小小的家',type:'living',number:'03',x:25,y:29,description:'C 栋是居住区。二楼设有洗衣房与公开活动区，参加活动请留意具体楼层。',aliases:/C\s*栋|Ｃ栋|居住区/i},
  {id:'shared',name:'C栋2层 · 公共活动区',label:'洗衣，也可以遇见新朋友',type:'activity',number:'04',x:35,y:37,description:'C 栋二楼为洗衣房与公开活动区。实际开放安排以现场通知为准。',aliases:/洗衣房|公开活动区|公共活动区/},
  {id:'e',name:'E栋2层 · 课程教室',label:'把好奇心带进教室',type:'activity',number:'05',x:59,y:24,description:'课程教室位于 E 栋二楼。查看下方已发布活动，提前确认开始时间与课程地点。',aliases:/E\s*栋|Ｅ栋|课程教室/i},
  {id:'taxi',name:'cue-D · 打车定位',label:'下一次相遇，从抵达开始',type:'arrival',number:'06',x:85,y:59,description:'打车时可参考图中 cue-D 定位点。到达珠山大道一侧后，沿现场指引前往迎新点。',aliases:/cue[\s-]*D|打车|上车点/i}
];
let campusView={selected:'welcome',filter:'all',scale:1,x:0,y:0};
let campusDrag=null;
function campusPlaceFor(event){
  // More specific floor names take priority over building names. No fuzzy geocoding.
  return [campusPlaces[3],campusPlaces[4],...campusPlaces.filter(p=>!['shared','e'].includes(p.id))].find(p=>p.aliases.test(event.location||''))||null;
}
function campusEvents(place){return state.events.filter(e=>e.status==='published'&&campusPlaceFor(e)?.id===place.id).sort((a,b)=>a.starts_at-b.starts_at||a.id.localeCompare(b.id));}
function campusPointDetails(place){
  const events=campusEvents(place),upcoming=events.filter(e=>e.status==='published'&&e.ends_at>Date.now()/1000);
  return `<div class="campus-detail-head"><span class="campus-place-number">${place.number}</span><span class="eyebrow">YOU ARE EXPLORING</span></div><h2 id="campus-detail-title" tabindex="-1">${place.name}</h2><p class="campus-detail-tagline">${place.label}</p><p>${place.description}</p><div class="campus-events-heading"><h3>这里的活动</h3><span>${upcoming.length} 场待相遇</span></div>${events.length?`<ol class="campus-event-list">${events.map(e=>`<li><span class="eyebrow">${dayHeading(eventDay(e.starts_at))} · ${eventClock(e.starts_at)}</span><a href="#event/${esc(e.id)}">${esc(e.title)} ↗</a><p>${esc(e.location)} · ${esc(eventTimeLabel(e))}</p></li>`).join('')}</ol>`:'<p class="campus-no-events">还没有在此地点发布的活动。<br>来看看其他地方正在发生什么。</p>'}<button type="button" class="btn light" data-action="city-jump" data-target="calendar-title">查看完整活动日历 ↑</button>`;
}
function campusMapSection(){
  const visible=campusPlaces.filter(p=>campusView.filter==='all'||p.type===campusView.filter);
  if(!visible.some(p=>p.id===campusView.selected))campusView.selected=visible[0].id;
  const selected=campusPlaces.find(p=>p.id===campusView.selected);
  return `<section id="campus-map" class="campus-map-section" aria-labelledby="campus-map-title"><div class="campus-heading"><div><span class="eyebrow">AROUND YOU / POP-UP CITY</span><h2 id="campus-map-title" tabindex="-1">Herstory 生活地图</h2><p>景德镇 · 珠山大道</p></div><div class="campus-filters" role="group" aria-label="筛选地图地点">${[['all','全部地点'],['arrival','抵达与入住'],['living','居住'],['activity','活动空间']].map(([key,name])=>`<button class="filter ${campusView.filter===key?'selected':''}" type="button" data-action="campus-filter" data-filter="${key}" aria-pressed="${campusView.filter===key}">${name}</button>`).join('')}</div></div><div class="campus-layout"><section class="campus-map-panel" aria-label="可交互园区地图"><div class="campus-map-toolbar"><span>点击编号，发现一个地方</span><div class="campus-zoom" role="group" aria-label="地图缩放"><button type="button" class="icon-button" data-action="campus-zoom-out" aria-label="缩小地图" ${campusView.scale<=1?'disabled':''}>−</button><output id="campus-scale" aria-live="polite">${Math.round(campusView.scale*100)}%</output><button type="button" class="icon-button" data-action="campus-zoom-in" aria-label="放大地图" ${campusView.scale>=2.5?'disabled':''}>＋</button><button type="button" class="text-button" data-action="campus-reset">复位</button></div></div><div id="campus-viewport" class="campus-viewport ${campusView.scale>1?'is-zoomed':''}" tabindex="0" role="region" aria-label="园区插画地图，放大后可拖动或使用方向键移动" aria-describedby="campus-map-help"><div id="campus-canvas" class="campus-canvas" style="transform:translate(${campusView.x}px,${campusView.y}px) scale(${campusView.scale})"><img class="campus-map-image" src="/assets/campus/herstory-campus.jpg" alt="Herstory园区示意图：C栋居住区及二楼公共活动区在左上，E栋二楼课程教室在上方，B栋入住办理在左侧，迎新点在下方中央，cue-D打车定位点在右侧。陶邑潮生酒店不是入住楼。" width="1448" height="1086" draggable="false">${visible.map(p=>`<button type="button" class="campus-marker ${p.id===selected.id?'is-selected':''}" style="left:${p.x}%;top:${p.y}%" data-action="campus-place" data-place="${p.id}" aria-label="${p.name}，查看地点及活动" aria-pressed="${p.id===selected.id}" title="${p.name}"><span>${p.number}</span></button>`).join('')}</div></div><div class="campus-map-caption"><p id="campus-map-help">${campusView.scale>1?'拖动地图或用方向键移动 · 点击编号查看详情':'可放大查看细节 · 点击地图编号选择地点'}</p></div></section><aside id="campus-detail" class="campus-detail" aria-labelledby="campus-detail-title" aria-live="polite">${campusPointDetails(selected)}</aside></div></section>`;
}
function syncCampusTransform(){
  const canvas=document.querySelector('#campus-canvas'),viewport=document.querySelector('#campus-viewport');if(!canvas||!viewport)return;
  const bounds=viewport.getBoundingClientRect(),maxX=bounds.width*(campusView.scale-1)/2,maxY=bounds.height*(campusView.scale-1)/2;
  campusView.x=Math.max(-maxX,Math.min(maxX,campusView.x));campusView.y=Math.max(-maxY,Math.min(maxY,campusView.y));
  canvas.style.transform=`translate(${campusView.x}px,${campusView.y}px) scale(${campusView.scale})`;
}
function mountCampusMap(){
  campusDrag=null;
  const viewport=document.querySelector('#campus-viewport');if(!viewport)return;
  syncCampusTransform();
  viewport.addEventListener('pointerdown',event=>{
    if(campusView.scale<=1||event.button!==0||event.target.closest('button'))return;
    campusDrag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:campusView.x,y:campusView.y};
    viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove',event=>{
    if(!campusDrag||campusDrag.id!==event.pointerId)return;
    campusView.x=campusDrag.x+event.clientX-campusDrag.startX;campusView.y=campusDrag.y+event.clientY-campusDrag.startY;syncCampusTransform();
  });
  const stop=()=>{campusDrag=null;viewport.classList.remove('is-dragging');};
  viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);viewport.addEventListener('lostpointercapture',stop);
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport||campusView.scale<=1||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[event.key];campusView.x+=delta[0];campusView.y+=delta[1];syncCampusTransform();
  });
}
window.addEventListener('resize',()=>{if(state.route==='events')syncCampusTransform();});
async function handleCampusAction(button){
  const action=button.dataset.action;if(!action.startsWith('campus-'))return false;
  const place=campusPlaces.find(p=>p.id===button.dataset.place);
  if(action==='campus-place'&&place){campusView.selected=place.id;}
  else if(action==='campus-filter'&&['all','arrival','living','activity'].includes(button.dataset.filter)){campusView.filter=button.dataset.filter;}
  else if(action==='campus-zoom-in')campusView.scale=Math.min(2.5,Number((campusView.scale+.25).toFixed(2)));
  else if(action==='campus-zoom-out')campusView.scale=Math.max(1,Number((campusView.scale-.25).toFixed(2)));
  else if(action==='campus-reset'){campusView.scale=1;campusView.x=0;campusView.y=0;}
  const section=document.querySelector('#campus-map');
  if(section){section.outerHTML=campusMapSection();mountCampusMap();}else await render();
  if(action==='campus-place'&&place){
    document.querySelector(`.campus-marker[data-place="${place.id}"]`)?.focus({preventScroll:true});
  }else document.querySelector(`[data-action="${action}"]${action==='campus-filter'?`[data-filter="${campusView.filter}"]`:''}`)?.focus({preventScroll:true});
  return true;
}
