(()=>{
'use strict';
// All dimensions are export pixels. The photo rectangle is 984 x 1296.
const DIMENSIONS=Object.freeze({width:1080,height:1440,padding:48,bottomPadding:96,safeRatio:.08,stampDiameter:88,planetFraction:.44});
const config={planetName:'云母海',title:'我的星球',date:null,day:null,checkedIn:null,visitorCount:0,...window.HERSTORY_PHOTO_CONFIG};
const $=s=>document.querySelector(s),dialog=$('#planet-card'),preview=$('#card-preview'),saveButton=$('#save-card');
let blob=null,fileName='',generating=false,saving=false,version=0,previewVersion=0,mode='3d',cards={};
const modeButtons=[...document.querySelectorAll('[data-card-mode]')];
function fitPreview(){const pages=$('#card-pages');if(!pages)return;const width=Math.max(0,Math.min(300,pages.clientWidth,pages.clientHeight*3/4));preview.style.width=width+'px';preview.style.height=width*4/3+'px';}
if($('#card-pages'))new ResizeObserver(fitPreview).observe($('#card-pages'));
function encode(canvas,type){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Image encoding failed')),type,.92));}
function capturePixel(pixel){if(!pixel)throw Error('Pixel state unavailable');const frame=window.HerstoryPixelRenderer.renderFrame(pixel,{width:240,height:320}),canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;canvas.getContext('2d').putImageData(new ImageData(frame.rgba,frame.width,frame.height),0,0);return encode(canvas,'image/png');}
async function selectMode(next){mode=next==='2d'?'2d':'3d';const token=++previewVersion;dialog.dataset.cardMode=mode;for(const b of modeButtons)b.setAttribute('aria-pressed',String(b.dataset.cardMode===mode));blob=null;saveButton.disabled=true;preview.hidden=true;const card=cards[mode],wait=$('#card-wait');wait.hidden=false;if(!card){wait.textContent=generating?'正在生成图片…':'图片未生成，请关闭后重试';wait.setAttribute('aria-label',wait.textContent);return;}if(card.error){wait.textContent='图片生成失败，请关闭后重试';wait.setAttribute('aria-label',wait.textContent);return;}preview.alt=mode==='2d'?'我的2D像素星球':'3D星球纪念卡';preview.src=card.url;try{await preview.decode();if(token!==previewVersion)return;fitPreview();blob=card.blob;fileName=card.name;wait.hidden=true;preview.hidden=false;saveButton.disabled=saving;}catch{if(token!==previewVersion)return;wait.textContent='图片预览失败，请关闭后重试';wait.setAttribute('aria-label',wait.textContent);}}
for(const b of modeButtons)b.onclick=()=>selectMode(b.dataset.cardMode);
// Replace this callback with your own capturePhoto(). Return a CanvasImageSource
// sized to width x height, with this background, or with a transparent background.
let capturePlanet=options=>window.stellarScene.capturePhoto(options);
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/\//g,'-');}
function snapshotConfig(){const state=window.HerstoryApp.getState();const date=config.date||today();return {...config,date,day:config.day??state.snapshot.day,checkedIn:config.checkedIn??(state.demo&&state.snapshot.day>0)};}
function tracked(ctx,text,x,y,spacing,align='left'){const chars=Array.from(String(text)),width=chars.reduce((n,c)=>n+ctx.measureText(c).width,0)+Math.max(0,chars.length-1)*spacing;let cursor=align==='right'?x-width:align==='center'?x-width/2:x;ctx.textAlign='left';for(const char of chars){ctx.fillText(char,cursor,y);cursor+=ctx.measureText(char).width+spacing;}}
function fitTracked(ctx,text,x,y,spacing,maxWidth,align='left'){const chars=Array.from(String(text));const measure=a=>a.reduce((n,c)=>n+ctx.measureText(c).width,0)+Math.max(0,a.length-1)*spacing;if(measure(chars)<=maxWidth)return tracked(ctx,chars.join(''),x,y,spacing,align);while(chars.length&&measure([...chars,'…'])>maxWidth)chars.pop();tracked(ctx,chars.join('')+'…',x,y,spacing,align);}
function makeBackground(width,height){const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(width/2,height/2,0,width/2,height/2,height*.57);g.addColorStop(0,'#5B8479');g.addColorStop(.50,'#1C353A');g.addColorStop(1,'#0A1418');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);return c;}
async function makeCard(data){const d=DIMENSIONS,p=d.padding,w=d.width-2*p,h=d.height-p-d.bottomPadding,sx=Math.ceil(d.width*d.safeRatio),sy=Math.ceil(d.height*d.safeRatio),c=document.createElement('canvas');c.width=d.width;c.height=d.height;const ctx=c.getContext('2d');ctx.fillStyle='#EFE9DB';ctx.fillRect(0,0,d.width,d.height);const background=makeBackground(w,h);
 // Capture synchronously at the shutter event; the existing scene keeps its orientation.
 const planet=await capturePlanet({width:w,height:h,background,planetFraction:d.planetFraction,config:{...data}});ctx.drawImage(background,p,p,w,h);ctx.drawImage(planet,p,p,w,h);
 const left=Math.max(sx,p+48),right=d.width-left,top=sy+38;
 ctx.fillStyle='rgba(228,228,215,.88)';ctx.font='38px SFMono-Regular,Consolas,monospace';fitTracked(ctx,data.title,left,top,3,350);tracked(ctx,String(data.date).replace(/-/g,'.'),right,top,3,'right');
 // 96px bottom border cannot contain text with a 115.2px vertical safe inset.
 // Extend the paper footer inward; keep all text and the rotated seal inside 8%.
 const footerTop=d.height-sy-112,photoLabelY=footerTop-35;
 tracked(ctx,'DAY '+data.day,left,photoLabelY,3);ctx.font='42px Georgia,"Times New Roman",serif';tracked(ctx,'HERSTORY',right,photoLabelY,6,'right');
 ctx.fillStyle='#EFE9DB';ctx.fillRect(p,footerTop,w,d.height-footerTop);ctx.fillStyle='#75684F';ctx.font='34px SFMono-Regular,Consolas,monospace';tracked(ctx,'HERSTORY DAY '+data.day,left,d.height-sy-26,2);
 const radius=d.stampDiameter/2,cx=right-radius-8,cy=d.height-sy-radius-8;ctx.save();ctx.translate(cx,cy);ctx.rotate(-8*Math.PI/180);ctx.strokeStyle='#B18F52';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#806537';ctx.font='22px "Microsoft YaHei",sans-serif';tracked(ctx,typeof config.checkedIn==='boolean'?(data.checkedIn?'已打卡':'未打卡'):'我的星球',0,-5,1,'center');ctx.font='20px SFMono-Regular,Consolas,monospace';tracked(ctx,'DAY '+data.day,0,20,1,'center');ctx.restore();return c;
}
async function open(){
 if(dialog.open)return;if(!window.HerstoryModal.open(dialog))return;
 const token=++version;generating=true;blob=null;for(const card of Object.values(cards))if(card.url)URL.revokeObjectURL(card.url);cards={};
 dialog.setAttribute('aria-busy','true');const data=snapshotConfig(),pixel=window.HerstoryPixelDisplay?.getState();
 const clean=value=>String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
 const name='Herstory-'+clean(data.planetName),date=String(data.date).replace(/\D/g,'');
 selectMode(document.body.dataset.planetMode==='2d'?'2d':'3d');
 try{
  const outputs=await Promise.allSettled([makeCard(data).then(canvas=>encode(canvas,'image/jpeg')),Promise.resolve().then(()=>capturePixel(pixel))]);
  if(token!==version)return;
  for(const [index,key]of ['3d','2d'].entries()){const result=outputs[index];cards[key]=result.status==='fulfilled'?{blob:result.value,url:URL.createObjectURL(result.value),name:name+(key==='2d'?'-2D-':'-DAY'+data.day+'-')+date+(key==='2d'?'.png':'.jpg')}:{error:result.reason};}
  generating=false;await selectMode(mode);
 }catch(error){if(token===version){generating=false;cards[mode]={error};await selectMode(mode);}}
 finally{if(token===version){generating=false;dialog.removeAttribute('aria-busy');}}
}
function close(){window.HerstoryModal.close(dialog);}
async function saveImage(imageBlob,name){
 const file=new File([imageBlob],name,{type:imageBlob.type});
 const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(isIOS&&typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file]});return;}
 const downloadURL=URL.createObjectURL(imageBlob),a=document.createElement('a');a.href=downloadURL;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(downloadURL),10000);
}
async function save(){if(!blob||saving)return;saving=true;saveButton.disabled=true;try{await saveImage(blob,fileName);}catch(error){if(error.name!=='AbortError')window.dispatchEvent(new CustomEvent('herstory:photo-error',{detail:{action:'save',error}}));}finally{saving=false;saveButton.disabled=!blob;}}
$('#planet-camera').onclick=open;$('#close-card').onclick=close;saveButton.onclick=save;dialog.addEventListener('close',()=>{version++;previewVersion++;generating=false;dialog.removeAttribute('aria-busy');});window.HerstoryModal.register(dialog,()=>!!blob);
window.HerstoryPhoto={config,dimensions:DIMENSIONS,open,save,saveImage,selectMode,getSaveState(){return {ready:!!blob&&!saving&&!generating};},setCapturePhoto(fn){if(typeof fn!=='function')throw TypeError('capturePhoto must be a function');capturePlanet=fn;}};
})();
