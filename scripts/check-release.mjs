// Uses in-memory data only. Does not read .env, open production DB or listen on a port.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { openDatabase, migrate, checkSchema } from '../database.js';
const require = createRequire(import.meta.url);
const renderer = require('../vendor/planet/frontend/ui-design/pixel-planet-renderer.js');
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 22 || major === 22 && minor >= 16, 'Node.js must be >= 22.16');
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('config/planet_asset_manifest_v1.json'));
assert.equal(sha(read('vendor/planet/frontend/ui-design/world/planet-world.js')), manifest.worldSha256);
assert.equal(sha(read('vendor/planet/frontend/ui-design/asset-registry.js')), manifest.registrySha256);
assert.ok(read('vendor/planet/frontend/ui-design/Herstory-星域-H5.html').toString().includes(manifest.modelVersion));
const db = openDatabase(':memory:');
try {
  migrate(db); checkSchema(db);
  const frames = [];
  const state = { paletteId: 'green', aiCheckinCount: 0, aiStage: 0, lakeUnlocked: false, ruleVersion: JSON.parse(read('vendor/planet/backend/pixel-planet/rules.json')).ruleVersion, stateVersion: 1 };
  for (const byteOrder of ['little', 'big']) {
    const bytes = Buffer.from(renderer.encodeRGB565(state, { width: 240, height: 320, byteOrder }).bytes);
    assert.equal(bytes.length, 153600); frames.push(bytes);
    const digest = sha(bytes);
    db.raw.prepare('INSERT OR IGNORE INTO members(id,email,nickname,created_at,updated_at) VALUES(?,?,?,?,?)').run('check-only', 'deploy@example.test', '检查', 1, 1);
    db.raw.prepare('INSERT OR IGNORE INTO member_planets(member_id,planet_id,palette_id,created_at) VALUES(?,?,?,?)').run('check-only', 'check-planet', 'green', 1);
    const version = byteOrder === 'little' ? 1 : 2;
    db.raw.prepare('INSERT INTO hardware_planet_frames VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('check-only', version, 1, 1, 240, 320, 'RGB565', byteOrder, renderer.RENDER_VERSION, digest, bytes.length, bytes, 1);
    const saved = db.raw.prepare('SELECT frame,sha256 FROM hardware_planet_frames WHERE member_id=? AND frame_version=?').get('check-only', version);
    assert.deepEqual(Buffer.from(saved.frame), bytes); assert.equal(sha(saved.frame), saved.sha256);
  }
  for (let i = 0; i < frames[0].length; i += 2) { assert.equal(frames[0][i], frames[1][i + 1]); assert.equal(frames[0][i + 1], frames[1][i]); }
  assert.equal(db.raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width, 2);
  console.log(JSON.stringify({ status: 'ok', node: process.version, platform: process.platform, arch: process.arch,
    migrations: db.raw.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,
    modelVersion: manifest.modelVersion, pixelFrame: { width: 240, height: 320, format: 'RGB565', bytes: 153600, byteOrders: ['little','big'], storage: 'SQLite BLOB' }, sharp: 'ok' }, null, 2));
} finally { db.close(); }
