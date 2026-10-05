import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import api from './api.js';
import { openDatabase, checkSchema } from './database.js';
import { loadConfig } from './config.js';
import { createMailer } from './mail.js';
import { bodyLimit } from './covers.js';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const securityHeaders = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

function respond(res, status, message) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

async function serveStatic(req, res, pathname, root) {
  if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, '不支持的请求方法');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return respond(res, 400, '路径无效'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p === '..' || p.startsWith('.'))) return respond(res, 404, '文件不存在');
  const path = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (!path.startsWith(root + sep)) return respond(res, 404, '文件不存在');
  try {
    const actual = await realpath(path);
    if (!actual.startsWith(root + sep) || !mime[extname(actual).toLowerCase()]) return respond(res, 404, '文件不存在');
    const info = await stat(actual);
    if (!info.isFile()) return respond(res, 404, '文件不存在');
    const data = req.method === 'HEAD' ? null : await readFile(actual);
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[extname(actual).toLowerCase()], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return respond(res, 404, '文件不存在');
    throw error;
  }
}

export function createApplication(config, { db, mailer, staticRoot = publicDirectory }) {
  const env = { DB: db, EMAIL: mailer, FROM_EMAIL: config.fromEmail, AUTH_PEPPER: config.pepper, PUBLIC_ORIGIN: config.origin, SECURE_COOKIES: config.secureCookies };
  // 限制正在处理的请求数量；不持久化 IP 或请求内容。
  let active = 0, eventWrites = 0;
  const server = createServer(async (req, res) => {
    if (active >= 64) { req.resume(); return respond(res, 503, '服务繁忙，请稍后再试'); }
    active++;
    let released = false, eventWrite = false;
    const release = () => { if (!released) { released = true; active--; if (eventWrite) eventWrites--; } };
    res.once('finish', release); res.once('close', release);
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return respond(res, 400, '请求路径无效');
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin) return respond(res, 400, '请求路径无效');
      const limit = bodyLimit(req.method, url.pathname);
      if (limit > 16000) {
        if (eventWrites >= 2) { req.resume(); return respond(res, 503, '活动正在保存，请稍后重试'); }
        eventWrite = true; eventWrites++;
      }
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz' && url.pathname !== '/login') {
        req.resume();
        return await serveStatic(req, res, url.pathname, resolve(staticRoot));
      }
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return respond(res, 405, '不支持的请求方法');
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      let bytes;
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (Number(req.headers['content-length']) > limit) { req.resume(); return respond(res, 413, '请求内容过大'); }
        const chunks = []; let size = 0, exceeded = false;
        // 监听 data 而非提前退出 async iterator，保留发送 413 的 socket。
        bytes = await new Promise((resolveBody, reject) => {
          req.on('data', chunk => {
            if (exceeded) return;
            size += chunk.length;
            if (size > limit) {
              exceeded = true;
              chunks.length = 0;
              const error = new Error('请求内容过大'); error.status = 413;
              reject(error);
            } else chunks.push(chunk);
          });
          req.on('end', () => resolveBody(Buffer.concat(chunks)));
          req.on('error', reject);
        });
      }
      const request = new Request(url, { method: req.method, headers, ...(bytes?.length ? { body: bytes } : {}) });
      const response = await api.fetch(request, env);
      req.resume();
      res.writeHead(response.status, { ...securityHeaders, ...Object.fromEntries(response.headers) });
      if (req.method === 'HEAD' || !response.body) res.end();
      else await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!res.headersSent) respond(res, error.status || 500, error.status === 413 ? '请求内容过大' : '服务暂时不可用');
      else res.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.maxConnections = 128;
  return server;
}

async function main() {
  process.umask(0o077);
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  checkSchema(db);
  const mailer = createMailer(config);
  const server = createApplication(config, { db, mailer });
  server.once('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用；请为新服务选择其他端口，不要停止占用者' : '活动服务启动失败'); db.close(); mailer?.close(); process.exitCode = 1; });
  server.listen(config.port, config.host, () => console.log(`活动服务已监听 ${config.host}:${config.port}；邮件${mailer ? '已配置' : '未配置'}`));
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    const timer = setTimeout(() => server.closeAllConnections(), 20000); timer.unref();
    server.close(() => { clearTimeout(timer); mailer?.close(); db.close(); });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('启动失败：请检查配置、数据库权限和迁移状态'); process.exitCode = 1; });
}
