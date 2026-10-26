// Match the firmware's code-native 5x7 pixel glyphs, without retypesetting artwork.
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'output/approved-current-design');
const glyphs=new Map([...fs.readFileSync(path.join(root,'firmware/main/generated/pixel_glyphs.h'),'utf8').matchAll(/\[(\d+)\]=\{([^}]+)\}/g)].map(m=>[Number(m[1]),m[2].split(',').map(Number)]));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),colors={'草绿':0xdf34,'粉色':0xf679,'天蓝':0xcf3e,'杏色':0xfed5};
const backup=path.join(root,'output/design-backups/rc25-friend-return');fs.mkdirSync(backup,{recursive:true});
for(const item of manifest.filter(x=>x.state==='交友成功静态')){
 const file=path.join(dir,item.file),before=path.join(backup,path.basename(file));if(!fs.existsSync(before))fs.copyFileSync(file,before);
 const {data,info}=await sharp(before).removeAlpha().raw().toBuffer({resolveWithObject:true});const text='OK TO RETURN TO PLANET',left=(240-(text.length*6-1))/2|0,c=colors[item.color],rgb=[((c>>11)&31)<<3,((c>>5)&63)<<2,(c&31)<<3];
 for(let n=0;n<text.length;n++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if((glyphs.get(text.charCodeAt(n))?.[y]||0)&(1<<(4-x))){let p=((294+y)*240+left+n*6+x)*3;data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];}
 await sharp(data,{raw:{width:240,height:320,channels:info.channels}}).png().toFile(file);
 item.logic+='；动画播放中不显示返回提示且不能打断；结束后人物下方显示 OK TO RETURN TO PLANET，短按 OK 返回星球或优先活动，长按 OK 不打开说明。';
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
