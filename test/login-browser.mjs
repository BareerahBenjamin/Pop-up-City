// Optional browser regression. Uses an in-memory database and captures mail without sending it.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { openDatabase, migrate } from '../database.js';
import { loadConfig } from '../config.js';
import { createApplication } from '../server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3336', db = openDatabase(':memory:'); migrate(db);
const stamp = Math.floor(Date.now() / 1000), adminId = randomUUID(), token = randomBytes(32).toString('hex');
db.raw.prepare("INSERT INTO members(id,email,nickname,role,status,created_at,updated_at) VALUES(?,?,?,'admin','active',?,?)").run(adminId, 'admin@example.test', '测试管理员', stamp, stamp);
db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), adminId, stamp + 3600, stamp);
const messages = [], config = loadConfig({ AUTH_PEPPER: 'test-login-browser-pepper-0000000000000000', PUBLIC_ORIGIN: origin, FROM_EMAIL: 'noreply@example.test' });
const server = createApplication(config, { db, mailer: { send: async message => messages.push(message) } });
await new Promise(resolve => server.listen(3336, '127.0.0.1', resolve));
const out = process.env.BROWSER_OUTPUT || '/tmp/popup-login-browser-check'; mkdirSync(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.locator('#account').click();
  await page.locator('#login-request-form [name="email"]').fill('neighbor@example.test');
  await page.getByRole('button', { name: '获取登录邮件', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '该邮箱尚未导入' }).waitFor();
  assert.equal(await page.locator('#login-code-form').count(), 0);
  assert.equal(messages.length, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM login_challenges').get().n, 0);
  await page.screenshot({ path: `${out}/unimported-email-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/unimported-email-mobile.png` });
  const adminContext = await browser.newContext();
  await adminContext.addCookies([{ name: 'popup_city_session', value: token, url: origin }]);
  const admin = await adminContext.newPage(); await admin.goto(`${origin}/#admin`);
  await admin.locator('#import-form [name="rows"]').fill('neighbor@example.test,新邻居');
  await admin.locator('#import-form button[type="submit"], #import-form button:not([type])').click();
  await admin.waitForFunction(() => state.adminMembers.some(member => member.email === 'neighbor@example.test'));
  await page.getByRole('button', { name: '获取登录邮件', exact: true }).click();
  await page.locator('#login-code-form').waitFor(); assert.equal(messages.length, 1);
  await page.locator('#login-code-form [name="code"]').fill(/验证码是 (\d{6})/.exec(messages[0].text)[1]);
  await page.getByRole('button', { name: '验证并登录', exact: true }).click();
  await page.waitForFunction(() => state.me?.nickname === '新邻居');
  assert.deepEqual(errors, []);
  console.log('PASSED: unknown email stays on login form without mail/credentials; administrator imports email and nickname; member receives mock code and logs in; 375px layout.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
