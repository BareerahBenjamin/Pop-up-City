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
export async function nameBitmap(name){
 const text=[...String(name).normalize('NFC')].slice(0,32).join('');
 if(cache.has(text))return cache.get(text);
 const escaped=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const {data,info}=await sharp({text:{text:escaped||'Participant',font:'Noto Sans CJK SC 22',fontfile,rgba:true,width:192,height:32,align:'center',wrap:'char'}}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const bits=Buffer.alloc(768);
 const left=Math.floor((192-info.width)/2),top=Math.floor((32-info.height)/2);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>=96){const px=x+left,py=y+top;if(px>=0&&px<192&&py>=0&&py<32)bits[py*24+(px>>3)]|=128>>(px&7);}
 const result=bits.toString('hex');if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(text,result);return result;
}
