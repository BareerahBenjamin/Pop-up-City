import { backup } from 'node:sqlite';
import { existsSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
process.umask(0o077);
const config=loadConfig();
if(!existsSync(config.databasePath))throw new Error('数据库不存在；不会为备份创建空数据库');
const name=process.argv[2]||`backup-${Date.now()}.sqlite`;
if(!/^backup-[A-Za-z0-9_-]+\.sqlite$/.test(name))throw new Error('备份名须为 backup-名称.sqlite，不允许目录路径');
const target=join(dirname(config.databasePath),name);
if(target===config.databasePath)throw new Error('不能覆盖源数据库');
const db=openDatabase(config.databasePath);
try{
 // Reserve the destination exclusively so an existing backup is never overwritten.
 closeSync(openSync(target,'wx',0o600));
 try{await backup(db.raw,target);console.log(`数据库一致性备份已完成：${name}`)}
 catch(error){unlinkSync(target);throw error}
}finally{db.close()}
