import {notificationRoute} from '../hardware-cloud/notifications.mjs';
import {hostBatchRoute} from '../hardware-cloud/host-batches.mjs';
import {runtimeRoute} from '../hardware-cloud/runtime.mjs';
import {enrollmentRoute,enrollmentAdminRoute} from '../device-enrollment.js';
import {cloudRoute,cloudAdminRoute} from '../hardware-cloud.js';
import {hardwareRoute,hardwareAdminRoute} from '../hardware.js';
import {growthTransaction} from '../planet-growth.js';
import {planetSnapshotInTransaction} from '../planet.js';
const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export class DeviceApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new DeviceApiError(status, message); };
const str = (value, max, label, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${label}不合法`);
  return value.trim();
};
const sql = (db, query, ...args) => db.prepare(query).bind(...args);
const first = (db, query, ...args) => sql(db, query, ...args).first();
const all = async (db, query, ...args) => (await sql(db, query, ...args).all()).results;
const run = (db, query, ...args) => sql(db, query, ...args).run();
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), x => x.toString(16).padStart(2, '0')).join(''); }
async function mac(secret, value) {
  if (!secret || secret.length < 32) fail(503, '服务尚未配置密钥');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
async function body(request) {
  const limit = 16000;
  if (Number(request.headers.get('content-length')) > limit) fail(413, '请求内容过大');
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, '需要 JSON 请求');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '请求内容为空');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      fail(413, '请求内容过大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'JSON 格式不正确'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, '需要 JSON 对象');
  return data;
}
async function deviceFromBearer(request, env) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) fail(401, '设备令牌无效');
  const device = await first(env.DB, `SELECT d.*,m.nickname,m.bio,m.card_public,m.avatar_json,m.status FROM devices d JOIN members m ON m.id=d.member_id WHERE d.token_hash=? AND d.revoked_at IS NULL AND m.status!='disabled'`, await digest(token));
  if (!device) fail(401, '设备令牌无效');
  return device;
}
async function connectionsFor(db, memberId) {
  return all(db, `SELECT MIN(c.id) id,MIN(c.connected_at) connected_at,m.id member_id,m.nickname FROM
    (SELECT id,from_member_id,to_member_id,connected_at FROM connections UNION ALL
      SELECT id,member_a_id,member_b_id,established_at FROM friendships) c
    JOIN members m ON m.id=CASE WHEN c.from_member_id=? THEN c.to_member_id ELSE c.from_member_id END
    WHERE (c.from_member_id=? OR c.to_member_id=?) AND m.status!='disabled'
    GROUP BY m.id,m.nickname ORDER BY connected_at DESC`, memberId, memberId, memberId);
}
async function deviceRoute(request, env, url) {
  const d = await deviceFromBearer(request, env), p = url.pathname, method = request.method;
  const feedback = await notificationRoute(request, env, url, d, body);
  if (feedback) return feedback;
  const runtime = await runtimeRoute(request, env, url, d);
  if (runtime) return runtime;
  const batch = await hostBatchRoute(request, env, url, d, body);
  if (batch) return batch;
  const hardware = await hardwareRoute(request, env, url, d, body);
  if (hardware) return hardware;
  if (method === 'GET' && p === '/api/device/me') return json({ member_id: d.member_id, nickname: d.nickname, bio: d.card_public ? d.bio : '', avatar: JSON.parse(d.avatar_json || '{}') });
  if (method === 'GET' && p === '/api/device/events') return json({ events: await all(env.DB, `SELECT e.id,e.title,e.starts_at,e.ends_at,e.location FROM events e JOIN event_registrations r ON r.event_id=e.id WHERE r.member_id=? AND r.kind='attendee' AND e.status='published' AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=e.id) ORDER BY e.starts_at`, d.member_id) });
  if (method === 'GET' && p === '/api/device/records') return json({ checkins: await all(env.DB, 'SELECT event_id,checked_at FROM checkins WHERE member_id=? ORDER BY checked_at DESC', d.member_id), connections: await connectionsFor(env.DB, d.member_id) });
  if (method === 'POST' && p === '/api/device/checkins') {
    const data = await body(request), eventId = str(data.event_id, 36, '活动 ID'), pin = str(data.pin, 6, '签到口令'), requestId = str(data.request_id, 80, '请求 ID');
    const e = await first(env.DB, 'SELECT * FROM events WHERE id=? AND NOT EXISTS (SELECT 1 FROM event_deletions d WHERE d.event_id=events.id)', eventId), stamp = now();
    if (!e || e.status !== 'published' || !e.venue_pin_hash || stamp < e.starts_at - 3600 || stamp >= e.starts_at) fail(409, '活动当前不可签到');
    if (!await first(env.DB, "SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=? AND kind='attendee'", eventId, d.member_id)) fail(403, '尚未报名此活动');
    const failures = await first(env.DB, 'SELECT COUNT(*) n FROM device_failed_codes WHERE device_id=? AND attempted_at>?', d.id, stamp - 600);
    if (failures.n >= 10) fail(429, '尝试次数过多，请稍后再试');
    if (await mac(env.AUTH_PEPPER, `venue:${eventId}:${pin}`) !== e.venue_pin_hash) { await run(env.DB, 'INSERT INTO device_failed_codes VALUES(?,?)', d.id, stamp); fail(403, '签到口令不正确'); }
    const snapshot=growthTransaction(env.DB,()=>{if(env.DB.raw.prepare('SELECT 1 FROM event_deletions WHERE event_id=?').get(eventId))fail(409,'活动已删除，不可签到');env.DB.raw.prepare('INSERT OR IGNORE INTO checkins VALUES(?,?,?,?,?)').run(eventId,d.member_id,d.id,stamp,requestId);return planetSnapshotInTransaction(env.DB,d.member_id);});
    return json({ status: 'checked_in', event_id: eventId, planet_revision:snapshot.revision,growth_status:snapshot.integration.growthStatus });
  }
  if (method === 'POST' && p === '/api/device/social-code') {
    await body(request); const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await run(env.DB, 'INSERT INTO social_codes VALUES(?,?,?,NULL)', await mac(env.AUTH_PEPPER, `social:${code}`), d.member_id, now() + 300);
    return json({ code, expires_at: now() + 300 });
  }
  if (method === 'POST' && p === '/api/device/connections') {
    const data = await body(request), code = str(data.code, 6, '社交码'), requestId = str(data.request_id, 80, '请求 ID');
    if (!/^\d{6}$/.test(code)) fail(400, '社交码不合法');
    const stamp = now(), failures = await first(env.DB, 'SELECT COUNT(*) n FROM device_failed_codes WHERE device_id=? AND attempted_at>?', d.id, stamp - 600);
    if (failures.n >= 10) fail(429, '尝试次数过多，请稍后再试');
    const existing = await first(env.DB, 'SELECT c.id,m.nickname FROM connections c JOIN members m ON m.id=c.to_member_id WHERE c.device_id=? AND c.request_id=?', d.id, requestId);
    if (existing) return json({ status: 'connected', connection_id: existing.id, nickname: existing.nickname, card: { nickname: existing.nickname } });
    const hash = await mac(env.AUTH_PEPPER, `social:${code}`), target = await first(env.DB, 'SELECT * FROM social_codes WHERE code_hash=?', hash);
    if (!target || target.used_at || target.expires_at <= stamp || target.member_id === d.member_id) {
      await run(env.DB, 'INSERT INTO device_failed_codes VALUES(?,?)', d.id, stamp); fail(400, '社交码无效');
    }
    const used = await run(env.DB, 'UPDATE social_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?', stamp, hash, stamp);
    if (!used.meta.changes) fail(409, '社交码已使用');
    const id = uid(); await run(env.DB, 'INSERT INTO connections VALUES(?,?,?,?,?,?)', id, d.member_id, target.member_id, d.id, stamp, requestId);
    const m = await first(env.DB, 'SELECT nickname,bio,card_public FROM members WHERE id=?', target.member_id);
    return json({ status: 'connected', connection_id: id, nickname: m.nickname, bio: m.card_public ? m.bio : '', card: { nickname: m.nickname, bio: m.card_public ? m.bio : '' } });
  }
  fail(404, '设备接口不存在');
}

export const isDevicePath=p=>p.startsWith('/api/device/')||p.startsWith('/local/')||p.startsWith('/api/device-enrollment/');
export async function deviceGateway(request,env,url=new URL(request.url)){
 const p=url.pathname;
 if(!isDevicePath(p))return null;
 if(!env.DB)fail(503,'数据库尚未配置');
 if(!env.AUTH_PEPPER||env.AUTH_PEPPER.length<32)fail(503,'服务尚未配置密钥');
 if(p.startsWith('/api/device-enrollment/'))return enrollmentRoute(request,env,url,body);
 if(p.startsWith('/local/'))return cloudRoute(request,env,url,await deviceFromBearer(request,env),body);
 return deviceRoute(request,env,url);
}
export async function deviceAdminGateway(request,env,url,user){
 // Caller authenticates administrator and checks browser Origin before dispatch.
 return await enrollmentAdminRoute(request,env,url,user,body)
  || await cloudAdminRoute(request,env,url,user,body)
  || await hardwareAdminRoute(request,env,url,user,body);
}
