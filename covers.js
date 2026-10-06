import sharp from 'sharp';

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const EVENT_BODY_LIMIT = Math.ceil(MAX_COVER_BYTES / 3) * 4 + 64000;
export const MAX_GAME_JAM_FIRMWARE_BYTES = 0x690000;
export const MAX_GAME_JAM_COVER_BYTES = 3 * 1024 * 1024;
export const GAME_JAM_BODY_LIMIT = MAX_GAME_JAM_FIRMWARE_BYTES + MAX_GAME_JAM_COVER_BYTES + 64000;
export function bodyLimit(method, pathname) {
  if (method === 'POST' && pathname === '/api/game-jam/projects') return GAME_JAM_BODY_LIMIT;
  if (method === 'POST' && pathname === '/api/admin/events/import') return 512 * 1024;
  return (method === 'POST' && pathname === '/api/events') ||
    (method === 'PATCH' && /^\/api\/events\/[a-f0-9-]{36}$/.test(pathname)) ? EVENT_BODY_LIMIT : 16000;
}

const invalid = message => Object.assign(new Error(message), { status: 400 });
let processing = 0;

// 解码后重编码，只保存静态 WebP；不保留 EXIF/GPS 等元数据或原文件名。
export async function prepareCover(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.length > EVENT_BODY_LIMIT) throw invalid('封面文件不能超过 5 MB');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw invalid('封面只支持 JPG、PNG 或 WebP 图片');
  const input = Buffer.from(match[2], 'base64');
  if (input.length > MAX_COVER_BYTES) throw invalid('封面文件不能超过 5 MB');
  if (input.toString('base64') !== match[2]) throw invalid('封面图片内容无效');
  // 在调用图片解码器前拒绝 SVG 等格式，避免按声明的 MIME 信任文件。
  const format = input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg' :
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' :
    input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
  if (format !== match[1]) throw invalid('封面图片格式与内容不一致');
  if (processing >= 2) throw Object.assign(new Error('图片正在处理中，请稍后重试'), { status: 503 });
  processing++;
  try {
    const image = sharp(input, { failOn: 'warning', limitInputPixels: 25000000 });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages || 1) > 1) throw invalid('请使用静态 JPG、PNG 或 WebP 图片');
    return await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error.status) throw error;
    throw invalid('无法读取封面，请使用完整的图片，且不超过 2500 万像素');
  } finally { processing--; }
}
