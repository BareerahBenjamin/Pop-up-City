import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..'),html=fs.readFileSync(root+'/output/approved-current-design/assets/4bf633c880-blue.html','utf8');
const src=JSON.parse(html.match(/const source=(\[[\s\S]*?\]);/)[1]);
const base=['DFE9A0','BFD27B','9FB65F','7D9446'].map(h=>h.match(/../g).map(x=>parseInt(x,16)));
// Read the exact base/palette arrays from the authored artwork.
const colors=Function('return '+html.match(/const colors=(\[[\s\S]*?\]);/)[1])();
const rgb=s=>s.slice(1).match(/../g).map(v=>parseInt(v,16));const palette=colors[2].map(rgb),original=colors[0].map(rgb);
for(let p=0;p<src.length;p+=4){let tone=original.findIndex(c=>c.every((v,i)=>v===src[p+i]));if(tone>=0)for(let k=0;k<3;k++)src[p+k]=palette[tone][k];}
const sprite=await sharp(Buffer.from(src),{raw:{width:64,height:64,channels:4}}).resize(192,192,{kernel:'nearest'}).png().toBuffer();
const glyphs=new Map([...fs.readFileSync(root+'/firmware/main/generated/pixel_glyphs.h','utf8').matchAll(/^\s*\[(\d+)\]=\{([^}]+)\}/gm)].map(m=>[+m[1],m[2].split(',').map(Number)]));
const title="RAE'S PLANET",scale=2,left=Math.floor((240-(title.length*6-1)*scale)/2),top=274,color='#CFE7F7';let pixels='';
for(let i=0;i<title.length;i++){const rows=glyphs.get(title.charCodeAt(i))||(title[i]===String.fromCharCode(39)?[4,4,8,0,0,0,0]:[0,0,0,0,0,0,0]);for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(rows[y]&(1<<(4-x)))pixels+=`<rect x="${left+i*12+x*2}" y="${top+y*2}" width="2" height="2"/>`;}
const label=Buffer.from(`<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><g fill="${color}">${pixels}</g></svg>`);
const out=root+'/output/planet-owner-preview';await sharp({create:{width:240,height:320,channels:4,background:'#000'}}).composite([{input:sprite,left:24,top:48},{input:label}]).png().toFile(out+'/planet-owner-blue.png');await sharp(out+'/planet-owner-blue.png').resize(480,640,{kernel:'nearest'}).toFile(out+'/planet-owner-blue-2x.png');
fs.writeFileSync(out+'/README.md',"候选设计：星球下方居中 RAE'S PLANET；12×14 像素ASCII字，基于固件5×7字形整数放大。色彩跟随网站2D星球主题。仅预览，未修改正式设计ZIP或固件。实际名字使用对应账号名称；长名称需确认滚动策略。\n");
