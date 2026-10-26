// Verify compiled art against the user supplied design archive, not a simulator cache.
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),source=path.resolve(process.argv[2]||'output/approved-current-design');
const records=JSON.parse(fs.readFileSync(root+'/firmware/main/generated/screens.json')),manifest=JSON.parse(fs.readFileSync(source+'/manifest.json')),runs=fs.readFileSync(root+'/firmware/main/generated/screens.rle');let checked=0;
for(const item of manifest.filter(x=>x.file.endsWith('.png'))){
 const record=records.find(x=>x.file===item.file);assert.ok(record,`Missing required original screen: ${item.state}|${item.color}`);
 const pixels=await sharp(path.join(source,item.file)).flatten({background:'#000'}).removeAlpha().raw().toBuffer();let cursor=0;
 for(let at=record.offset;at<record.offset+record.length;at+=4){let count=runs.readUInt16LE(at),color=runs.readUInt16LE(at+2);while(count--){let p=cursor++*3;assert.equal(color,((pixels[p]>>3)<<11)|((pixels[p+1]>>2)<<5)|(pixels[p+2]>>3),item.state);}}
 assert.equal(cursor,76800);checked++;
}
console.log(JSON.stringify({source,matched_original_pngs:checked,exclusions:'Personalized overlays and physical visual acceptance remain separate; no original PNG may be skipped.'}));

let frames=0;for(const record of records.filter(x=>x.file.endsWith('.gif')&&x.key.startsWith('欢迎循环动画'))){
 const pixels=await sharp(path.join(source,record.file),{page:record.page,pages:1}).flatten({background:'#000'}).removeAlpha().raw().toBuffer();let cursor=0;for(let at=record.offset;at<record.offset+record.length;at+=4){let count=runs.readUInt16LE(at),color=runs.readUInt16LE(at+2);while(count--){let p=cursor++*3;assert.equal(color,((pixels[p]>>3)<<11)|((pixels[p+1]>>2)<<5)|(pixels[p+2]>>3),record.key);}}assert.equal(cursor,76800);frames++;}console.log('Welcome GIF frames verified:',frames);
