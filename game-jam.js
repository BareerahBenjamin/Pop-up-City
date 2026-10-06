import { createHash, randomUUID } from 'node:crypto';
import { prepareCover, MAX_GAME_JAM_FIRMWARE_BYTES, MAX_GAME_JAM_COVER_BYTES } from './covers.js';

export class GameJamError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new GameJamError(status, message); };
const categories = ['互动游戏','随身工具','城市社交','实验作品'];
const contract = 'herstory-event-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label}不合法`);
  return value.trim();
};
const fields = 'p.id,p.app_id,p.version,p.title,p.author,p.description,p.category,p.firmware_name,p.firmware_bytes,p.firmware_sha256,p.status,p.review_note,p.created_at,p.updated_at,(p.cover IS NOT NULL) AS has_cover';
const from = ' FROM game_jam_projects p JOIN game_jam_apps a ON a.app_id=p.app_id JOIN members m ON m.id=a.owner_id';
function project(db, id) { return db.prepare(`SELECT ${fields},a.owner_id${from} WHERE p.id=?`).get(id); }
function publicProject(row, privateView = false) {
  const { owner_id, review_note, has_cover, ...rest } = row;
  return { ...rest, cover_url: has_cover ? `/api/game-jam/projects/${row.id}/cover` : null,
    ...(privateView ? { owner_id, review_note } : {}),
    firmware_url: `/api/game-jam/projects/${row.id}/firmware`, manifest_url: `/api/game-jam/projects/${row.id}/manifest` };
}
function requireMember(user) { if (!user) fail(401, '请先用已导入的成员邮箱登录'); }
function requireAdmin(user) { requireMember(user); if (user.role !== 'admin') fail(403, '仅管理员可以审核作品'); }
function canRead(row, user) { return row && (row.status === 'published' || user?.id === row.owner_id || user?.role === 'admin'); }

async function submission(request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) fail(415, '请使用作品投稿表单上传文件');
  let form;
  try { form = await request.formData(); } catch { fail(400, '无法读取投稿文件'); }
  const allowed = ['title','author','description','category','manifest','firmware','cover'];
  for (const key of new Set(form.keys())) if (!allowed.includes(key) || form.getAll(key).length !== 1) fail(400, '投稿字段不合法或重复');
  const title = text(form.get('title'), 80, '作品名称'), author = text(form.get('author'), 60, '作者／团队');
  const description = text(form.get('description'), 180, '作品介绍'), category = form.get('category');
  if (!categories.includes(category)) fail(400, '作品类型不合法');
  const manifestFile = form.get('manifest'), file = form.get('firmware');
  if (!(manifestFile instanceof File) || manifestFile.name !== 'event-app.json' || manifestFile.size < 1 || manifestFile.size > 8192) fail(400, '请选择不超过8KB的 event-app.json');
  if (!(file instanceof File) || !file.name.endsWith('-full.bin') || file.name.length > 120 || /[\x00-\x1f/\\]/.test(file.name)) fail(400, '固件文件名必须以 -full.bin 结尾');
  if (file.size < 1 || file.size >= MAX_GAME_JAM_FIRMWARE_BYTES) fail(400, '固件必须小于0x690000字节，不能覆盖 event_save');
  let manifest;
  try { manifest = JSON.parse(await manifestFile.text()); } catch { fail(400, 'event-app.json 不是有效JSON'); }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object' || manifest.contract_version !== contract) fail(400, 'manifest 不是 herstory-event-v1 协议');
  if (typeof manifest.app_id !== 'string' || !/^[a-z][a-z0-9_]{2,14}$/.test(manifest.app_id)) fail(400, 'app_id 必须是3–15位小写字母、数字或下划线');
  if (typeof manifest.version !== 'string' || manifest.version.length > 60 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) fail(400, 'version 必须是完整语义化版本，例如1.0.0');
  if (!Number.isInteger(manifest.save_quota_bytes) || manifest.save_quota_bytes < 1 || manifest.save_quota_bytes > 2048) fail(400, '存档配额必须在1–2048字节之间');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes[0] !== 0xe9) fail(400, '固件没有有效的ESP32镜像头');
  const coverFile = form.get('cover'); let cover = null;
  if (coverFile instanceof File && coverFile.size) {
    if (coverFile.size > MAX_GAME_JAM_COVER_BYTES) fail(400, '作品封面不能超过3MB');
    try { cover = await prepareCover(`data:${coverFile.type};base64,${Buffer.from(await coverFile.arrayBuffer()).toString('base64')}`); }
    catch (error) { if ([400,503].includes(error.status)) fail(error.status, error.message); throw error; }
  } else if (coverFile !== null && !(coverFile instanceof File)) fail(400, '封面文件不合法');
  return { title, author, description, category, manifest, manifestJSON: JSON.stringify(manifest), fileName:file.name, bytes, sha256:hash(bytes), cover };
}

