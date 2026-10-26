import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..'),dir=path.join(root,'output/approved-current-design');const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const backup=path.join(root,'output/design-backups/rc26-double-up');fs.mkdirSync(backup,{recursive:true});
for(const item of manifest.filter(x=>x.state==='星球页按键说明')){
 const file=path.join(dir,item.file),before=path.join(backup,path.basename(file));if(!fs.existsSync(before))fs.copyFileSync(file,before);
 const patch=Buffer.from('<svg width="240" height="320" xmlns="http://www.w3.org/2000/svg"><rect x="135" y="114" width="58" height="17" fill="#070a0c"/><text x="141" y="126" font-family="sans-serif" font-size="10" fill="#899393">UP · 双击</text></svg>');
 const bytes=await sharp(before).composite([{input:patch}]).png().toBuffer();fs.writeFileSync(file,bytes);
}
for(const item of manifest)item.logic=item.logic.replaceAll('仅此页短按UP换网','仅星球页双击UP换网，单击UP不操作').replaceAll('星球页短按UP换网','星球页双击UP换网，单击UP不操作');
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
