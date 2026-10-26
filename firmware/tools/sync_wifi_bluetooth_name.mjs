// Add the user-authorized BLE-name state without moving any existing source pixels.
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),source=root+'/output/approved-current-design';
const glyphText=fs.readFileSync(root+'/firmware/main/generated/pixel_glyphs.h','utf8'),glyphs={};
for(const match of glyphText.matchAll(/\[(\d+)\]=\{([^}]+)\}/g))glyphs[Number(match[1])]=match[2].split(',').map(Number);
const original='assets/2efa98c8d3-wifi-setup-page.png',file='assets/wifi-setup-blufi-active.png',state='配网蓝牙已开启',sample='BLUFI_HS_7fc67b7a';
const {data,info}=await sharp(source+'/'+original).removeAlpha().raw().toBuffer({resolveWithObject:true});
if(info.width!==240||info.height!==320||info.channels!==3)throw Error('Unexpected source geometry');
const before=Buffer.from(data),top=290,scale=2,width=sample.length*6*scale-scale,left=(240-width)/2;
if(left<0||top+7*scale>320)throw Error('Bluetooth name would clip');
const color=38131,channels=[((color>>11)&31)<<3,((color>>5)&63)<<2,(color&31)<<3];
for(let n=0;n<sample.length;n++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(glyphs[sample.charCodeAt(n)][y]&(1<<(4-x)))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
 const at=((top+y*scale+dy)*240+left+(n*6+x)*scale+dx)*3;data.set(channels,at);
}
for(let y=0;y<320;y++)if(y<290||y>=304)if(!data.subarray(y*720,(y+1)*720).equals(before.subarray(y*720,(y+1)*720)))throw Error('Unapproved pixels changed');
await sharp(data,{raw:{width:240,height:320,channels:3}}).png().toFile(source+'/'+file);
const note='短按UP开启蓝牙配网后，在原有引导文字下方显示本板完整BLUFI_HS_八位编码；按键前不显示。图中名称为示例，固件取真实蓝牙广播名，不改变其他文字、位置和图标。';
const manifestPath=source+'/manifest.json',manifest=JSON.parse(fs.readFileSync(manifestPath));
if(!manifest.some(x=>x.state===state))manifest.splice(1,0,{section:'首次开机：Wi-Fi 配网',state,color:'中性色',source:'用户确认的原稿增加真实蓝牙名',file,logic:note,status:'已采用'});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const mdPath=source+'/页面设计与逻辑.md';let md=fs.readFileSync(mdPath,'utf8');if(!md.includes('### '+state))md=md.replace('### 正在连接','### '+state+'\n\n- '+note+'\n- 中性色：[设计原件]('+file+')\n\n### 正在连接');fs.writeFileSync(mdPath,md);
const htmlPath=source+'/index.html';let html=fs.readFileSync(htmlPath,'utf8');if(!html.includes('<h3>'+state+'</h3>'))html=html.replace('<h3>正在连接</h3>','<h3>'+state+'</h3><p>'+note+'</p><div class="grid single"><div class="card"><h4>中性色</h4><a href="'+file+'" target="_blank"><img alt="'+state+'" src="'+file+'"></a></div></div><h3>正在连接</h3>');fs.writeFileSync(htmlPath,html);
const provenancePath=root+'/firmware/portable/design-source.json',provenance=JSON.parse(fs.readFileSync(provenancePath));provenance.approved_revision='2026-10-19-wifi-blufi-name';provenance.manifest_sha256=crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');provenance.verified_original_static_pngs=manifest.filter(x=>x.file.endsWith('.png')).length;fs.writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({state,sample,width,left,top,unchanged_outside_new_name:true}));
