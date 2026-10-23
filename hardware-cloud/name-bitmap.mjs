import { existsSync, mkdtempSync, writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const fontfile=fileURLToPath(new URL('../assets/fonts/NotoSansCJKsc-Regular.otf',import.meta.url));
// macOS/minimal hosts may ship no Fontconfig config. Use only our licensed font
// and an isolated writable cache; deployments with a config retain theirs.
if(!process.env.FONTCONFIG_FILE&&!existsSync('/etc/fonts/fonts.conf')){
 const directory=mkdtempSync(join(tmpdir(),'herstory-fontconfig-'));
 const config=join(directory,'fonts.conf');
 const xml=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
 writeFileSync(config,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${xml(dirname(fontfile))}</dir><cachedir>${xml(directory)}</cachedir></fontconfig>`,{mode:0o600});
 process.env.FONTCONFIG_FILE=config;
}
const cache=new Map();
// A signed 192x32 one-bit name strip avoids a large CJK font in board RAM/Flash.
export async function activityTitleBitmap(name,compact=false){
 const width=compact?128:192,height=compact?24:32,stride=width/8;
 const text=[...String(name).normalize('NFC')].slice(0,32).join('');
 const key=(compact?'header:':'host:')+text;
 if(cache.has(key))return cache.get(key);
 const escaped=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 // Explicit height makes Pango auto-fit short names, enlarging English text.
 // Header names use a fixed 14px font; the output bitmap stays 128x24.
 const layout=compact?{dpi:72,wrap:'none'}:{height,wrap:'char'};
 const {data,info}=await sharp({text:{text:escaped||'Participant',font:compact?'Noto Sans CJK SC 14':'Noto Sans CJK SC 22',fontfile,rgba:true,width,align:compact?'left':'center',...layout}}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const bits=Buffer.alloc(stride*height);
 const left=compact?0:Math.floor((width-info.width)/2),top=Math.floor((height-info.height)/2);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>=96){const px=x+left,py=y+top;if(px>=0&&px<width&&py>=0&&py<height)bits[py*stride+(px>>3)]|=128>>(px&7);}
 const result=bits.toString('hex');if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}

// Names use one canonical native-pixel binary, shared with firmware ROM.
const pixels=readFileSync(new URL('../assets/fonts/popcity-pixel-name.bin',import.meta.url));
if(pixels.toString('ascii',0,4)!=='PCP1'||pixels.length!==8+pixels.readUInt32LE(4)*36)throw Error('Invalid pixel name font');
export const NAME_BITMAP_STYLE='popcity-pixel-v1';
export const NAME_FONT_SHA256=JSON.parse(readFileSync(new URL('../assets/fonts/popcity-pixel-name.json',import.meta.url))).sha256;
function glyph(cp){
 let l=0,r=pixels.readUInt32LE(4);while(l<r){const m=(l+r)>>>1;if(pixels.readUInt32LE(8+m*36)<cp)l=m+1;else r=m;}
 return l<pixels.readUInt32LE(4)&&pixels.readUInt32LE(8+l*36)===cp?pixels.subarray(12+l*36,44+l*36):null;
}
export function pixelNameRender(name,{width=192,height=32,scale=1,center=true,wrap=true}={}){
 const letters=[...String(name).normalize('NFC')].slice(0,32);
 if(!letters.length)throw Error('Empty name bitmap');
 const advance=12*scale,columns=wrap?Math.floor(width/advance):letters.length,lines=Math.ceil(letters.length/columns);
 if(!columns||lines*16*scale>height||width%8||width>768)throw Error('Name bitmap geometry invalid');
 const bits=Buffer.alloc(width/8*height);
 letters.forEach((letter,i)=>{
  const g=glyph(letter.codePointAt(0))||glyph(0xfffd),line=Math.floor(i/columns),inLine=Math.min(columns,letters.length-line*columns);
  const left=(center?Math.floor((width-inLine*advance)/2):0)+(i%columns)*advance,top=Math.floor((height-lines*16*scale)/2)+line*16*scale;
  for(let y=0;y<16;y++)for(let x=0;x<12;x++)if(g[y*2+(x>>3)]&(128>>(x&7)))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
   const px=left+x*scale+dx,py=top+y*scale+dy;if(px>=0&&px<width&&py<height)bits[py*(width/8)+(px>>3)]|=128>>(px&7);
  }
 });
 return bits;
}
export async function nameBitmap(name,compact=false){
 return pixelNameRender(name,compact?{width:128,height:24,center:false,wrap:false}:{}).toString('hex');
}
export async function personalNameBitmap(name){
 const text=[...String(name).normalize('NFC')].slice(0,32).join(''),width=Math.max(8,Math.ceil([...text].length*24/8)*8);
 return {width,hex:pixelNameRender(text,{width,height:32,scale:2,center:false,wrap:false}).toString('hex')};
}
export async function rosterNameBitmap(name){
 return pixelNameRender(name,{width:192,height:16,center:false,wrap:false}).toString('hex');
}
