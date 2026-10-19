// Compile approved simulator PNGs losslessly to RGB565 runs; no full-frame RAM needed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..');
const source=path.join(root,'output/device-simulator');
const target=path.join(root,'firmware/main/generated');
fs.mkdirSync(target,{recursive:true});
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(source,'assets.js'),'utf8'),scope);
vm.runInNewContext(fs.readFileSync(path.join(source,'help-map.js'),'utf8'),scope);
const entries=[];const welcome=[];
for(const [key,file]of Object.entries(scope.window.SIM_ASSETS)){
 if(file.endsWith('.png'))entries.push({key,file});
 if(key.startsWith('欢迎循环动画|')&&file.endsWith('.gif')){
  const metadata=await sharp(path.join(source,file),{animated:true}).metadata();
  const frames=[];
  for(let frame=0;frame<metadata.pages;frame++){
   const name=key+'#'+frame;entries.push({key:name,file,page:frame});frames.push({key:name,duration:metadata.delay[frame]||100});
  }
  welcome.push({key,frames});
 }
}
const chunks=[],records=[];let offset=0;
for(const {key,file,page}of entries){
 const {data,info}=await sharp(path.join(source,file),page===undefined?{}:{page,pages:1}).flatten({background:'#000000'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==240||info.height!==320||info.channels!==3)throw Error('Unexpected screen dimensions: '+key);
 const runs=[];let previous=-1,count=0;
 function flush(){if(count){runs.push(count&255,count>>8,previous&255,previous>>8);count=0;}}
 for(let p=0;p<data.length;p+=3){const rgb=((data[p]>>3)<<11)|((data[p+1]>>2)<<5)|(data[p+2]>>3);if(rgb!==previous||count===65535){flush();previous=rgb;}count++;}flush();
 const bytes=Buffer.from(runs);chunks.push(bytes);records.push({key,file,...(page===undefined?{}:{page}),offset,length:bytes.length});offset+=bytes.length;
}
fs.writeFileSync(path.join(target,'screens.rle'),Buffer.concat(chunks));
fs.writeFileSync(path.join(target,'screens.json'),JSON.stringify(records,null,2)+'\n');
const literal=s=>JSON.stringify(s);
fs.writeFileSync(path.join(target,'screens.c'),'// Generated from approved simulator images by compile_screens.mjs.\n#include "screen_assets.h"\nconst pc_screen_asset pc_screen_assets[]={\n'+records.map(r=>` {${literal(r.key)},${r.offset}u,${r.length}u},`).join('\n')+'\n};\nconst unsigned pc_screen_asset_count=sizeof(pc_screen_assets)/sizeof(pc_screen_assets[0]);\n');
console.log(JSON.stringify({screens:records.length,flashBytes:offset,decodedFrameBytes:153600,renderStripBytes:4800}));

fs.writeFileSync(path.join(target,'welcome_frames.h'),'// Generated GIF frame timings.\nstatic const struct {const char *key;unsigned duration;} welcome_frames[][42]={\n'+welcome.map(group=>'{'+group.frames.map(f=>'{'+JSON.stringify(f.key)+','+f.duration+'}').join(',')+'}').join(',\n')+'\n};\n');
