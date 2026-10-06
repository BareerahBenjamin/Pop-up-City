import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// 保留原业务层的 prepared statement 接口，实际只读写本服务 SQLite。
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(path);
  const applicationId = raw.prepare('PRAGMA application_id').get().application_id;
  const populated = raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get();
  if (applicationId !== 0x48504331 && (applicationId !== 0 || populated)) {
    raw.close();
    throw new Error('数据库不属于独立活动服务，拒绝修改；请选择新的数据库文件');
  }
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  function statement(query, args = []) {
    const stmt = raw.prepare(query);
    return {
      bind: (...values) => statement(query, values),
      first: () => stmt.get(...args) || null,
      all: () => ({ results: stmt.all(...args) }),
      run: () => { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
  }
  return {
    raw, prepare: statement,
    batch(statements) {
      raw.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.run()); raw.exec('COMMIT'); return results; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
    close: () => raw.close(),
  };
}

export function migrate(db) {
  const directory = new URL('./migrations/', import.meta.url);
  db.raw.exec('PRAGMA application_id=1213219633; CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
  for (const name of readdirSync(directory).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    const sql = readFileSync(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const old = db.raw.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name);
    if (old) { if (old.checksum !== checksum) throw new Error(`已应用迁移被修改：${name}`); continue; }
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      db.raw.exec(sql);
      db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name, checksum);
      db.raw.exec('COMMIT');
    } catch (error) { db.raw.exec('ROLLBACK'); throw error; }
  }
}

export function checkSchema(db) {
  // 服务启动只验证，迁移由显式管理命令完成。
  const missing = () => Object.assign(new Error('数据库有待执行迁移。请先备份，再运行 npm run migrate，然后运行 npm start。'), { code: 'SCHEMA_MIGRATION_REQUIRED' });
  if (!db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()) throw missing();
  const applied = db.raw.prepare('SELECT name,checksum FROM schema_migrations').all();
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(n => /^\d+.*\.sql$/.test(n))) {
    const checksum = createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex');
    const previous = applied.find(m => m.name === name);
    if (!previous) throw missing();
    if (previous.checksum !== checksum) throw Object.assign(new Error('已应用迁移的校验失败。请恢复原迁移文件；不要删除迁移记录或覆盖数据库。'), { code: 'SCHEMA_CHECKSUM_MISMATCH' });
  }
}
