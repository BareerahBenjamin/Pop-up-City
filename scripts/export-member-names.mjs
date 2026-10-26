// Run with the website's Node runtime and --env-file. Database access is read-only.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const databasePath = process.env.DATABASE_PATH;
if (!databasePath || !databasePath.startsWith('/')) {
  throw new Error('DATABASE_PATH must be an absolute path; load the production server.env');
}
const output = resolve(process.argv[2] || '/tmp/popcity-member-names.json');
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout=5000');
  const rows = db.prepare('SELECT nickname FROM members').all();
  const names = [...new Set(rows.map(row => String(row.nickname || '').normalize('NFC').trim()).filter(Boolean))].sort();
  const chineseCharacters = [...new Set(names.join('').match(/\p{Script=Han}/gu) || [])].sort();
  writeFileSync(output, JSON.stringify({
    format: 'popcity-member-names-v1',
    exported_at: new Date().toISOString(),
    member_count: rows.length,
    names,
    chinese_characters: chineseCharacters,
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Exported ${names.length} unique names, ${chineseCharacters.length} Chinese characters to ${output}`);
} finally {
  db.close();
}
