import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..');
const dir=path.join(root,'output/approved-current-design');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const actions={'换网按键说明':'开始 / 重试','修正后的名字按键说明':'暂停 / 继续','签到页按键说明':'签到 / 重试','部分成功/失败按键说明':'重试未成功者','全部成功按键说明':'返回签到'};
const backup=path.join(root,'output/design-backups/rc27-ok-two-lines');
fs.mkdirSync(backup,{recursive:true});
let count=0;
for(const item of manifest){
 if(!actions[item.state]||item.state==='签到页按键说明')continue;
 const file=path.join(dir,item.file),before=path.join(backup,path.basename(file));
 if(!fs.existsSync(before))fs.copyFileSync(file,before);
 const arrow=await sharp(before).extract({left:190,top:229,width:50,height:12}).png().toBuffer();
 const patch=Buffer.from(`<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect x="100" y="${item.state==='签到页按键说明'?211:220}" width="140" height="${item.state==='签到页按键说明'?109:100}" fill="#070a0c"/>${item.state==='签到页按键说明'?'<text x="141" y="222" font-family="sans-serif" font-size="10" fill="#899393">DOWN · 长按</text>':''}<g font-family="sans-serif" text-anchor="middle"><text x="62" y="235" fill="#eeeeee" font-size="13">${actions[item.state]}</text><text x="62" y="252" fill="#899393" font-size="10">OK · 单击</text><text x="151" y="235" fill="#eeeeee" font-size="13">关闭说明</text><text x="151" y="252" fill="#899393" font-size="10">OK · 长按</text></g></svg>`);
 fs.writeFileSync(file,await sharp(before).composite([{input:patch},{input:arrow,left:190,top:229}]).png().toBuffer());
 item.logic=item.logic.replace(/；OK双重功能仅保留.*$/,'');item.logic+='；同键双功能左右并排，每项为上方13像素功能大字、下方10像素灰色按键小字；每键仅一个箭头，操作逻辑不变。';
 count++;
}
if(count!==16)throw new Error(`Expected 16 guides, got ${count}`);
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Updated ${count} guides; other regions preserved.`);
