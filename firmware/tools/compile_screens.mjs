// Compile the authoritative design manifest directly; never import legacy simulator overrides.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..');
const source=path.resolve(process.argv[2]||path.join(root,'output/approved-current-design'));
const target=path.join(root,'firmware/main/generated');
fs.mkdirSync(target,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const entries=[];const welcome=[];const keys=new Set();
for(const item of manifest){
 const key=item.state+'|'+item.color,file=item.file;
 if(keys.has(key))throw Error('Duplicate design key: '+key);
 keys.add(key);
 if(file.endsWith('.png'))entries.push({key,file});
 if(key.startsWith('欢迎循环动画|')&&file.endsWith('.gif')){
  const metadata=await sharp(path.join(source,file),{animated:true}).metadata();
  if(metadata.pages!==42)throw Error('Welcome frame count changed: '+key);
  const frames=[];
  for(let frame=0;frame<metadata.pages;frame++){
   const name=key+'#'+frame;entries.push({key:name,file,page:frame});frames.push({key:name,duration:metadata.delay[frame]||100});
  }
  welcome.push({key,frames});
 }
}
if(welcome.length!==4)throw Error('Missing welcome palettes');
const chunks=[],records=[];let offset=0;let welcomeTop=320,welcomeBottom=0;const firstFrames=new Map();
for(const {key,file,page}of entries){
 const {data,info}=await sharp(path.join(source,file),page===undefined?{}:{page,pages:1}).flatten({background:'#000000'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==240||info.height!==320||info.channels!==3)throw Error('Unexpected screen dimensions: '+key);
 if(page!==undefined){
  if(page===0)firstFrames.set(file,Buffer.from(data));
  else {const first=firstFrames.get(file);for(let y=0;y<320;y++)for(let x=0;x<720;x++)if(data[y*720+x]!==first[y*720+x]){welcomeTop=Math.min(welcomeTop,y);welcomeBottom=Math.max(welcomeBottom,y+1);break;}}
 }
 const runs=[];let previous=-1,count=0;
 function flush(){if(count){runs.push(count&255,count>>8,previous&255,previous>>8);count=0;}}
 for(let p=0;p<data.length;p+=3){const rgb=((data[p]>>3)<<11)|((data[p+1]>>2)<<5)|(data[p+2]>>3);if(rgb!==previous||count===65535){flush();previous=rgb;}count++;}flush();
 const bytes=Buffer.from(runs);chunks.push(bytes);records.push({key,file,...(page===undefined?{}:{page}),offset,length:bytes.length});offset+=bytes.length;
}
fs.writeFileSync(path.join(target,'screens.rle'),Buffer.concat(chunks));
fs.writeFileSync(path.join(target,'screens.json'),JSON.stringify(records,null,2)+'\n');
const literal=s=>JSON.stringify(s);
fs.writeFileSync(path.join(target,'screens.c'),'// Generated from authoritative design archive by compile_screens.mjs.\n#include "screen_assets.h"\nconst pc_screen_asset pc_screen_assets[]={\n'+records.map(r=>` {${literal(r.key)},${r.offset}u,${r.length}u},`).join('\n')+'\n};\nconst unsigned pc_screen_asset_count=sizeof(pc_screen_assets)/sizeof(pc_screen_assets[0]);\n');
console.log(JSON.stringify({screens:records.length,flashBytes:offset,decodedFrameBytes:153600,renderStripBytes:4800}));

fs.writeFileSync(path.join(target,'welcome_frames.h'),'// Generated GIF frame timings and verified union of changed rows.\n#define PC_WELCOME_DIRTY_TOP '+welcomeTop+'u\n#define PC_WELCOME_DIRTY_BOTTOM '+welcomeBottom+'u\nstatic const struct {const char *key;unsigned duration;} welcome_frames[][42]={\n'+welcome.map(group=>'{'+group.frames.map(f=>'{'+JSON.stringify(f.key)+','+f.duration+'}').join(',')+'}').join(',\n')+'\n};\n');
