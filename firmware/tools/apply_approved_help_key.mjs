import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..'),src=path.resolve(process.argv[2]||root+'/output/backend-plan/design-source'),dst=path.resolve(process.argv[3]||root+'/output/approved-current-design');
fs.cpSync(src,dst,{recursive:true});const manifest=JSON.parse(fs.readFileSync(dst+'/manifest.json'));
for(const item of manifest.filter(x=>/说明/.test(x.state)&&x.file.endsWith('.png'))){
 const file=path.join(dst,item.file);const {data}=await sharp(file).raw().toBuffer({resolveWithObject:true});const bg=`rgb(${data[0]},${data[1]},${data[2]})`;
 // Only the physical-key instruction is revised. All business instructions stay at original coordinates.
 const tint={草绿:'#BDCC7D',粉色:'#EAB0BA',天蓝:'#A9CDE3',杏色:'#EFC18D',中性色:'#B8C6C0'}[item.color];
 const svg=Buffer.from(`<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="43" width="121" height="46" fill="${bg}"/><text x="130" y="289" fill="#eee" font-family="sans-serif" font-size="13">关闭说明</text><path d="M190 285H237l-4 -3m4 3l-4 3" fill="none" stroke="${tint}" stroke-width="1.5"/><text x="130" y="305" fill="#899393" font-family="sans-serif" font-size="10">OK · 长按</text></svg>`);
 const png=await sharp(file).composite([{input:svg}]).png().toBuffer();fs.writeFileSync(file,png);
}
for(const name of ['页面设计与逻辑.md','index.html']){const file=dst+'/'+name;let s=fs.readFileSync(file,'utf8');s=s.replaceAll('POWER单击','OK长按').replaceAll('POWER 单击','OK 长按').replaceAll('POWER开关说明','OK长按开关说明').replaceAll('电源键：通用按键说明规则','长按OK：通用按键说明规则');fs.writeFileSync(file,s);}
for(const item of manifest){item.logic=item.logic.replaceAll('POWER单击','OK长按').replaceAll('POWER开关说明','OK长按开关说明');item.section=item.section.replace('电源键：通用按键说明规则','长按OK：通用按键说明规则');}
fs.writeFileSync(dst+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
fs.appendFileSync(dst+'/页面设计与逻辑.md','\n## 本次硬件适配确认（2026-10-19）\n用户确认：说明页入口改为长按 OK，说明图只调整此按键及对应箭头，其他设计保留。绑定核对页长按 OK 仍拒绝绑定；提交、加载和动画锁定时不打开说明。\n');
console.log('Prepared authoritative copy with approved OK-key revision only.');
