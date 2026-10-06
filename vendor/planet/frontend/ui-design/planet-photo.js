(()=>{
'use strict';
// All dimensions are export pixels. The photo rectangle is 984 x 1296.
const DIMENSIONS=Object.freeze({width:1080,height:1440,padding:48,bottomPadding:96,safeRatio:.08,stampDiameter:88,planetFraction:.60});
const config={planetName:'云母海',title:'我的星球',date:null,day:null,checkedIn:null,visitorCount:0,...window.HERSTORY_PHOTO_CONFIG};
const $=s=>document.querySelector(s),dialog=$('#planet-card'),preview=$('#card-preview'),saveButton=$('#save-card');
let blob=null,fileName='',url=null,generating=false,saving=false,version=0;
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
async function open(){if(generating||dialog.open)return;if(!window.HerstoryModal.open(dialog))return;const token=++version;generating=true;blob=null;saveButton.disabled=true;preview.hidden=true;preview.alt='星球纪念卡';$('#card-wait').innerHTML='<span class="card-wait-indicator" aria-hidden="true"></span>';$('#card-wait').setAttribute('aria-label','正在生成卡片');$('#card-wait').hidden=false;dialog.setAttribute('aria-busy','true');const data=snapshotConfig();try{const canvas=await makeCard(data);const encoded=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('JPEG encoding failed')),'image/jpeg',.92));if(token!==version)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(encoded);preview.src=url;await preview.decode();if(token!==version)return;blob=encoded;fileName='Herstory-'+String(data.planetName).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')+'-DAY'+data.day+'-'+String(data.date).replace(/\D/g,'')+'.jpg';$('#card-wait').hidden=true;preview.hidden=false;saveButton.disabled=false;}catch(error){if(token===version){$('#card-wait').hidden=false;$('#card-wait').setAttribute('aria-label','卡片生成失败');$('#card-wait').textContent='卡片生成失败';preview.hidden=true;}window.dispatchEvent(new CustomEvent('herstory:photo-error',{detail:{action:'capture',error}}));}finally{generating=false;dialog.removeAttribute('aria-busy');}}
function close(){window.HerstoryModal.close(dialog);}
async function saveImage(imageBlob,name){
 const file=new File([imageBlob],name,{type:imageBlob.type});
 const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(isIOS&&typeof navigator.share==='function'&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file]});return;}
 const downloadURL=URL.createObjectURL(imageBlob),a=document.createElement('a');a.href=downloadURL;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(downloadURL),10000);
}
async function save(){if(!blob||saving)return;saving=true;saveButton.disabled=true;try{await saveImage(blob,fileName);}catch(error){if(error.name!=='AbortError')window.dispatchEvent(new CustomEvent('herstory:photo-error',{detail:{action:'save',error}}));}finally{saving=false;saveButton.disabled=!blob;}}
$('#planet-camera').onclick=open;$('#close-card').onclick=close;saveButton.onclick=save;dialog.addEventListener('close',()=>{version++;});window.HerstoryModal.register(dialog,()=>!!blob);
window.HerstoryPhoto={config,dimensions:DIMENSIONS,open,save,saveImage,getSaveState(){return {ready:!!blob&&!saving&&!generating};},setCapturePhoto(fn){if(typeof fn!=='function')throw TypeError('capturePhoto must be a function');capturePlanet=fn;}};
})();