export async function gameJamRoute(request, env, user, readBody) {
  const url = new URL(request.url), path = url.pathname, method = request.method, db = env.DB.raw;
  if (!path.startsWith('/api/game-jam/') && !path.startsWith('/api/admin/game-jam/')) return null;
  if (method === 'GET' && path === '/api/game-jam/projects') {
    const rows = db.prepare(`SELECT ${fields}${from} WHERE p.status='published' AND m.status!='disabled' ORDER BY p.created_at DESC,p.id LIMIT 200`).all();
    return json({ projects:rows.map(row => publicProject(row)) });
  }
  if (method === 'GET' && path === '/api/game-jam/mine') {
    requireMember(user);
    return json({ projects:db.prepare(`SELECT ${fields},a.owner_id${from} WHERE a.owner_id=? ORDER BY p.created_at DESC,p.id LIMIT 200`).all(user.id).map(row => publicProject(row,true)) });
  }
  if (method === 'GET' && path === '/api/admin/game-jam/projects') {
    requireAdmin(user);
    return json({ projects:db.prepare(`SELECT ${fields},a.owner_id${from} ORDER BY p.created_at DESC,p.id LIMIT 500`).all().map(row => publicProject(row,true)) });
  }
  if (method === 'POST' && path === '/api/game-jam/projects') {
    requireMember(user); const d = await submission(request), stamp = Math.floor(Date.now()/1000);
    db.exec('BEGIN IMMEDIATE');
    try {
      const app = db.prepare('SELECT owner_id FROM game_jam_apps WHERE app_id=?').get(d.manifest.app_id);
      if (app && app.owner_id !== user.id) fail(409, '这个app_id已由其他成员使用，请选择你的应用ID');
      const old = db.prepare('SELECT id,firmware_sha256,title,author,description,category,firmware_name,manifest_json,cover FROM game_jam_projects WHERE app_id=? AND version=?').get(d.manifest.app_id,d.manifest.version);
      if (old) {
        const same = old.firmware_sha256 === d.sha256 && old.title === d.title && old.author === d.author && old.description === d.description && old.category === d.category && old.firmware_name === d.fileName && old.manifest_json === d.manifestJSON && hash(old.cover || Buffer.alloc(0)) === hash(d.cover || Buffer.alloc(0));
        if (!same) fail(409, '该应用版本已提交，修改作品请增加版本号');
        const result = project(db,old.id); db.exec('COMMIT'); return json({ project:publicProject(result,true), duplicate:true });
      }
      if (!app) db.prepare('INSERT INTO game_jam_apps VALUES(?,?,?)').run(d.manifest.app_id,user.id,stamp);
      const id = randomUUID();
      db.prepare(`INSERT INTO game_jam_projects(id,app_id,version,title,author,description,category,manifest_json,firmware_name,firmware_bytes,firmware_sha256,firmware,cover,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,d.manifest.app_id,d.manifest.version,d.title,d.author,d.description,d.category,d.manifestJSON,d.fileName,d.bytes.length,d.sha256,d.bytes,d.cover,stamp,stamp);
      const result = project(db,id); db.exec('COMMIT'); return json({ project:publicProject(result,true), duplicate:false },201);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const file = /^\/api\/game-jam\/projects\/([a-f0-9-]{36})\/(firmware|manifest|cover)$/.exec(path);
  if (method === 'GET' && file) {
    const row = project(db,file[1]);
    if (!canRead(row,user) || (row.status === 'published' && !user && file[2] !== 'cover')) { if (!user && file[2] !== 'cover') requireMember(user); fail(404, '作品文件不存在'); }
    const owner = db.prepare('SELECT status FROM members WHERE id=?').get(row.owner_id);
    if (owner.status === 'disabled' && user?.role !== 'admin') fail(404, '作品文件不存在');
    const column = { firmware:'firmware',cover:'cover',manifest:'manifest_json' }[file[2]];
    const stored = db.prepare(`SELECT ${column} FROM game_jam_projects WHERE id=?`).get(row.id);
    if (file[2] === 'cover') {
      if (!stored.cover) fail(404, '作品没有封面');
      return new Response(stored.cover,{ headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store'} });
    }
    requireMember(user);
    if (file[2] === 'manifest') return new Response(stored.manifest_json,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="event-app.json"','Cache-Control':'private, no-store'}});
    return new Response(stored.firmware,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(row.firmware_bytes),'Content-Disposition':`attachment; filename="firmware-full.bin"; filename*=UTF-8''${encodeURIComponent(row.firmware_name)}`,'X-Content-SHA256':row.firmware_sha256,'Cache-Control':'private, no-store'}});
  }
  const review = /^\/api\/admin\/game-jam\/projects\/([a-f0-9-]{36})\/review$/.exec(path);
  if (method === 'POST' && review) {
    requireAdmin(user); const d = await readBody(request), note = text(d.note,1000,'审核说明');
    if (!['published','rejected'].includes(d.status)) fail(400, '审核状态不合法');
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = project(db,review[1]); if (!row) fail(404, '作品不存在');
      if (d.status === 'published' && db.prepare('SELECT status FROM members WHERE id=?').get(row.owner_id).status === 'disabled') fail(409, '该成员已停用，不能发布作品');
      if (row.status === d.status && row.review_note === note) { db.exec('COMMIT'); return json({ project:publicProject(row,true) }); }
      const stamp = Math.floor(Date.now()/1000);
      db.prepare('UPDATE game_jam_projects SET status=?,review_note=?,updated_at=? WHERE id=?').run(d.status,note,stamp,row.id);
      db.prepare('INSERT INTO game_jam_reviews VALUES(?,?,?,?,?,?)').run(randomUUID(),row.id,user.id,d.status,note,stamp);
      const result = project(db,row.id); db.exec('COMMIT'); return json({ project:publicProject(result,true) });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  fail(404, 'Game Jam接口不存在');
}
