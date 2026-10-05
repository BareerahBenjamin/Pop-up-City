import nodemailer from 'nodemailer';

export function createMailer(config) {
  if (config.mailMode === 'disabled') return null;
  const smtp = config.smtp;
  if (!config.fromEmail || !smtp.host || !smtp.user || !smtp.pass || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) {
    throw new Error('SMTP 配置不完整');
  }
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
  });
  return { send: message => transport.sendMail(message), close: () => transport.close() };
}
