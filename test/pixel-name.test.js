import {createHash} from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {nameBitmap,personalNameBitmap,pixelNameRender} from '../hardware-cloud/name-bitmap.mjs';
const font=fs.readFileSync(new URL('../assets/fonts/popcity-pixel-name.bin',import.meta.url));
const rows={R:[30,17,17,30,20,18,17],A:[14,17,17,31,17,17,17],E:[31,16,16,30,16,16,31]};
test('English RAE exactly matches the approved 5x7 pixel design, without auto fitting',async()=>{
 const expected=Buffer.alloc(768);for(let i=0;i<3;i++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(rows['RAE'[i]][y]&(1<<(4-x)))for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const px=78+i*12+x*2+dx,py=9+y*2+dy;expected[py*24+(px>>3)]|=128>>(px&7);}
 assert.deepEqual(Buffer.from(await nameBitmap('RAE'),'hex'),expected);
});
test('Website and board use the identical bounded pixel font binary',()=>{
 assert.equal(createHash('sha256').update(font).digest('hex'),'cfcd1ffccab4768ebdf2d4f2b226db8f50a9d07e8c86ae22a91a0b899a8d6700');
 assert.equal(font.toString('ascii',0,4),'PCP1');assert.equal(font.length,8+font.readUInt32LE(4)*36);
});
test('Subset retains all exported name codepoints supported by the source and complete ASCII',()=>{
 const requested=JSON.parse(fs.readFileSync(new URL('../assets/fonts/name-codepoints.json',import.meta.url))).codepoints;
 const metadata=JSON.parse(fs.readFileSync(new URL('../assets/fonts/popcity-pixel-name.json',import.meta.url)));
 const actual=new Set(Array.from({length:font.readUInt32LE(4)},(_,i)=>font.readUInt32LE(8+i*36)));
 for(let cp=32;cp<=126;cp++)assert.ok(actual.has(cp));
 for(const cp of requested)assert.ok(actual.has(cp)||metadata.missing_requested_codepoints.includes(cp));
 assert.ok(actual.has(0xfffd));assert.ok(font.length<256*1024);assert.equal(metadata.common_han_count,6763);
 for(const ch of '睡觉活动签到名单')assert.ok(actual.has(ch.codePointAt(0)));
 assert.ok(actual.has(0x1f31f));assert.deepEqual(metadata.missing_requested_codepoints,[]);
});
test('Chinese, rare CJK, mixed and 32-character names retain fixed cells and dimensions',async()=>{
 for(const name of ['海椰','𠮷','Rae 海椰','中文名字测试中文名字测试中文名字测试中文名字测试中文名字测试中文']){
  const b=Buffer.from(await nameBitmap(name),'hex');assert.equal(b.length,768);assert.ok(b.some(x=>x));
  const large=await personalNameBitmap(name);assert.equal(large.width,[...name].length*24);assert.ok(large.width<=768);assert.equal(large.hex.length,large.width*8);
 }
 assert.throws(()=>pixelNameRender(''),/Empty/);
});
