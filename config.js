import { resolve } from 'node:path';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const host = env.HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('HOST 必须为 127.0.0.1；公网访问由现有 Caddy 转发');
  const port = Number(env.PORT || 3300);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3210].includes(port)) {
    throw new Error('PORT 必须为独立非特权端口，禁止使用旧服务端口 3000 / 3210');
  }
  const origin = new URL(env.PUBLIC_ORIGIN || `http://${host}:${port}`);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('PUBLIC_ORIGIN 只能包含协议、主机和可选端口');
  }
  if (production ? origin.protocol !== 'https:' : !['https:', 'http:'].includes(origin.protocol)) {
    throw new Error('生产 PUBLIC_ORIGIN 必须使用 HTTPS');
  }
  if (origin.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw new Error('明文 HTTP 仅允许本机开发');
  }
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) throw new Error('请配置至少 32 字符的随机 AUTH_PEPPER');
  const mailMode = env.MAIL_MODE || 'disabled';
  if (!['disabled', 'smtp'].includes(mailMode)) throw new Error('MAIL_MODE 只能是 disabled 或 smtp');
  if (production && !env.DATABASE_PATH?.startsWith('/')) throw new Error('生产 DATABASE_PATH 必须为独立数据目录内的绝对路径');
  return {
    production, host, port, origin: origin.origin,
    secureCookies: origin.protocol === 'https:',
    pepper: env.AUTH_PEPPER,
    databasePath: resolve(env.DATABASE_PATH || './data/popup-city.sqlite'),
    mailMode, fromEmail: env.FROM_EMAIL || 'info@0xherstory.cn',
    smtp: {
      host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 465),
      secure: env.SMTP_SECURE !== 'false', user: env.SMTP_USER || '', pass: env.SMTP_PASS || '',
    },
  };
}
