// Code-native pixel sprite correction: restore the flat top surface underneath
// the template house; keep every other pixel, including text and palette.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..');
const dir=path.join(root,'output/approved-current-design');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
for(const item of manifest.filter(x=>x.state==='绑定成功')){
 const file=path.join(dir,item.file),backup=path.join(root,'output/design-backups/rc21-bound-initial',path.basename(file));
 if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
 const {data,info}=await sharp(backup).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const sample=(116*240+120)*3,top=Buffer.from(data.subarray(sample,sample+3));
 // All house pixels lie within this small flat, untextured face region.
 for(let y=119;y<146;y++)for(let x=104;x<134;x++)top.copy(data,(y*240+x)*3);
 await sharp(data,{raw:{width:240,height:320,channels:info.channels}}).png().toFile(file);
 item.logic+='；绑定成功页仅显示无建筑初始星球，颜色取本人官网配色；OK后欢迎循环，正常星球页仍取真实成长状态。';
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
