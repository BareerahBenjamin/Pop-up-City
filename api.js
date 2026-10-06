import { PlanetGrowthError, growthTransaction, activatePlanetGrowth, configurePlanetEvent, reviewPlanetRole, correctPlanetFact, planetGrowthAdmin } from './planet-growth.js';
import { planetSnapshot, planetSnapshotInTransaction, planetDocument, completePlanetOnboarding, loginDestination } from './planet.js';
import { validFinalAvatar } from './profile.js';
import { hardwareRoute, hardwareAdminRoute, HardwareError } from './hardware.js';
import { changeMemberRole } from './roles.js';
import QRCode from 'qrcode';
import { prepareCover, bodyLimit } from './covers.js';

const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const str = (value, max, label, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${label}不合法`);
  return value.trim();
};
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label}不合法`);
  return value;
};
const email = value => {
  const v = str(value, 254, '邮箱').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, '邮箱不合法');
  return v;
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
  const limit = bodyLimit(request.method, new URL(request.url).pathname);
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
async function memberFromCookie(request, env) {
  const token = /(?:^|;\s*)popup_city_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token) return null;
  return first(env.DB, `SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? AND m.status!='disabled'`, await digest(token), now());
}
const requireMember = user => user || fail(401, '请先登录');
const requireAdmin = user => user?.role === 'admin' ? user : fail(403, '仅管理员可操作');
async function deviceFromBearer(request, env) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) fail(401, '设备令牌无效');
  const device = await first(env.DB, `SELECT d.*,m.nickname,m.bio,m.card_public,m.avatar_json,m.status FROM devices d JOIN members m ON m.id=d.member_id WHERE d.token_hash=? AND d.revoked_at IS NULL AND m.status!='disabled'`, await digest(token));
  if (!device) fail(401, '设备令牌无效');
  return device;
}
function profile(m, self = false) {
  const data = { id: m.id, nickname: m.nickname, bio: m.bio, skills: m.skills, needs: m.needs, avatar: JSON.parse(m.avatar_json || '{}') };
  if (self) Object.assign(data, { email: m.email, role: m.role, is_super_admin: Boolean(m.is_super_admin), status: m.status, card_public: Boolean(m.card_public), avatar_locked: m.profile_completed_at != null, profile_locked: false });
  return data;
}
function validateProfile(data) {
  const avatar = data.avatar ?? {};
  if (typeof avatar !== 'object' || !avatar || Array.isArray(avatar) || JSON.stringify(avatar).length > 4000) fail(400, '头像配置不合法');
  if (Object.keys(avatar).some(k => !['release','selection'].includes(k))) fail(400, '头像配置不合法');
  if (avatar.release !== undefined && (typeof avatar.release !== 'string' || avatar.release.length > 80)) fail(400, '头像版本不合法');
  if (avatar.selection !== undefined && (typeof avatar.selection !== 'object' || !avatar.selection || Array.isArray(avatar.selection) || Object.keys(avatar.selection).length > 30 || Object.entries(avatar.selection).some(([k,v]) => !/^hst_layer_[a-z_]{1,40}$/.test(k) || typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v)))) fail(400, '头像部件不合法');
  if (data.card_public !== undefined && typeof data.card_public !== 'boolean') fail(400, '名片公开设置不合法');
  return { nickname: str(data.nickname, 20, '昵称'), bio: str(data.bio ?? '', 160, '介绍', false), skills: str(data.skills ?? '', 100, '技能', false), needs: str(data.needs ?? '', 160, '期待', false), avatar: JSON.stringify(avatar), cardPublic: data.card_public };
}
async function eventDetail(db, id) {
  const e = await first(db, `SELECT e.*,c.version cover_version,m.nickname host_nickname,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.id AND r.kind='attendee') attendee_count,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.id AND r.kind='volunteer') volunteer_count
    FROM events e JOIN members m ON m.id=e.host_id LEFT JOIN event_covers c ON c.event_id=e.id WHERE e.id=?`, id);
  if (!e) fail(404, '活动不存在');
  delete e.venue_pin_hash;
  return withCoverUrl(e);
}
function withCoverUrl(event) {
  event.cover_url = event.cover_version ? `/api/events/${event.id}/cover?v=${event.cover_version}` : null;
  delete event.cover_version;
  return event;
}
async function validateCover(value) {
  try { return await prepareCover(value); }
  catch (error) { if ([400, 503].includes(error.status)) fail(error.status, error.message); throw error; }
}
function coverStatements(db, eventId, cover) {
  if (cover === undefined) return [];
  if (cover === null) return [sql(db, 'DELETE FROM event_covers WHERE event_id=?', eventId)];
  return [sql(db, `INSERT INTO event_covers(event_id,version,image) VALUES(?,?,?)
    ON CONFLICT(event_id) DO UPDATE SET version=excluded.version,image=excluded.image`, eventId, uid(), cover)];
}
async function connectionsFor(db, memberId) {
  return all(db, `SELECT MIN(c.id) id,MIN(c.connected_at) connected_at,m.id member_id,m.nickname FROM
    (SELECT id,from_member_id,to_member_id,connected_at FROM connections UNION ALL
      SELECT id,member_a_id,member_b_id,established_at FROM friendships) c
    JOIN members m ON m.id=CASE WHEN c.from_member_id=? THEN c.to_member_id ELSE c.from_member_id END
    WHERE (c.from_member_id=? OR c.to_member_id=?) AND m.status!='disabled'
    GROUP BY m.id,m.nickname ORDER BY connected_at DESC`, memberId, memberId, memberId);
}
async function audit(db, eventId, actorId, action, reason = '') { await run(db, 'INSERT INTO event_audit VALUES(?,?,?,?,?,?)', uid(), eventId, actorId, action, reason, now()); }
function validateEvent(data) {
  const starts = integer(data.starts_at, 1, 4102444800, '开始时间');
  const ends = integer(data.ends_at, starts + 1, 4102444800, '结束时间');
  return { title: str(data.title, 60, '标题'), description: str(data.description, 2000, '介绍'), category: str(data.category, 30, '类型'), location: str(data.location, 80, '地点'), starts, ends, capacity: integer(data.capacity, 1, 150, '名额'), volunteers: integer(data.volunteer_capacity ?? 0, 0, 30, '志愿者名额') };
}
function validateTask(data) { return { title: str(data.title, 60, '标题'), description: str(data.description, 2000, '说明'), category: str(data.category, 30, '类型'), location: str(data.location, 80, '地点'), deadline: integer(data.deadline, 1, 4102444800, '截止时间'), capacity: integer(data.capacity, 1, 150, '名额') }; }
async function sendLogin(env, member, code, token, origin) {
  if (!env.EMAIL || !env.FROM_EMAIL) fail(503, '邮件服务尚未配置');
  const link = `${origin}/login#${token}`;
  try {
    await env.EMAIL.send({ to: member.email, from: env.FROM_EMAIL, subject: 'Herstory Pop-up City 登录', text: `${member.nickname}，你的登录验证码是 ${code}，10 分钟内有效。\n也可以打开登录链接：${link}\n如果不是你操作，请忽略。` });
  } catch (error) {
    // Only log allowlisted diagnostics: provider messages can contain personal data or credentials.
    const allowedCodes = ['EAUTH', 'ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ESOCKET', 'ETLS', 'EENVELOPE', 'EMESSAGE'];
    const code = allowedCodes.includes(error?.code) ? error.code : 'UNKNOWN';
    const responseCode = Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599 ? error.responseCode : null;
    console.error('登录邮件发送失败', JSON.stringify({ code, responseCode }));
    fail(503, '登录邮件暂时无法发送，请稍后重试；若持续失败，请联系管理员检查发信邮箱服务。');
  }
}
async function issueSession(env, memberId) {
  const token = randomToken(), stamp = now();
  await run(env.DB, 'INSERT INTO sessions VALUES(?,?,?,?)', await digest(token), memberId, stamp + 604800, stamp);
  return json({ ok: true, next: loginDestination(env.DB, memberId) }, 200, { 'Set-Cookie': `popup_city_session=${token}; Path=/; HttpOnly;${env.SECURE_COOKIES ? ' Secure;' : ''} SameSite=Lax; Max-Age=604800` });
}
async function consumeChallenge(env, challenge, condition) {
  if (!challenge || challenge.used_at || challenge.expires_at <= now() || challenge.attempts >= 5 || !condition) fail(400, '验证码或链接无效，请重新获取');
  if (!await first(env.DB, "SELECT 1 FROM members WHERE id=? AND status!='disabled'", challenge.member_id)) fail(400, '验证码或链接无效，请重新获取');
  const result = await run(env.DB, 'UPDATE login_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5', now(), challenge.id, now());
  if (!result.meta.changes) fail(400, '登录凭证已使用');
  await run(env.DB, "UPDATE members SET status='active',updated_at=? WHERE id=? AND status='invited'", now(), challenge.member_id);
  return issueSession(env, challenge.member_id);
}
async function route(request, env) {
  if (!env.DB) fail(503, '数据库尚未配置');
  const url = new URL(request.url), p = url.pathname, method = request.method;
  if (method === 'GET' && p === '/healthz') {
    await first(env.DB, 'SELECT COUNT(*) AS n FROM schema_migrations');
    return json({ status: 'ok', mail_configured: Boolean(env.EMAIL && env.FROM_EMAIL) });
  }
  if (method === 'GET' && p === '/login') return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Herstory 登录 · 科技碰瓷节</title><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/festival.css"></head><body class="login-page"><main><a href="/" aria-label="返回活动首页"><img class="login-brand" src="/assets/series/herstory-logo.png" alt="Herstory" width="586" height="149"></a><h1>Herstory Pop-up City</h1><p id="result" role="status">点击下方按钮完成邮箱登录。</p><button class="btn" id="login">确认登录</button></main><script>document.querySelector('#login').onclick=async()=>{const token=location.hash.slice(1);if(!/^[a-f0-9]{64}$/.test(token)){document.querySelector('#result').textContent='登录链接无效，请重新获取。';return}const r=await fetch('/api/auth/redeem',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});location.hash='';if(r.ok){const data=await r.json();location.replace(data.next||'/#me');return}document.querySelector('#result').textContent='链接已过期或已使用，请重新获取。';document.querySelector('#login').hidden=true}</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) fail(503, '服务尚未配置密钥');
  const origin = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : url.origin;
  if (method !== 'GET' && method !== 'HEAD' && !p.startsWith('/api/device/')) {
    if (request.headers.get('origin') !== origin) fail(403, '请求来源不允许');
  }
  if (p.startsWith('/api/device/')) return deviceRoute(request, env, url);
  const user = await memberFromCookie(request, env);
  if (method === 'GET' && p === '/planet') {
    if (!user) return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><p>请先登录，再进入你的星球。</p><a href="/#planet" target="_top">返回网站登录</a></html>', { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" } });
    return new Response(planetDocument(planetSnapshot(env.DB, user.id), url.searchParams.get('view')), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'none'; object-src 'none'" } });
  }
  if (method === 'GET' && p === '/api/herstory/planet-state') return json(planetSnapshot(env.DB, requireMember(user).id));
  if (method === 'POST' && p === '/api/herstory/planet-onboarding') {
    requireMember(user); completePlanetOnboarding(env.DB, user.id); return json({ ok: true });
  }

  if (method === 'POST' && p === '/api/auth/request') {
    if (!env.EMAIL || !env.FROM_EMAIL) fail(503, '邮件服务尚未配置');
    const data = await body(request), address = email(data.email), stamp = now();
    const m = await first(env.DB, "SELECT * FROM members WHERE email=? AND status!='disabled'", address);
    if (m) {
      const recent = await first(env.DB, 'SELECT created_at FROM login_challenges WHERE member_id=? ORDER BY created_at DESC LIMIT 1', m.id);
      if (recent && stamp - recent.created_at < 60) return json({ ok: true, message: '如果邮箱已获邀请，登录邮件即将送达' });
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'), token = randomToken(), id = uid();
      await run(env.DB, 'INSERT INTO login_challenges(id,member_id,code_hash,link_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)', id, m.id, await mac(env.AUTH_PEPPER, `code:${id}:${code}`), await digest(token), stamp + 600, stamp);
      try { await sendLogin(env, m, code, token, origin); }
      catch (error) { await run(env.DB, 'DELETE FROM login_challenges WHERE id=?', id); throw error; }
    }
    return json({ ok: true, message: '如果邮箱已获邀请，登录邮件即将送达' });
  }
  if (method === 'POST' && p === '/api/auth/verify') {
    const data = await body(request), address = email(data.email), code = str(data.code, 6, '验证码');
    if (!/^\d{6}$/.test(code)) fail(400, '验证码不合法');
    const m = await first(env.DB, "SELECT id FROM members WHERE email=? AND status!='disabled'", address);
    const challenge = m && await first(env.DB, 'SELECT * FROM login_challenges WHERE member_id=? ORDER BY created_at DESC LIMIT 1', m.id);
    if (!challenge) fail(400, '验证码或链接无效，请重新获取');
    const correct = await mac(env.AUTH_PEPPER, `code:${challenge.id}:${code}`) === challenge.code_hash;
    if (!correct) {
      await run(env.DB, 'UPDATE login_challenges SET attempts=attempts+1 WHERE id=? AND used_at IS NULL', challenge.id);
      fail(400, '验证码或链接无效，请重新获取');
    }
    return consumeChallenge(env, challenge, true);
  }
  if (method === 'POST' && p === '/api/auth/redeem') {
    const token = str((await body(request)).token, 64, '登录链接');
    const challenge = await first(env.DB, 'SELECT * FROM login_challenges WHERE link_hash=?', await digest(token));
    return consumeChallenge(env, challenge, true);
  }
  if (method === 'POST' && p === '/api/auth/logout') {
    const token = /(?:^|;\s*)popup_city_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') || '')?.[1];
    if (token) await run(env.DB, 'DELETE FROM sessions WHERE token_hash=?', await digest(token));
    return json({ ok: true }, 200, { 'Set-Cookie': `popup_city_session=; Path=/; HttpOnly;${env.SECURE_COOKIES ? ' Secure;' : ''} SameSite=Lax; Max-Age=0` });
  }
  if (method === 'GET' && p === '/api/me') return json({ member: profile(requireMember(user), true) });
  if (method === 'GET' && p === '/api/me/records') {
    requireMember(user);
    return json({ checkins: await all(env.DB, 'SELECT c.event_id,e.title,c.checked_at FROM checkins c JOIN events e ON e.id=c.event_id WHERE c.member_id=? ORDER BY c.checked_at DESC', user.id), connections: await connectionsFor(env.DB, user.id) });
  }
  if (method === 'PATCH' && p === '/api/me') {
    requireMember(user);
    const input = await body(request);
    if (user.profile_completed_at != null) {
      if (input.avatar !== undefined || input.finalize !== undefined) fail(409, '头像已确认，不能修改或重新生成');
      const d = validateProfile({ nickname: user.nickname, bio: user.bio, skills: user.skills, needs: user.needs, card_public: Boolean(user.card_public), ...input });
      await run(env.DB, 'UPDATE members SET nickname=?,bio=?,skills=?,needs=?,card_public=?,updated_at=? WHERE id=?', d.nickname, d.bio, d.skills, d.needs, Number(d.cardPublic), now(), user.id);
      return json({ member: profile(await first(env.DB, 'SELECT * FROM members WHERE id=?', user.id), true) });
    }
    if (input.finalize !== true || !validFinalAvatar(input.avatar)) fail(400, '请完成头像与个人资料，并确认一次性保存');
    const d = validateProfile(input), stamp = now();
    const result = await run(env.DB, 'UPDATE members SET nickname=?,bio=?,skills=?,needs=?,avatar_json=?,card_public=?,updated_at=?,profile_completed_at=? WHERE id=? AND profile_completed_at IS NULL', d.nickname, d.bio, d.skills, d.needs, d.avatar, d.cardPublic === undefined ? user.card_public : Number(d.cardPublic), stamp, stamp, user.id);
    if (!result.meta.changes) fail(409, '头像已确认，不能修改或重新生成');
    return json({ member: profile(await first(env.DB, 'SELECT * FROM members WHERE id=?', user.id), true) });
  }
  if (method === 'GET' && p === '/api/members') {
    requireMember(user); return json({ members: (await all(env.DB, "SELECT * FROM members WHERE status='active' ORDER BY nickname LIMIT 200")).map(m => profile(m)) });
  }
  const memberMatch = /^\/api\/members\/([a-f0-9-]{36})$/.exec(p);
  if (method === 'GET' && memberMatch) {
    requireMember(user); const m = await first(env.DB, "SELECT * FROM members WHERE id=? AND status='active'", memberMatch[1]);
    if (!m) fail(404, '成员不存在');
    const events = await all(env.DB, `SELECT id,title,starts_at FROM events WHERE host_id=? AND status='published' ORDER BY starts_at DESC`, m.id);
    const tasks = await all(env.DB, 'SELECT t.id,t.title,c.completed_at FROM task_claims c JOIN tasks t ON t.id=c.task_id WHERE c.member_id=? AND c.completed_at IS NOT NULL ORDER BY c.completed_at DESC', m.id);
    return json({ member: profile(m), events, completed_tasks: tasks });
  }
  if (method === 'GET' && p === '/api/events') {
    const q = user?.role === 'admin' ? '' : user ? `WHERE e.status IN ('published','cancelled') OR e.host_id=?` : `WHERE e.status IN ('published','cancelled')`;
    const items = await all(env.DB, `SELECT e.id,e.title,e.description,e.category,e.location,e.starts_at,e.ends_at,e.capacity,e.volunteer_capacity,e.host_id,e.official,e.status,e.reason,c.version cover_version,m.nickname host_nickname,
      (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.id AND r.kind='attendee') attendee_count,
      (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.id AND r.kind='volunteer') volunteer_count,
      EXISTS(SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.kind='attendee' AND r.member_id=?) my_attending,
      EXISTS(SELECT 1 FROM event_registrations r WHERE r.event_id=e.id AND r.kind='volunteer' AND r.member_id=?) my_volunteering,
      EXISTS(SELECT 1 FROM event_interests i WHERE i.event_id=e.id AND i.member_id=?) my_interested
      FROM events e JOIN members m ON m.id=e.host_id LEFT JOIN event_covers c ON c.event_id=e.id ${q} ORDER BY e.starts_at,e.id`, user?.id || '', user?.id || '', user?.id || '', ...(q.includes('?') ? [user.id] : []));
    return json({ events: items.map(withCoverUrl) });
  }
  if (method === 'POST' && p === '/api/admin/events/import') {
    requireAdmin(user);
    const input = await body(request);
    if (!Array.isArray(input.events) || !input.events.length || input.events.length > 50) fail(400, '每次请添加 1–50 场活动');
    if (!['published', 'pending'].includes(input.status)) fail(400, '请选择发布或待审核');
    if (input.preview !== undefined && typeof input.preview !== 'boolean') fail(400, '预览标记不合法');
    if (typeof input.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.request_id)) fail(400, '批次编号不合法');
    const payloadHash = await digest(JSON.stringify({ events: input.events, status: input.status }));
    const previous = env.DB.raw.prepare('SELECT * FROM event_import_batches WHERE id=?').get(input.request_id);
    if (previous) {
      if (previous.actor_id !== user.id || previous.payload_hash !== payloadHash) fail(409, '批次内容已变更，请重新预览');
      return json({ ...JSON.parse(previous.result_json), replayed: true });
    }
    const rows = [], errors = [], seen = new Set();
    for (const [index, item] of input.events.entries()) {
      try {
        if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, '活动内容不合法');
        const d = validateEvent(item);
        if (d.starts <= now()) fail(400, '开始时间必须晚于当前时间');
        if (item.official !== undefined && typeof item.official !== 'boolean') fail(400, '官方标记不合法');
        if (item.cover !== undefined) fail(400, '请在导入后单独编辑活动封面');
        const key = JSON.stringify([d.title, d.starts, d.location]);
        if (seen.has(key)) fail(400, '与本批次其他活动重复（名称、开始时间、地点相同）');
        seen.add(key); rows.push({ ...d, official: Boolean(item.official), row: index + 1 });
      } catch (error) { if (!(error instanceof ApiError)) throw error; errors.push(`第 ${index + 1} 行：${error.message}`); }
    }
    if (errors.length) fail(400, errors.join('\n'));
    // No awaits inside this transaction: validation and all inserts share one write lock.
    const db = env.DB.raw; db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = db.prepare("SELECT 1 FROM events WHERE title=? AND starts_at=? AND location=? AND status!='cancelled'");
      for (const row of rows) if (duplicate.get(row.title, row.starts, row.location)) errors.push(`第 ${row.row} 行：已有同名、同时间、同地点活动，请移除重复行`);
      if (errors.length) fail(409, errors.join('\n'));
      if (input.preview) { db.exec('ROLLBACK'); return json({ count: rows.length, events: rows }); }
      const stamp = now(), ids = [];
      const insert = db.prepare('INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,official,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const audit = db.prepare('INSERT INTO event_audit VALUES(?,?,?,?,?,?)');
      for (const d of rows) {
        const id = uid(); ids.push(id);
        insert.run(id,d.title,d.description,d.category,d.location,d.starts,d.ends,d.capacity,d.volunteers,user.id,d.official?1:0,input.status,stamp,stamp);
        audit.run(uid(),id,user.id,'create',`批量添加 ${input.request_id}`,stamp);
      }
      const result = { imported: ids.length, event_ids: ids };
      db.prepare('INSERT INTO event_import_batches VALUES(?,?,?,?,?)').run(input.request_id,user.id,payloadHash,JSON.stringify(result),stamp);
      db.exec('COMMIT'); return json(result, 201);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (method === 'POST' && p === '/api/events') {
    requireMember(user); const input = await body(request), d = validateEvent(input), id = uid(), stamp = now(), status = user.role === 'admin' ? 'published' : 'pending';
    if (input.official !== undefined && typeof input.official !== 'boolean') fail(400, '官方标记不合法');
    const cover = await validateCover(input.cover);
    await env.DB.batch([
      sql(env.DB, 'INSERT INTO events(id,title,description,category,location,starts_at,ends_at,capacity,volunteer_capacity,host_id,official,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, d.title, d.description, d.category, d.location, d.starts, d.ends, d.capacity, d.volunteers, user.id, user.role === 'admin' && input.official ? 1 : 0, status, stamp, stamp),
      ...coverStatements(env.DB, id, cover),
      sql(env.DB, 'INSERT INTO event_audit VALUES(?,?,?,?,?,?)', uid(), id, user.id, 'create', '', stamp),
    ]);
    return json({ event: await eventDetail(env.DB, id) }, 201);
  }
  const interest = /^\/api\/events\/([a-f0-9-]{36})\/interest$/.exec(p);
  if (interest && ['POST','DELETE'].includes(method)) {
    requireMember(user);
    if (method === 'DELETE') {
      await run(env.DB, 'DELETE FROM event_interests WHERE event_id=? AND member_id=?', interest[1], user.id);
      return json({ ok: true });
    }
    const result = await run(env.DB, `INSERT OR IGNORE INTO event_interests(event_id,member_id,created_at)
      SELECT id,?,unixepoch() FROM events WHERE id=? AND status='published' AND starts_at>unixepoch()`, user.id, interest[1]);
    if (!result.meta.changes && !await first(env.DB, `SELECT 1 FROM event_interests i JOIN events e ON e.id=i.event_id WHERE i.event_id=? AND i.member_id=? AND e.status='published' AND e.starts_at>unixepoch()`, interest[1], user.id)) fail(409, '活动已开始或未开放，不能再添加感兴趣');
    return json({ ok: true });
  }
  const qr = /^\/api\/events\/([a-f0-9-]{36})\/qr$/.exec(p);
  if (qr && method === 'GET') {
    const event = await first(env.DB, "SELECT id FROM events WHERE id=? AND status='published'", qr[1]);
    if (!event) fail(404, '活动尚未发布，暂不能生成分享二维码');
    const image = await QRCode.toBuffer(`${env.PUBLIC_ORIGIN}/#event/${event.id}`, { type: 'png', width: 384, margin: 4, errorCorrectionLevel: 'M' });
    return new Response(image, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }
  const coverMatch = /^\/api\/events\/([a-f0-9-]{36})\/cover$/.exec(p);
  if (coverMatch && ['GET', 'HEAD'].includes(method)) {
    const event = await first(env.DB, 'SELECT status,host_id FROM events WHERE id=?', coverMatch[1]);
    if (!event || !['published', 'cancelled'].includes(event.status) && user?.id !== event.host_id && user?.role !== 'admin') fail(404, '封面不存在');
    const cover = await first(env.DB, 'SELECT image FROM event_covers WHERE event_id=?', coverMatch[1]);
    if (!cover) fail(404, '封面不存在');
    return new Response(method === 'HEAD' ? null : cover.image, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(cover.image.byteLength),
      'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  }
  const eventMatch = /^\/api\/events\/([a-f0-9-]{36})$/.exec(p);
  if (eventMatch) {
    const old = await first(env.DB, 'SELECT * FROM events WHERE id=?', eventMatch[1]); if (!old) fail(404, '活动不存在');
    if (method === 'GET') { if (!['published','cancelled'].includes(old.status) && user?.id !== old.host_id && user?.role !== 'admin') fail(404, '活动不存在'); return json({ event: await eventDetail(env.DB, old.id) }); }
    if (method === 'PATCH') {
      requireMember(user); if (user.id !== old.host_id && user.role !== 'admin') fail(403, '无权编辑活动');
      const input = await body(request), d = validateEvent(input);
      if (input.official !== undefined && typeof input.official !== 'boolean') fail(400, '官方标记不合法');
      const counts = await all(env.DB, 'SELECT kind,COUNT(*) n FROM event_registrations WHERE event_id=? GROUP BY kind', old.id);
      if (d.capacity < (counts.find(x => x.kind === 'attendee')?.n || 0) || d.volunteers < (counts.find(x => x.kind === 'volunteer')?.n || 0)) fail(409, '名额不能低于已报名人数');
      const status = user.role === 'admin' ? old.status : old.status === 'cancelled' ? 'cancelled' : 'pending';
      const cover = await validateCover(input.cover), stamp = now();
      await env.DB.batch([
        sql(env.DB, `UPDATE events SET title=?,description=?,category=?,location=?,starts_at=?,ends_at=?,capacity=?,volunteer_capacity=?,official=?,status=?,reason='',updated_at=? WHERE id=?`, d.title, d.description, d.category, d.location, d.starts, d.ends, d.capacity, d.volunteers, user.role === 'admin' && input.official !== undefined ? Number(input.official) : old.official, status, stamp, old.id),
        ...coverStatements(env.DB, old.id, cover),
        sql(env.DB, 'INSERT INTO event_audit VALUES(?,?,?,?,?,?)', uid(), old.id, user.id, 'edit', '', stamp),
      ]);
      return json({ event: await eventDetail(env.DB, old.id) });
    }
  }
  const registration = /^\/api\/events\/([a-f0-9-]{36})\/(attendees|volunteers)$/.exec(p);
  if (registration && ['POST','DELETE'].includes(method)) {
    requireMember(user); const kind = registration[2] === 'attendees' ? 'attendee' : 'volunteer';
    if (method === 'DELETE') { await run(env.DB, 'DELETE FROM event_registrations WHERE event_id=? AND member_id=? AND kind=?', registration[1], user.id, kind); return json({ ok: true }); }
    const e = await first(env.DB, 'SELECT * FROM events WHERE id=?', registration[1]); if (!e || e.status !== 'published') fail(409, '活动未开放报名');
    if (e.starts_at <= now()) fail(409, '活动已开始，不能迟到报名');
    const limit = kind === 'attendee' ? e.capacity : e.volunteer_capacity;
    if (!limit) fail(409, '未开放志愿者招募');
    const result = await run(env.DB, `INSERT OR IGNORE INTO event_registrations(event_id,member_id,kind,created_at)
      SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM event_registrations WHERE event_id=? AND kind=?) < ? AND EXISTS(SELECT 1 FROM events WHERE id=? AND status='published' AND starts_at>unixepoch())`, e.id, user.id, kind, now(), e.id, kind, limit, e.id);
    if (!result.meta.changes) {
      const existing = await first(env.DB, 'SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=? AND kind=?', e.id, user.id, kind);
      if (!existing) fail(409, '活动已开始、未开放或名额已满');
    }
    return json({ ok: true });
  }
  if (method === 'GET' && p === '/api/tasks') { requireMember(user); return json({ tasks: await all(env.DB, `SELECT t.*,m.nickname host_nickname,(SELECT COUNT(*) FROM task_claims c WHERE c.task_id=t.id) claim_count,(SELECT completed_at FROM task_claims c WHERE c.task_id=t.id AND c.member_id=?) my_completed_at,EXISTS(SELECT 1 FROM task_claims c WHERE c.task_id=t.id AND c.member_id=?) my_claimed FROM tasks t JOIN members m ON m.id=t.host_id ORDER BY t.deadline LIMIT 300`, user.id, user.id) }); }
  if (method === 'POST' && p === '/api/tasks') {
    requireMember(user); const d = validateTask(await body(request)), id = uid(), stamp = now();
    await run(env.DB, 'INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)', id, d.title, d.description, d.category, d.location, d.deadline, d.capacity, user.id, stamp, stamp);
    return json({ id }, 201);
  }
  const taskMatch = /^\/api\/tasks\/([a-f0-9-]{36})$/.exec(p);
  if (method === 'PATCH' && taskMatch) {
    requireMember(user); const old = await first(env.DB, 'SELECT * FROM tasks WHERE id=?', taskMatch[1]); if (!old) fail(404, '任务不存在');
    if (old.host_id !== user.id && user.role !== 'admin') fail(403, '无权编辑任务');
    const d = validateTask(await body(request)); const count = await first(env.DB, 'SELECT COUNT(*) n FROM task_claims WHERE task_id=?', old.id);
    if (d.capacity < count.n) fail(409, '名额不能低于认领人数');
    await run(env.DB, 'UPDATE tasks SET title=?,description=?,category=?,location=?,deadline=?,capacity=?,updated_at=? WHERE id=?', d.title, d.description, d.category, d.location, d.deadline, d.capacity, now(), old.id);
    return json({ ok: true });
  }
  const claim = /^\/api\/tasks\/([a-f0-9-]{36})\/claims$/.exec(p);
  if (claim && ['POST','DELETE'].includes(method)) {
    requireMember(user);
    if (method === 'DELETE') { await run(env.DB, 'DELETE FROM task_claims WHERE task_id=? AND member_id=? AND completed_at IS NULL', claim[1], user.id); return json({ ok: true }); }
    const result = await run(env.DB, `INSERT OR IGNORE INTO task_claims(task_id,member_id,created_at)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=?) AND (SELECT COUNT(*) FROM task_claims WHERE task_id=?) < (SELECT capacity FROM tasks WHERE id=?)`, claim[1], user.id, now(), claim[1], claim[1], claim[1]);
    if (!result.meta.changes && !await first(env.DB, 'SELECT 1 FROM task_claims WHERE task_id=? AND member_id=?', claim[1], user.id)) fail(409, '任务名额已满或不存在');
    return json({ ok: true });
  }
  const complete = /^\/api\/tasks\/([a-f0-9-]{36})\/complete$/.exec(p);
  if (method === 'POST' && complete) { requireMember(user); const result = await run(env.DB, 'UPDATE task_claims SET completed_at=? WHERE task_id=? AND member_id=? AND completed_at IS NULL', now(), complete[1], user.id); if (!result.meta.changes) fail(409, '请先领取任务'); return json({ ok: true }); }
  if (p.startsWith('/api/admin/')) return adminRoute(request, env, url, requireAdmin(user));
  fail(404, '接口不存在');
}
async function adminRoute(request, env, url, user) {
  const p = url.pathname, method = request.method;
  if (p === '/api/admin/planet/growth' && method === 'GET') return json(planetGrowthAdmin(env.DB));
  if (p.startsWith('/api/admin/planet/growth/') && ['POST','PUT'].includes(method)) {
    const data = await body(request);
    const handlers = { activate: () => activatePlanetGrowth(env.DB,user), events: () => configurePlanetEvent(env.DB,user,data), reviews: () => reviewPlanetRole(env.DB,user,data), corrections: () => correctPlanetFact(env.DB,user,data) };
    const handler = handlers[p.slice('/api/admin/planet/growth/'.length)]; if (!handler) fail(404,'成长接口不存在');
    return json(growthTransaction(env.DB, () => {
      const result = handler();
      const ids = data.member_id ? [data.member_id] : env.DB.raw.prepare('SELECT member_id FROM member_planets UNION SELECT member_id FROM checkins').all().map(r=>r.member_id);
      for (const memberId of ids) if (env.DB.raw.prepare("SELECT 1 FROM members WHERE id=? AND status!='disabled'").get(memberId)) planetSnapshotInTransaction(env.DB,memberId);
      return result;
    }));
  }
  const hardware = await hardwareAdminRoute(request, env, url, user, body);
  if (hardware) return hardware;
  if (method === 'POST' && p === '/api/admin/members/import') {
    const rows = (await body(request)).members; if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200) fail(400, '每次导入 1–200 位成员');
    const normalized = rows.map(x => ({ email: email(x.email), nickname: str(x.nickname || x.email.split('@')[0], 20, '昵称') }));
    if (new Set(normalized.map(x => x.email)).size !== normalized.length) fail(400, '名单含重复邮箱');
    const statements = normalized.map(x => sql(env.DB, `INSERT OR IGNORE INTO members(id,email,nickname,created_at,updated_at) VALUES(?,?,?,?,?)`, uid(), x.email, x.nickname, now(), now()));
    const result = await env.DB.batch(statements);
    return json({ imported: result.reduce((n, x) => n + x.meta.changes, 0), skipped: rows.length - result.reduce((n, x) => n + x.meta.changes, 0) });
  }
  if (method === 'GET' && p === '/api/admin/members') return json({ members: (await all(env.DB, 'SELECT * FROM members ORDER BY created_at DESC LIMIT 500')).map(m => ({ ...profile(m, true), created_at: m.created_at })) });
  const memberRole = /^\/api\/admin\/members\/([a-f0-9-]{36})\/role$/.exec(p);
  if (method === 'PATCH' && memberRole) {
    const input = await body(request);
    try { return json({ member: profile(changeMemberRole(env.DB, user.id, memberRole[1], input.role), true) }); }
    catch (error) { if ([400,403,404,409].includes(error.status)) fail(error.status, error.message); throw error; }
  }
  const memberEdit = /^\/api\/admin\/members\/([a-f0-9-]{36})$/.exec(p);
  if (method === 'PATCH' && memberEdit) {
    const old = await first(env.DB, 'SELECT * FROM members WHERE id=?', memberEdit[1]); if (!old) fail(404, '成员不存在');
    if (old.is_super_admin && old.id !== user.id) fail(403, '不能修改超级管理员资料');
    const input = await body(request);
    if (input.avatar !== undefined || input.finalize !== undefined) fail(old.profile_completed_at != null ? 409 : 403, '头像只能由成员首次确认，管理员不能修改或重新生成');
    const d = validateProfile({ nickname: old.nickname, bio: old.bio, skills: old.skills, needs: old.needs, avatar: JSON.parse(old.avatar_json || '{}'), card_public: Boolean(old.card_public), ...input });
    await run(env.DB, 'UPDATE members SET nickname=?,bio=?,skills=?,needs=?,avatar_json=?,card_public=?,updated_at=? WHERE id=?', d.nickname, d.bio, d.skills, d.needs, d.avatar, Number(d.cardPublic), now(), old.id);
    return json({ member: profile(await first(env.DB, 'SELECT * FROM members WHERE id=?', old.id), true) });
  }
  const memberStatus = /^\/api\/admin\/members\/([a-f0-9-]{36})\/status$/.exec(p);
  if (method === 'PATCH' && memberStatus) {
    const data = await body(request); if (!['active','disabled'].includes(data.status)) fail(400, '状态不合法');
    const target = await first(env.DB, 'SELECT * FROM members WHERE id=?', memberStatus[1]);
    if (!target) fail(404, '成员不存在');
    if (target.is_super_admin) fail(403, '不能停用或更改超级管理员状态');
    if (memberStatus[1] === user.id && data.status === 'disabled') fail(409, '不能停用自己');
    await run(env.DB, 'UPDATE members SET status=?,updated_at=? WHERE id=?', data.status, now(), memberStatus[1]);
    if (data.status === 'disabled') await run(env.DB, 'DELETE FROM sessions WHERE member_id=?', memberStatus[1]);
    return json({ ok: true });
  }
  const event = /^\/api\/admin\/events\/([a-f0-9-]{36})$/.exec(p);
  if (method === 'PATCH' && event) {
    const data = await body(request), old = await first(env.DB, 'SELECT * FROM events WHERE id=?', event[1]); if (!old) fail(404, '活动不存在');
    const status = data.status ?? old.status, official = data.official ?? Boolean(old.official), reason = str(data.reason ?? '', 500, '原因', false);
    if (!['pending','published','rejected','cancelled'].includes(status) || typeof official !== 'boolean') fail(400, '活动状态不合法');
    if (['rejected','cancelled'].includes(status) && !reason) fail(400, '请填写原因');
    await run(env.DB, 'UPDATE events SET status=?,official=?,reason=?,updated_at=? WHERE id=?', status, Number(official), reason, now(), old.id);
    await audit(env.DB, old.id, user.id, `status:${status},official:${official}`, reason); return json({ event: await eventDetail(env.DB, old.id) });
  }
  const roster = /^\/api\/admin\/events\/([a-f0-9-]{36})\/roster$/.exec(p);
  if (method === 'GET' && roster) return json({ registrations: await all(env.DB, 'SELECT r.kind,r.created_at,m.id,m.nickname,m.email FROM event_registrations r JOIN members m ON m.id=r.member_id WHERE r.event_id=? ORDER BY r.created_at', roster[1]), checkins: await all(env.DB, 'SELECT c.member_id,c.checked_at FROM checkins c WHERE c.event_id=? ORDER BY c.checked_at', roster[1]) });
  const auditPath = /^\/api\/admin\/events\/([a-f0-9-]{36})\/audit$/.exec(p);
  if (method === 'GET' && auditPath) return json({ history: await all(env.DB, 'SELECT * FROM event_audit WHERE event_id=? ORDER BY created_at DESC', auditPath[1]) });
  const pin = /^\/api\/admin\/events\/([a-f0-9-]{36})\/checkin-pin$/.exec(p);
  if (method === 'PUT' && pin) { const value = str((await body(request)).pin, 6, '签到口令'); if (!/^\d{6}$/.test(value)) fail(400, '签到口令须为六位数字'); await run(env.DB, 'UPDATE events SET venue_pin_hash=? WHERE id=?', await mac(env.AUTH_PEPPER, `venue:${pin[1]}:${value}`), pin[1]); return json({ ok: true }); }
  const device = /^\/api\/admin\/members\/([a-f0-9-]{36})\/devices$/.exec(p);
  if (method === 'GET' && device) {
    if (!await first(env.DB, 'SELECT 1 FROM members WHERE id=?', device[1])) fail(404, '成员不存在');
    return json({ devices: await all(env.DB, 'SELECT id,created_at,revoked_at FROM devices WHERE member_id=? ORDER BY created_at DESC', device[1]) });
  }
  if (method === 'POST' && device) {
    if (!await first(env.DB, "SELECT 1 FROM members WHERE id=? AND status!='disabled'", device[1])) fail(404, '成员不存在');
    const id = uid(), token = randomToken(); await run(env.DB, 'INSERT INTO devices VALUES(?,?,?,?,?)', id, device[1], await digest(token), null, now());
    return json({ device_id: id, token, message: '令牌仅显示一次，请安全写入设备' }, 201);
  }
  const revoke = /^\/api\/admin\/devices\/([a-f0-9-]{36})$/.exec(p);
  if (method === 'DELETE' && revoke) { await run(env.DB, 'UPDATE devices SET revoked_at=? WHERE id=?', now(), revoke[1]); return json({ ok: true }); }
  fail(404, '接口不存在');
}
async function deviceRoute(request, env, url) {
  const d = await deviceFromBearer(request, env), p = url.pathname, method = request.method;
  const hardware = await hardwareRoute(request, env, url, d, body);
  if (hardware) return hardware;
  if (method === 'GET' && p === '/api/device/me') return json({ member_id: d.member_id, nickname: d.nickname, bio: d.card_public ? d.bio : '', avatar: JSON.parse(d.avatar_json || '{}') });
  if (method === 'GET' && p === '/api/device/events') return json({ events: await all(env.DB, `SELECT e.id,e.title,e.starts_at,e.ends_at,e.location FROM events e JOIN event_registrations r ON r.event_id=e.id WHERE r.member_id=? AND r.kind='attendee' AND e.status='published' ORDER BY e.starts_at`, d.member_id) });
  if (method === 'GET' && p === '/api/device/records') return json({ checkins: await all(env.DB, 'SELECT event_id,checked_at FROM checkins WHERE member_id=? ORDER BY checked_at DESC', d.member_id), connections: await connectionsFor(env.DB, d.member_id) });
  if (method === 'POST' && p === '/api/device/checkins') {
    const data = await body(request), eventId = str(data.event_id, 36, '活动 ID'), pin = str(data.pin, 6, '签到口令'), requestId = str(data.request_id, 80, '请求 ID');
    const e = await first(env.DB, 'SELECT * FROM events WHERE id=?', eventId), stamp = now();
    if (!e || e.status !== 'published' || !e.venue_pin_hash || stamp < e.starts_at - 3600 || stamp >= e.starts_at) fail(409, '活动当前不可签到');
    if (!await first(env.DB, "SELECT 1 FROM event_registrations WHERE event_id=? AND member_id=? AND kind='attendee'", eventId, d.member_id)) fail(403, '尚未报名此活动');
    const failures = await first(env.DB, 'SELECT COUNT(*) n FROM device_failed_codes WHERE device_id=? AND attempted_at>?', d.id, stamp - 600);
    if (failures.n >= 10) fail(429, '尝试次数过多，请稍后再试');
    if (await mac(env.AUTH_PEPPER, `venue:${eventId}:${pin}`) !== e.venue_pin_hash) { await run(env.DB, 'INSERT INTO device_failed_codes VALUES(?,?)', d.id, stamp); fail(403, '签到口令不正确'); }
    const snapshot=growthTransaction(env.DB,()=>{env.DB.raw.prepare('INSERT OR IGNORE INTO checkins VALUES(?,?,?,?,?)').run(eventId,d.member_id,d.id,stamp,requestId);return planetSnapshotInTransaction(env.DB,d.member_id);});
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
export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Access-Control-Allow-Origin', env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : new URL(request.url).origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      // 不把邮件、SQL 参数、令牌等写入共享主机日志。
      const expected = error instanceof ApiError || error instanceof HardwareError || error instanceof PlanetGrowthError;
      if (!expected) console.error('活动 API 内部错误');
      return json({ error: expected ? error.message : '服务暂时不可用', ...(error instanceof HardwareError ? { code: error.code } : {}) }, expected ? error.status : 500);
    }
  }
};
