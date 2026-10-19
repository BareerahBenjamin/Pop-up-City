import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'../..');
const generated=path.join(root,'firmware/main/generated');
const runs=fs.readFileSync(path.join(generated,'screens.rle'));
const records=JSON.parse(fs.readFileSync(path.join(generated,'screens.json')));
const scope={window:{}};
for(const file of ['assets.js','help-map.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'output/device-simulator',file),'utf8'),scope);
let end=0;
for(const record of records){
 assert.equal(record.offset,end);assert.equal(record.length%4,0);end+=record.length;assert.ok(end<=runs.length);
 const source=record.file||scope.window.SIM_ASSETS[record.key];assert.ok(source);
 const pixels=await sharp(path.join(root,'output/device-simulator',source),record.page===undefined?{}:{page:record.page,pages:1}).flatten({background:'#000000'}).removeAlpha().raw().toBuffer();
 let cursor=0;
 for(let at=record.offset;at<end;at+=4){const count=runs.readUInt16LE(at),color=runs.readUInt16LE(at+2);assert.ok(count>0);assert.ok(cursor+count<=76800);
  for(let n=0;n<count;n++){const p=cursor++*3;assert.equal(color,((pixels[p]>>3)<<11)|((pixels[p+1]>>2)<<5)|(pixels[p+2]>>3));}
 }
 assert.equal(cursor,76800);
}
assert.equal(end,runs.length);
console.log(`Approved screen assets: ${records.length} images match RGB565 source pixels; contiguous/bounded run data PASS`);
