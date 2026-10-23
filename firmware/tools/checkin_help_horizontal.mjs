import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'output/approved-current-design');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const backup=path.join(root,'output/design-backups/rc29-checkin-horizontal');
fs.mkdirSync(backup,{recursive:true});
const groups=[{key:'UP',y:62,actions:['下一位','全部签到']},{key:'DOWN',y:160,actions:['上一位','查看名单']},{key:'OK',y:235,actions:['签到 / 重试','关闭说明']}];
let count=0;
for(const item of manifest.filter(x=>x.state==='签到页按键说明')){
 const file=path.join(dir,item.file),before=path.join(backup,path.basename(file));
 if(!fs.existsSync(before))fs.copyFileSync(file,before);
 const overlays=[];
 for(const group of groups)overlays.push({input:await sharp(before).extract({left:190,top:group.y-5,width:50,height:12}).png().toBuffer(),left:190,top:group.y-5});
 const texts=groups.map(g=>g.actions.map((action,i)=>`<text x="${i?151:62}" y="${g.y}" fill="#eeeeee" font-size="13">${action}</text><text x="${i?151:62}" y="${g.y+17}" fill="#899393" font-size="10">${g.key} · ${i?'长按':'单击'}</text>`).join('')).join('');
 const svg=Buffer.from(`<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect y="45" width="240" height="275" fill="#070a0c"/><g font-family="sans-serif" text-anchor="middle">${texts}</g></svg>`);
 fs.writeFileSync(file,await sharp(before).composite([{input:svg},...overlays]).png().toBuffer());
 item.logic=item.logic.replace(/；OK双重功能仅保留.*$/,'')+'；签到说明页：UP、DOWN、OK各保留一个箭头；同键单击与长按功能左右并排，每项均为上方13像素功能大字、下方10像素灰色按键小字。按键行为不变。';
 count++;
}
if(count!==4)throw new Error(`Expected 4, got ${count}`);
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
