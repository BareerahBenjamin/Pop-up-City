import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate, checkSchema } from '../database.js';

test('startup distinguishes pending migrations from checksum corruption without migrating implicitly', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => checkSchema(db), { code: 'SCHEMA_MIGRATION_REQUIRED' });
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
    migrate(db);
    assert.doesNotThrow(() => checkSchema(db));
    db.raw.prepare("DELETE FROM schema_migrations WHERE name='0007_profile_finalization.sql'").run();
    assert.throws(() => checkSchema(db), error => error.code === 'SCHEMA_MIGRATION_REQUIRED' && error.message.includes('npm run migrate'));
    db.raw.prepare("UPDATE schema_migrations SET checksum='altered' WHERE name='0001_initial.sql'").run();
    assert.throws(() => checkSchema(db), { code: 'SCHEMA_CHECKSUM_MISMATCH' });
  } finally { db.close(); }
});
