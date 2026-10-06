import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { MAX_COVER_BYTES, EVENT_BODY_LIMIT } from '../covers.js';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { openDatabase, migrate, checkSchema } from '../database.js';
import { loadConfig } from '../config.js';
import { createApplication } from '../server.js';
import { createMailer } from '../mail.js';

const baseEnv = { AUTH_PEPPER: 'test-only-pepper-never-for-production-012345', PUBLIC_ORIGIN: 'http://127.0.0.1:3300' };
const stamp = () => Math.floor(Date.now() / 1000);
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'popup-city-test-'));
  const db = openDatabase(join(directory, 'app.sqlite')); migrate(db); checkSchema(db);
  const config = loadConfig({ ...baseEnv, FROM_EMAIL: 'noreply@example.test', ...options.env });
  const messages = [];
  const mailer = options.disabled ? null : { send: async message => { if (options.mailFailure) throw options.mailFailure === true ? new Error('test mail failed') : options.mailFailure; messages.push(message); } };
  const server = createApplication(config, { db, mailer, ...options.app });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  function seed(email, role = 'member') {
    const id = randomUUID(); db.raw.prepare('INSERT INTO members(id,email,nickname,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, email, email.split('@')[0], role, stamp(), stamp()); return id;
  }
  async function call(path, { method = 'GET', body, cookie, origin = config.origin, headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  async function login(email) {
    assert.equal((await call('/api/auth/request', { method: 'POST', body: { email } })).status, 200);
    const message = messages.filter(m => m.to === email).at(-1);
    const code = /验证码是 (\d{6})/.exec(message.text)[1];
    const result = await call('/api/auth/verify', { method: 'POST', body: { email, code } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('set-cookie').includes(' Secure;'), config.secureCookies);
    return result.headers.get('set-cookie').split(';')[0];
  }
  return { db, directory, config, messages, base, call, seed, login };
}

test('configuration isolates host/ports and requires HTTPS in production', () => {
  for (const env of [{ HOST: '0.0.0.0' }, { PORT: '3000' }, { PORT: '3210' }, { AUTH_PEPPER: '' }, { PUBLIC_ORIGIN: 'http://example.com' }, { MAIL_MODE: 'console' }, { PUBLIC_ORIGIN: 'https://example.com/path' }]) {
    assert.throws(() => loadConfig({ ...baseEnv, ...env }));
  }
  assert.throws(() => loadConfig({ ...baseEnv, NODE_ENV: 'production', DATABASE_PATH: '/var/lib/new/app.sqlite' }));
  const production = loadConfig({ ...baseEnv, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://events.example.test', DATABASE_PATH: '/var/lib/new/app.sqlite' });
  assert.equal(production.secureCookies, true);
  assert.equal(createMailer(loadConfig(baseEnv)), null);
  assert.throws(() => createMailer(loadConfig({ ...baseEnv, MAIL_MODE: 'smtp' })));
});

test('management CLI creates only its database and refuses duplicate administrator changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'popup-city-cli-'));
  const env = { ...process.env, ...baseEnv, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3300', MAIL_MODE: 'disabled', DATABASE_PATH: join(directory, 'app.sqlite') };
  const run = args => spawnSync(process.execPath, [new URL('../manage.js', import.meta.url).pathname, ...args], { env, encoding: 'utf8' });
  try {
    assert.equal(run(['migrate']).status, 0);
    assert.equal(run(['admin', 'admin@example.test', '管理员']).status, 0);
    assert.notEqual(run(['admin', 'admin@example.test', '不应覆盖']).status, 0);
    const db = openDatabase(env.DATABASE_PATH);
    try { assert.equal(db.raw.prepare('SELECT nickname FROM members').get().nickname, '管理员'); }
    finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('migrations persist data, are repeatable, batch rolls back and rejects another app database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'popup-city-db-'));
  const path = join(directory, 'new.sqlite');
  let db;
  try {
    db = openDatabase(path); migrate(db);
    const id = randomUUID();
    db.raw.prepare('INSERT INTO members(id,email,nickname,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, 'keep@example.test', '保留', stamp(), stamp());
    migrate(db); db.close(); db = openDatabase(path); checkSchema(db);
    assert.equal(db.raw.prepare('SELECT nickname FROM members WHERE id=?').get(id).nickname, '保留');
    assert.throws(() => db.batch([
      db.prepare('UPDATE members SET nickname=? WHERE id=?').bind('不应保存', id),
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind('invalid', 'missing-member', stamp(), stamp()),
    ]));
    assert.equal(db.raw.prepare('SELECT nickname FROM members WHERE id=?').get(id).nickname, '保留');
    const foreign = join(directory, 'existing.sqlite'); const other = new DatabaseSync(foreign);
    other.exec('CREATE TABLE existing_program (id INTEGER)'); other.close();
    const before = readFileSync(foreign);
    assert.throws(() => openDatabase(foreign), /不属于独立活动服务/);
    assert.deepEqual(readFileSync(foreign), before);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP serves original page/assets, health and public events; protects private paths and origin', async t => {
  const f = await fixture(t, { disabled: true });
  assert.equal((await f.call('/')).status, 200);
  assert.match((await f.call('/')).data, /Herstory Pop-up City/);
  for (const path of ['/app.js', '/site.css', '/avatar.css', '/production.css', '/tokens.css', '/festival.css', '/assets/series/festival-title.png', '/assets/series/herstory-logo.png', '/assets/avatar-preview-catalog.js']) assert.equal((await f.call(path)).status, 200, path);
  assert.deepEqual((await f.call('/api/events')).data, { events: [] });
  assert.equal((await f.call('/healthz')).data.mail_configured, false);
  for (const path of ['/.env', '/api.js', '/data/popup-city.sqlite', '/%2e%2e%2f.env', '/missing']) assert.equal((await f.call(path)).status, 404, path);
  assert.equal((await f.call('/api/me')).status, 401);
  assert.equal((await f.call('/api/auth/request', { method: 'POST', body: { email: 'a@example.test' } })).status, 403);
  f.seed('invited@example.test');
  assert.equal((await f.call('/api/auth/request', { method: 'POST', body: { email: 'invited@example.test' } })).status, 503);
  assert.equal((await f.call('/api/auth/request', { method: 'POST', origin: 'https://wrong.test', body: {} })).status, 403);
  assert.equal((await f.call('/api/events', { method: 'POST', body: {} })).status, 401);
});

test('static server refuses symlink escape', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'popup-city-static-')); const root = join(directory, 'public'); mkdirSync(root);
  writeFileSync(join(directory, 'secret.js'), 'PRIVATE'); symlinkSync(join(directory, 'secret.js'), join(root, 'leak.js'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = await fixture(t, { app: { staticRoot: root } });
  assert.equal((await f.call('/leak.js')).status, 404);
});

test('one-time email login, separate secure cookie, logout and request throttling', async t => {
  const f = await fixture(t, { env: { PUBLIC_ORIGIN: 'https://events.example.test' } });
  f.seed('admin@example.test', 'admin');
  const cookie = await f.login('admin@example.test');
  assert.match(cookie, /^popup_city_session=/);
  assert.equal((await f.call('/api/me', { cookie })).data.member.role, 'admin');
  assert.equal((await f.call('/api/me', { cookie: cookie.replace('popup_city_session', 'herstory_session') })).status, 401);
  const message = f.messages[0], code = /验证码是 (\d{6})/.exec(message.text)[1];
  assert.equal((await f.call('/api/auth/verify', { method: 'POST', body: { email: 'admin@example.test', code } })).status, 400);
  await f.call('/api/auth/request', { method: 'POST', body: { email: 'admin@example.test' } });
  assert.equal(f.messages.length, 1);
  const logout = await f.call('/api/auth/logout', { method: 'POST', cookie });
  assert.match(logout.headers.get('set-cookie'), /Secure/);
  assert.equal((await f.call('/api/me', { cookie })).status, 401);
});

test('login requires administrator import of email and nickname; disabled members cannot request credentials', async t => {
  const f = await fixture(t); f.seed('admin@example.test', 'admin');
  const admin = await f.login('admin@example.test');
  const counts = () => ['members', 'login_challenges', 'sessions'].map(table => f.db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  const before = counts(), sent = f.messages.length;
  const denied = await f.call('/api/auth/request', { method: 'POST', body: { email: ' NewMember@Example.Test ' } });
  assert.equal(denied.status, 403); assert.match(denied.data.error, /后台导入.*邮箱和昵称/);
  assert.equal((await f.call('/api/auth/verify', { method: 'POST', body: { email: 'newmember@example.test', code: '123456' } })).status, 400);
  assert.deepEqual(counts(), before); assert.equal(f.messages.length, sent);
  assert.equal((await f.call('/api/admin/members/import', { method: 'POST', body: { members: [{ email: 'newmember@example.test', nickname: '新邻居' }] } })).status, 403);
  for (const nickname of [undefined, '', '   ']) {
    assert.equal((await f.call('/api/admin/members/import', { method: 'POST', cookie: admin, body: { members: [{ email: 'valid@example.test', nickname: '有效' }, { email: 'newmember@example.test', nickname }] } })).status, 400);
    assert.deepEqual(counts(), before);
  }
  const imported = await f.call('/api/admin/members/import', { method: 'POST', cookie: admin, body: { members: [{ email: ' NewMember@Example.Test ', nickname: '新邻居' }] } });
  assert.equal(imported.data.imported, 1);
  const request = await f.call('/api/auth/request', { method: 'POST', body: { email: ' NewMember@Example.Test ' } });
  assert.equal(request.status, 200); assert.equal(f.messages.length, sent + 1);
  const code = /验证码是 (\d{6})/.exec(f.messages.at(-1).text)[1];
  const token = /\/login#([a-f0-9]{64})/.exec(f.messages.at(-1).text)[1];
  const member = f.db.raw.prepare('SELECT id,nickname FROM members WHERE email=?').get('newmember@example.test');
  assert.equal(member.nickname, '新邻居');
  assert.equal((await f.call(`/api/admin/members/${member.id}/status`, { method: 'PATCH', cookie: admin, body: { status: 'disabled' } })).status, 200);
  const disabledCounts = counts();
  const disabled = await f.call('/api/auth/request', { method: 'POST', body: { email: 'newmember@example.test' } });
  assert.equal(disabled.status, 403); assert.match(disabled.data.error, /已停用/);
  assert.equal((await f.call('/api/auth/verify', { method: 'POST', body: { email: 'newmember@example.test', code } })).status, 400);
  assert.equal((await f.call('/api/auth/redeem', { method: 'POST', body: { token } })).status, 400);
  assert.deepEqual(counts(), disabledCounts); assert.equal(f.messages.length, sent + 1);
  await f.call(`/api/admin/members/${member.id}/status`, { method: 'PATCH', cookie: admin, body: { status: 'active' } });
  const verified = await f.call('/api/auth/verify', { method: 'POST', body: { email: 'NEWMember@example.test', code } });
  assert.equal(verified.status, 200);
  assert.equal((await f.call('/api/me', { cookie: verified.headers.get('set-cookie').split(';')[0] })).data.member.nickname, '新邻居');
});

test('magic link works once; disabled member cannot redeem a previously issued link', async t => {
  const f = await fixture(t); const id = f.seed('member@example.test');
  await f.call('/api/auth/request', { method: 'POST', body: { email: 'member@example.test' } });
  const token = /\/login#([a-f0-9]{64})/.exec(f.messages[0].text)[1];
  f.db.raw.prepare("UPDATE members SET status='disabled' WHERE id=?").run(id);
  assert.equal((await f.call('/api/auth/redeem', { method: 'POST', body: { token } })).status, 400);
  f.db.raw.prepare("UPDATE members SET status='invited' WHERE id=?").run(id);
  const redeemed = await f.call('/api/auth/redeem', { method: 'POST', body: { token } });
  assert.equal(redeemed.status, 200);
  assert.doesNotMatch(redeemed.headers.get('set-cookie'), /Secure/);
  assert.equal((await f.call('/api/auth/redeem', { method: 'POST', body: { token } })).status, 400);
});

test('five wrong codes exhaust challenge, failed SMTP removes challenge, JSON is bounded', async t => {
  const f = await fixture(t); f.seed('member@example.test');
  await f.call('/api/auth/request', { method: 'POST', body: { email: 'member@example.test' } });
  const code = /验证码是 (\d{6})/.exec(f.messages[0].text)[1];
  for (let i = 0; i < 5; i++) assert.equal((await f.call('/api/auth/verify', { method: 'POST', body: { email: 'member@example.test', code: code === '000000' ? '111111' : '000000' } })).status, 400);
  assert.equal((await f.call('/api/auth/verify', { method: 'POST', body: { email: 'member@example.test', code } })).status, 400);
  assert.equal((await f.call('/api/auth/request', { method: 'POST', body: { email: 'a'.repeat(17000) } })).status, 413);
  const raw = await fetch(f.base + '/api/auth/request', { method: 'POST', headers: { Origin: f.config.origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(raw.status, 400); await raw.text();
  const chunked = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/api/auth/request', { method: 'POST', headers: { Origin: f.config.origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.write('x'.repeat(10000)); request.end('x'.repeat(10000));
  });
  assert.equal(chunked, 413);
  const failed = await fixture(t, { mailFailure: true }); failed.seed('failed@example.test');
  assert.equal((await failed.call('/api/auth/request', { method: 'POST', body: { email: 'failed@example.test' } })).status, 503);
  assert.equal(failed.db.raw.prepare('SELECT COUNT(*) AS n FROM login_challenges').get().n, 0);
});

test('mail failures give a safe 503, remove the challenge, and allow login after recovery', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const privateMarker = 'PRIVATE_EMAIL_PASSWORD_CODE_AND_LINK';
  for (const [code, responseCode, expected] of [['EAUTH', 535, 'EAUTH'], ['ETIMEDOUT', undefined, 'ETIMEDOUT'], [privateMarker, privateMarker, 'UNKNOWN']]) {
    const options = { mailFailure: Object.assign(new Error(privateMarker), { code, responseCode, response: privateMarker, command: privateMarker }) };
    const f = await fixture(t, options); f.seed('failure@example.test');
    const result = await f.call('/api/auth/request', { method: 'POST', body: { email: 'failure@example.test' } });
    assert.equal(result.status, 503);
    assert.match(result.data.error, /登录邮件暂时无法发送/);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS n FROM login_challenges').get().n, 0);
    assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(f.messages.length, 0);
    assert.ok(logs.at(-1).includes(`"code":"${expected}"`));
    assert.ok(!JSON.stringify(result.data).includes(privateMarker));
    assert.ok(!logs.join('\n').includes(privateMarker));
    assert.ok(!logs.join('\n').includes('failure@example.test'));
    options.mailFailure = false;
    await f.login('failure@example.test');
    assert.equal(f.messages.length, 1);
  }
});

test('member import, event review, concurrent capacity, edit, task, device check-in and revocation', async t => {
  const f = await fixture(t); f.seed('admin@example.test', 'admin');
  const admin = await f.login('admin@example.test');
  const imported = await f.call('/api/admin/members/import', { method: 'POST', cookie: admin, body: { members: [{ email: 'alice@example.test', nickname: 'Alice' }, { email: 'bob@example.test', nickname: 'Bob' }] } });
  assert.equal(imported.data.imported, 2);
  const alice = await f.login('alice@example.test'), bob = await f.login('bob@example.test');
  const aliceId = (await f.call('/api/me', { cookie: alice })).data.member.id;
  assert.equal((await f.call('/api/admin/members', { cookie: alice })).status, 403);
  const event = { title: '独立部署验证', description: '测试活动', category: '共创', location: '景德镇', starts_at: stamp() + 100, ends_at: stamp() + 3600, capacity: 1, volunteer_capacity: 1 };
  const created = await f.call('/api/events', { method: 'POST', cookie: alice, body: { ...event, official: true } });
  assert.equal(created.status, 201); const id = created.data.event.id;
  assert.equal(created.data.event.status, 'pending'); assert.equal(created.data.event.official, 0);
  assert.equal((await f.call('/api/events')).data.events.length, 0);
  assert.equal((await f.call(`/api/events/${id}`, { cookie: bob })).status, 404);
  assert.equal((await f.call(`/api/events/${id}/attendees`, { method: 'POST', cookie: alice })).status, 409);
  await f.call(`/api/admin/events/${id}`, { method: 'PATCH', cookie: admin, body: { status: 'published', official: true } });
  assert.equal((await f.call('/api/events')).data.events.length, 1);
  const registrations = await Promise.all([alice, bob].map(cookie => f.call(`/api/events/${id}/attendees`, { method: 'POST', cookie })));
  assert.deepEqual(registrations.map(r => r.status).sort(), [200, 409]);
  // 清理本测试的报名，再验证指定设备对应成员。
  await f.call(`/api/events/${id}/attendees`, { method: 'DELETE', cookie: bob });
  await f.call(`/api/events/${id}/attendees`, { method: 'POST', cookie: alice });
  assert.equal((await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: admin, body: event })).status, 200);
  assert.equal((await f.call(`/api/members/${aliceId}`, { cookie: alice })).status, 200);
  const task = await f.call('/api/tasks', { method: 'POST', cookie: alice, body: { title: '布置', description: '摆桌子', category: '现场', location: '大厅', deadline: stamp() + 1000, capacity: 1 } });
  assert.equal(task.status, 201);
  assert.equal((await f.call(`/api/tasks/${task.data.id}/claims`, { method: 'POST', cookie: alice })).status, 200);
  assert.equal((await f.call(`/api/tasks/${task.data.id}/claims`, { method: 'POST', cookie: bob })).status, 409);
  assert.equal((await f.call(`/api/tasks/${task.data.id}/complete`, { method: 'POST', cookie: alice })).status, 200);
  assert.equal((await f.call(`/api/members/${aliceId}`, { cookie: alice })).data.completed_tasks.length, 1);
  await f.call(`/api/admin/events/${id}/checkin-pin`, { method: 'PUT', cookie: admin, body: { pin: '123456' } });
  const device = await f.call(`/api/admin/members/${aliceId}/devices`, { method: 'POST', cookie: admin });
  assert.equal(device.status, 201);
  const headers = { Authorization: `Bearer ${device.data.token}` };
  assert.equal((await f.call('/api/device/me', { headers })).status, 200);
  const checkin = { event_id: id, pin: '123456', request_id: 'test-checkin-1' };
  assert.equal((await f.call('/api/device/checkins', { method: 'POST', headers, body: { ...checkin, pin: '000000' } })).status, 403);
  for (let i = 0; i < 2; i++) assert.equal((await f.call('/api/device/checkins', { method: 'POST', headers, body: checkin })).status, 200);
  assert.equal((await f.call(`/api/admin/events/${id}/roster`, { cookie: admin })).data.checkins.length, 1);
  assert.equal((await f.call(`/api/admin/events/${id}/audit`, { cookie: admin })).data.history.length, 3);
  assert.equal(f.db.raw.prepare('SELECT token_hash FROM devices WHERE id=?').get(device.data.device_id).token_hash, hash(device.data.token));
  const bobId = (await f.call('/api/me', { cookie: bob })).data.member.id;
  const bobDevice = await f.call(`/api/admin/members/${bobId}/devices`, { method: 'POST', cookie: admin });
  const bobHeaders = { Authorization: `Bearer ${bobDevice.data.token}` };
  const social = await f.call('/api/device/social-code', { method: 'POST', headers: bobHeaders, body: {} });
  assert.equal(social.status, 200);
  const connect = { code: social.data.code, request_id: 'connect-once' };
  const connection = await f.call('/api/device/connections', { method: 'POST', headers, body: connect });
  assert.equal(connection.status, 200);
  assert.equal((await f.call('/api/device/connections', { method: 'POST', headers, body: connect })).data.connection_id, connection.data.connection_id);
  assert.equal((await f.call('/api/me/records', { cookie: bob })).data.connections.length, 1);
  assert.equal((await f.call('/api/device/connections', { method: 'POST', headers, body: { ...connect, request_id: 'different' } })).status, 400);
  await f.call(`/api/admin/devices/${device.data.device_id}`, { method: 'DELETE', cookie: admin });
  assert.equal((await f.call('/api/device/me', { headers })).status, 401);
});

const coverEvent = () => ({ title: '封面测试活动', description: '仅测试封面', category: '共创', location: '测试空间', starts_at: stamp() + 100, ends_at: stamp() + 3600, capacity: 8, volunteer_capacity: 2 });
const dataImage = (buffer, format = 'png') => `data:image/${format};base64,${buffer.toString('base64')}`;

test('event cover lifecycle: atomic save, visibility, re-encoding, unchanged edits, replacement and removal', async t => {
  const f = await fixture(t);
  f.seed('cover-admin@example.test', 'admin');f.seed('cover-host@example.test');f.seed('cover-other@example.test');
  const admin = await f.login('cover-admin@example.test'), host = await f.login('cover-host@example.test'), other = await f.login('cover-other@example.test');
  const source = await sharp(randomBytes(600 * 400 * 3), { raw: { width: 600, height: 400, channels: 3 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const input = { ...coverEvent(), cover: dataImage(source, 'jpeg') };
  assert.ok(JSON.stringify(input).length > 16000, 'cover exceeds old JSON request limit');
  assert.equal((await f.call('/api/events', { method: 'POST', body: input })).status, 401);
  assert.equal((await f.call('/api/events', { method: 'POST', cookie: host, origin: 'https://wrong.test', body: input })).status, 403);
  const created = await f.call('/api/events', { method: 'POST', cookie: host, body: input });
  assert.equal(created.status, 201);assert.equal(created.data.event.status, 'pending');
  const id = created.data.event.id, url = created.data.event.cover_url;
  assert.match(url, /^\/api\/events\/[a-f0-9-]{36}\/cover\?v=[a-f0-9-]{36}$/);
  assert.equal((await f.call(url)).status, 404);
  assert.equal((await f.call(url, { cookie: other })).status, 404);
  assert.equal((await f.call(url, { cookie: admin })).status, 200);
  const response = await fetch(f.base + url, { headers: { Cookie: host } });
  assert.equal(response.status, 200);assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'no-store');assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const stored = Buffer.from(await response.arrayBuffer());const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, 'webp');assert.equal(metadata.width, 400);assert.equal(metadata.height, 600);
  assert.equal(metadata.exif, undefined);assert.equal(metadata.orientation, undefined);assert.equal(metadata.icc, undefined);
  const separate = openDatabase(join(f.directory, 'app.sqlite'));
  try { assert.deepEqual(Buffer.from(separate.raw.prepare('SELECT image FROM event_covers WHERE event_id=?').get(id).image), stored); } finally { separate.close(); }
  assert.equal((await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: other, body: { ...coverEvent(), cover: null } })).status, 403);
  await f.call(`/api/admin/events/${id}`, { method: 'PATCH', cookie: admin, body: { status: 'published' } });
  assert.equal((await f.call(url)).status, 200);
  const head = await fetch(f.base + url, { method: 'HEAD' });assert.equal(head.status, 200);assert.equal(await head.text(), '');
  const listed = (await f.call('/api/events')).data.events[0];assert.equal(listed.cover_url, url);assert.equal(listed.image, undefined);
  assert.equal((await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: admin, body: coverEvent() })).data.event.cover_url, url);
  // 成员编辑仍需审核，旧封面地址也不能绕过审核访问。
  await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: host, body: coverEvent() });
  assert.equal((await f.call(url)).status, 404);
  const png = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#ec91ba' } }).png().toBuffer();
  const replaced = await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: host, body: { ...coverEvent(), cover: dataImage(png) } });
  assert.equal(replaced.status, 200);assert.notEqual(replaced.data.event.cover_url, url);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_covers WHERE event_id=?').get(id).n, 1);
  const removed = await f.call(`/api/events/${id}`, { method: 'PATCH', cookie: admin, body: { ...coverEvent(), cover: null } });
  assert.equal(removed.status, 200);assert.equal(removed.data.event.cover_url, null);
  assert.equal((await f.call(url, { cookie: host })).status, 404);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_covers').get().n, 0);
});

