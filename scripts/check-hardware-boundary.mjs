import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
export function checkHardwareBoundary(root){
 const manifest=JSON.parse(readFileSync(join(root,'hardware-interface/protected-files.json'),'utf8'));
 const files=new Set(),errors=[];
 const walk=p=>{
  const absolute=join(root,p);
  let stat;try{stat=lstatSync(absolute);}catch{errors.push('missing: '+p);return;}
  if(stat.isSymbolicLink()){errors.push('symlink forbidden: '+p);return;}
  if(stat.isDirectory())for(const entry of readdirSync(absolute))walk(p+'/'+entry);
  else if(stat.isFile())files.add(p);
 };
 for(const p of manifest.roots)walk(p);
 for(const p of files){
  if(!Object.hasOwn(manifest.sha256,p)){errors.push('unreviewed addition: '+p);continue;}
  if(createHash('sha256').update(readFileSync(join(root,p))).digest('hex')!==manifest.sha256[p])errors.push('modified: '+p);
 }
 for(const p of Object.keys(manifest.sha256))if(!files.has(p))errors.push('deleted: '+p);
 if(errors.length)throw Error('硬件边界校验失败（前端任务不得刷新摘要绕过）：\n'+errors.join('\n'));
 return files.size;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const root=resolve(fileURLToPath(new URL('..',import.meta.url)));console.log('Hardware boundary PASS: '+checkHardwareBoundary(root)+' frozen files');}
 catch(error){console.error(error.message);process.exitCode=1;}
}
