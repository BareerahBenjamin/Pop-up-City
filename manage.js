import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { openDatabase, migrate, checkSchema } from './database.js';

process.umask(0o077);
const command = process.argv[2];
if (!['migrate', 'admin'].includes(command)) throw new Error('用法：node manage.js migrate | admin <邮箱> <昵称>');
const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  if (command === 'migrate') { migrate(db); console.log('活动服务数据库迁移完成'); }
  else {
    checkSchema(db);
    const email = (process.argv[3] || '').trim().toLowerCase();
    const nickname = (process.argv[4] || '').trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nickname || nickname.length > 20) throw new Error('请输入有效邮箱和 1–20 字昵称');
    if (db.raw.prepare('SELECT 1 FROM members WHERE email=?').get(email)) throw new Error('该邮箱已存在；不会自动覆盖、提权或重新启用');
    const stamp = Math.floor(Date.now() / 1000);
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      const isSuper = db.raw.prepare('SELECT 1 FROM members WHERE is_super_admin=1').get() ? 0 : 1;
      db.raw.prepare("INSERT INTO members(id,email,nickname,role,is_super_admin,created_at,updated_at) VALUES(?,?,?,'admin',?,?,?)").run(randomUUID(), email, nickname, isSuper, stamp, stamp);
      db.raw.exec('COMMIT');
    } catch (error) { db.raw.exec('ROLLBACK'); throw error; }
    console.log('管理员已建立；需通过已配置的邮箱验证登录');
  }
} finally { db.close(); }