test('covers reject invalid, oversized, animated and excessive-pixel images without losing existing data', async t => {
  const f = await fixture(t); f.seed('image-admin@example.test', 'admin');const cookie = await f.login('image-admin@example.test');
  const valid = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#ea83ab' } }).png().toBuffer();
  const created = await f.call('/api/events', { method: 'POST', cookie, body: { ...coverEvent(), cover: dataImage(valid) } });
  const id = created.data.event.id, url = created.data.event.cover_url;
  const tooManyPixels = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const animated = await sharp(Buffer.concat([Buffer.alloc(300, 0), Buffer.alloc(300, 255)]), { raw: { width: 10, height: 20, channels: 3, pageHeight: 10 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  const bad = [
    'https://example.com/external.jpg', 123, {}, '',
    dataImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    dataImage(valid, 'jpeg'), dataImage(valid.subarray(0, 40)),
    dataImage(Buffer.alloc(MAX_COVER_BYTES + 1)), dataImage(tooManyPixels), dataImage(animated, 'webp'),
  ];
  for (const [index, cover] of bad.entries()) {
    const result = await f.call(`/api/events/${id}`, { method: 'PATCH', cookie, body: { ...coverEvent(), title: '不得覆盖', cover } });
    assert.equal(result.status, 400, `invalid fixture ${index}: ${result.data.error || 'unexpected success'}`);
    const current = (await f.call(`/api/events/${id}`)).data.event;
    assert.equal(current.cover_url, url);assert.equal(current.title, '封面测试活动');
  }
  const huge = await f.call('/api/events', { method: 'POST', cookie, body: { ...coverEvent(), cover: 'x'.repeat(EVENT_BODY_LIMIT) } });
  assert.equal(huge.status, 413);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
  f.db.raw.exec("CREATE TRIGGER fail_cover BEFORE INSERT ON event_covers BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const failed = await f.call('/api/events', { method: 'POST', cookie, body: { ...coverEvent(), cover: dataImage(valid) } });
  assert.equal(failed.status, 500);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
});

test('cover migration preserves activities from the original schema', () => {
  const db = openDatabase(':memory:');
  try {
    const initial = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
    db.raw.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
    db.raw.exec(initial);db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('0001_initial.sql', hash(initial));
    db.raw.prepare('INSERT INTO members(id,email,nickname,created_at,updated_at) VALUES(?,?,?,?,?)').run('host', 'old@example.test', '旧成员', stamp(), stamp());
    db.raw.prepare("INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,host_id,status,created_at,updated_at) VALUES('existing','旧活动','介绍','共创','现场',1,2,8,'host','published',1,1)").run();
    migrate(db);migrate(db);checkSchema(db);
    assert.equal(db.raw.prepare('SELECT title FROM events WHERE id=?').get('existing').title, '旧活动');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM event_covers').get().n, 0);
  } finally { db.close(); }
});

test('super admin delegation, revocation, protection, idempotence and rollback', async t => {
  const f=await fixture(t),ownerId=f.seed('owner@example.test','admin'),adminId=f.seed('operator@example.test','admin'),memberId=f.seed('neighbor@example.test');
  f.db.raw.prepare('UPDATE members SET is_super_admin=1 WHERE id=?').run(ownerId);
  const owner=await f.login('owner@example.test'),admin=await f.login('operator@example.test'),member=await f.login('neighbor@example.test');
  assert.equal((await f.call('/api/me',{cookie:owner})).data.member.is_super_admin,true);
  const path=`/api/admin/members/${memberId}/role`,change=(cookie,role)=>f.call(path,{method:'PATCH',cookie,body:{role}});
  for(const cookie of [undefined,admin,member])assert.equal((await change(cookie,'admin')).status,403);
  for(const role of ['super_admin','',true,null])assert.equal((await change(owner,role)).status,400);
  assert.equal((await f.call(path,{method:'PATCH',cookie:owner,origin:'https://wrong.test',body:{role:'admin'}})).status,403);
  assert.equal((await f.call(`/api/admin/members/${randomUUID()}/role`,{method:'PATCH',cookie:owner,body:{role:'admin'}})).status,404);
  assert.equal((await f.call(`/api/admin/members/${ownerId}/role`,{method:'PATCH',cookie:owner,body:{role:'member'}})).status,409);
  for(const cookie of [admin,owner])assert.equal((await f.call(`/api/admin/members/${ownerId}/status`,{method:'PATCH',cookie,body:{status:'disabled'}})).status,403);
  assert.equal((await f.call(`/api/admin/members/${ownerId}`,{method:'PATCH',cookie:admin,body:{nickname:'不得改'}})).status,403);
  assert.ok((await Promise.all([change(owner,'admin'),change(owner,'admin')])).every(r=>r.status===200));
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM member_role_audit').get().n,1);
  assert.equal((await f.call('/api/admin/members',{cookie:member})).status,200);
  assert.equal((await f.call(`/api/admin/members/${adminId}/role`,{method:'PATCH',cookie:member,body:{role:'member'}})).status,403);
  assert.equal((await change(owner,'member')).status,200);
  assert.equal((await f.call('/api/admin/members',{cookie:member})).status,403);
  await f.call(`/api/admin/members/${memberId}/status`,{method:'PATCH',cookie:owner,body:{status:'disabled'}});
  assert.equal((await change(owner,'admin')).status,409);
  await f.call(`/api/admin/members/${memberId}/status`,{method:'PATCH',cookie:owner,body:{status:'active'}});
  f.db.raw.exec("CREATE TRIGGER fail_role_audit BEFORE INSERT ON member_role_audit BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await change(owner,'admin')).status,500);
  assert.equal(f.db.raw.prepare('SELECT role FROM members WHERE id=?').get(memberId).role,'member');
});

test('interest persistence, privacy, concurrent retries, removal and late action rejection', async t => {
  const f=await fixture(t);f.seed('interest-admin@example.test','admin');f.seed('interest-a@example.test');f.seed('interest-b@example.test');
  const admin=await f.login('interest-admin@example.test'),alice=await f.login('interest-a@example.test'),bob=await f.login('interest-b@example.test');
  const memberId=(await f.call('/api/me',{cookie:alice})).data.member.id;
  const event=(await f.call('/api/events',{method:'POST',cookie:admin,body:coverEvent()})).data.event,id=event.id,path=`/api/events/${id}/interest`;
  assert.equal((await f.call(path,{method:'POST'})).status,401);
  assert.equal((await f.call(path,{method:'POST',cookie:alice,origin:'https://wrong.test'})).status,403);
  assert.ok((await Promise.all([1,2,3].map(()=>f.call(path,{method:'POST',cookie:alice})))).every(r=>r.status===200));
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_interests').get().n,1);
  for(const [cookie,expected] of [[alice,1],[bob,0],[undefined,0]])assert.equal((await f.call('/api/events',{cookie})).data.events[0].my_interested,expected);
  const reopened=openDatabase(join(f.directory,'app.sqlite'));assert.equal(reopened.raw.prepare('SELECT member_id FROM event_interests').get().member_id,memberId);reopened.close();
  const draft=(await f.call('/api/events',{method:'POST',cookie:alice,body:coverEvent()})).data.event;
  assert.equal((await f.call(`/api/events/${draft.id}/interest`,{method:'POST',cookie:alice})).status,409);
  await f.call(`/api/events/${id}/attendees`,{method:'POST',cookie:alice});
  await f.call(`/api/admin/events/${id}/checkin-pin`,{method:'PUT',cookie:admin,body:{pin:'123456'}});
  const device=(await f.call(`/api/admin/members/${memberId}/devices`,{method:'POST',cookie:admin})).data;
  f.db.raw.prepare('UPDATE events SET starts_at=? WHERE id=?').run(stamp()-1,id);
  for(const endpoint of ['interest','attendees','volunteers'])assert.equal((await f.call(`/api/events/${id}/${endpoint}`,{method:'POST',cookie:bob})).status,409,endpoint);
  assert.equal((await f.call('/api/device/checkins',{method:'POST',headers:{Authorization:`Bearer ${device.token}`},body:{event_id:id,pin:'123456',request_id:'late-checkin'}})).status,409);
  for(let i=0;i<2;i++)assert.equal((await f.call(path,{method:'DELETE',cookie:alice})).status,200);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM event_interests').get().n,0);
});

test('QR exposes only published links; login uses the selected sender', async t => {
  assert.equal(loadConfig(baseEnv).fromEmail,'info@0xherstory.cn');
  const f=await fixture(t,{env:{FROM_EMAIL:'info@0xherstory.cn'}});f.seed('qr-admin@example.test','admin');f.seed('qr-member@example.test');
  const admin=await f.login('qr-admin@example.test'),member=await f.login('qr-member@example.test');
  assert.equal(f.messages[0].from,'info@0xherstory.cn');
  const published=(await f.call('/api/events',{method:'POST',cookie:admin,body:coverEvent()})).data.event;
  const draft=(await f.call('/api/events',{method:'POST',cookie:member,body:coverEvent()})).data.event;
  assert.equal((await f.call(`/api/events/${draft.id}/qr`,{cookie:member})).status,404);
  const response=await fetch(`${f.base}/api/events/${published.id}/qr`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,384);assert.equal(meta.format,'png');
  await f.call(`/api/admin/events/${published.id}`,{method:'PATCH',cookie:admin,body:{status:'cancelled',reason:'测试取消'}});
  assert.equal((await f.call(`/api/events/${published.id}/qr`)).status,404);
});

test('role migration retains users and sessions, upgrades only first enabled admin, and is repeatable',()=>{
  const db=openDatabase(':memory:');
  try{
    db.raw.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
    for(const name of ['0001_initial.sql','0002_event_covers.sql']){const sql=readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');db.raw.exec(sql);db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name,hash(sql))}
    for(const [id,role,status,created] of [['disabled','admin','disabled',1],['owner','admin','active',2],['operator','admin','active',3],['member','member','active',4]])db.raw.prepare('INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,`${id}@example.test`,id,role,status,created,created);
    db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('session','owner',stamp()+1000,stamp());
    migrate(db);migrate(db);checkSchema(db);
    assert.deepEqual(db.raw.prepare('SELECT id FROM members WHERE is_super_admin=1').all().map(x=>x.id),['owner']);
    assert.equal(db.raw.prepare('SELECT member_id FROM sessions').get().member_id,'owner');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM members').get().n,4);
    assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close()}
});

test('admin bulk events validate all rows, commit atomically, and retry without duplicates', async t => {
  const f=await fixture(t);f.seed('bulk-admin@example.test','admin');f.seed('bulk-member@example.test');
  const admin=await f.login('bulk-admin@example.test'),member=await f.login('bulk-member@example.test');
  const make=title=>({title,description:'批量导入说明',category:'学习',location:'共创空间',starts_at:stamp()+86400,ends_at:stamp()+90000,capacity:12,volunteer_capacity:2,official:true});
  const input={request_id:randomUUID(),status:'published',events:[make('批量一'),make('批量二')]};
  const post=(body,cookie=admin)=>f.call('/api/admin/events/import',{method:'POST',body,cookie});
  assert.equal((await post(input,member)).status,403);
  assert.equal((await post({...input,preview:true})).data.count,2);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM events').get().n,0);
  const invalid=await post({...input,events:[input.events[0],{...input.events[1],capacity:0}]});assert.equal(invalid.status,400);assert.match(invalid.data.error,/第 2 行/);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM events').get().n,0);
  assert.equal((await post({...input,events:[make('重复'),make('重复')]})).status,400);
  assert.equal((await post({...input,events:[{...make('过期'),starts_at:stamp()-100}]})).status,400);
  assert.equal((await post({...input,events:Array.from({length:51},(_,i)=>make(String(i)))})).status,400);
  // Simulate an insert failing mid-batch: events, audit and batch record must all roll back.
  f.db.raw.exec("CREATE TRIGGER fail_test_import BEFORE INSERT ON events WHEN NEW.title='批量二' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await post(input)).status,500);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM events').get().n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM event_audit').get().n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM event_import_batches').get().n,0);
  f.db.raw.exec('DROP TRIGGER fail_test_import');
  const results=await Promise.all([post(input),post(input)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM events').get().n,2);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM event_audit').get().n,2);
  assert.equal((await post(input)).data.replayed,true);
  assert.equal((await post({...input,status:'pending'})).status,409);
  assert.equal((await post({...input,request_id:randomUUID()})).status,409);
  const pending=await post({...input,request_id:randomUUID(),status:'pending',events:[make('待审核批量')]});assert.equal(pending.status,201);
  assert.equal(f.db.raw.prepare('SELECT status FROM events WHERE id=?').get(pending.data.event_ids[0]).status,'pending');
});
