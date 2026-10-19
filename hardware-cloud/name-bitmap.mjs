import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
export async function nameBitmap(name,compact=false){
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

// Full single-line personal name; bounded to 768 pixels (3 KiB bitmap).
export async function personalNameBitmap(name){
 const text=[...String(name).normalize('NFC')].slice(0,32).join('');
 const escaped=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const {data,info}=await sharp({text:{text:escaped||'Participant',font:'Noto Sans CJK SC 22',fontfile,rgba:true,dpi:72,wrap:'none'}}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const width=Math.min(768,Math.max(8,Math.ceil(info.width/8)*8)),height=32,stride=width/8,bits=Buffer.alloc(stride*height),top=Math.floor((height-info.height)/2);
 for(let y=0;y<info.height;y++)for(let x=0;x<Math.min(width,info.width);x++)if(data[(y*info.width+x)*4+3]>=96&&y+top>=0&&y+top<height)bits[(y+top)*stride+(x>>3)]|=128>>(x&7);
 return {width,hex:bits.toString('hex')};
}

// Six-row roster uses 192x16 strips (384 bytes each) to fit signed 16 KiB replies.
export async function rosterNameBitmap(name){
 const width=192,height=16,stride=24,text=[...String(name).normalize('NFC')].slice(0,32).join('');
 const key='roster:'+text;if(cache.has(key))return cache.get(key);
 const escaped=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const {data,info}=await sharp({text:{text:escaped||'Participant',font:'Noto Sans CJK SC 12',fontfile,rgba:true,dpi:72,wrap:'none'}}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const bits=Buffer.alloc(stride*height),top=Math.floor((height-info.height)/2);
 for(let y=0;y<info.height;y++)for(let x=0;x<Math.min(width,info.width);x++)if(data[(y*info.width+x)*4+3]>=96&&y+top>=0&&y+top<height)bits[(y+top)*stride+(x>>3)]|=128>>(x&7);
 const result=bits.toString('hex');if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
