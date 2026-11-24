// Lớp lưu trữ file với 2 driver:
//   - local: thư mục STORAGE_DIR dùng chung giữa các service (chạy trên 1 máy / docker compose)
//   - s3:    object storage tương thích S3 (Cloudflare R2, AWS S3, MinIO...) — dùng khi deploy
//            lên nền tảng mà mỗi service chạy ở máy riêng (Render, Railway, Kubernetes...)
// Các service chỉ làm việc với "key" tương đối như "thumbnails/abc.jpg" nên không phụ thuộc driver.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { optional, int, bool, rootDir } = require('./env');

const DRIVER = optional('STORAGE_DRIVER', 'local');
const isS3 = DRIVER === 's3';
const STORAGE_DIR = path.resolve(rootDir, optional('STORAGE_DIR', 'storage'));
// URL công khai của gateway (vd https://myt-gateway.onrender.com). Khi frontend và gateway khác
// domain, URL ảnh phải là tuyệt đối -> mặc định suy ra "<GATEWAY_PUBLIC_URL>/media".
const GATEWAY_PUBLIC_URL = optional('GATEWAY_PUBLIC_URL', '').replace(/\/+$/, '');
const PUBLIC_MEDIA_PREFIX = optional('PUBLIC_MEDIA_PREFIX', GATEWAY_PUBLIC_URL ? `${GATEWAY_PUBLIC_URL}/media` : '/media')
  .replace(/\/+$/, '');
const TMP_ROOT = path.join(os.tmpdir(), 'myt');

const dirs = {
  raw: 'raw',               // video gốc người dùng tải lên (riêng tư)
  hls: 'hls',               // video đã chuyển mã HLS (phát qua streaming-service, có kiểm tra quyền)
  thumbnails: 'thumbnails', // public
  avatars: 'avatars',       // public
  images: 'images',         // public (ảnh bìa playlist...)
  tmp: 'tmp',
};
const PUBLIC_DIRS = [dirs.thumbnails, dirs.avatars, dirs.images];

const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
};
const contentType = (key) => CONTENT_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';

function normalizeKey(key) {
  const k = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!k || k.split('/').some((part) => part === '..')) throw new Error('Key lưu trữ không hợp lệ');
  return k;
}

/** Đường dẫn tuyệt đối trong STORAGE_DIR (driver local). Chặn path traversal. */
function abs(key) {
  const p = path.resolve(STORAGE_DIR, key);
  if (p !== STORAGE_DIR && !p.startsWith(STORAGE_DIR + path.sep)) throw new Error('Đường dẫn không hợp lệ');
  return p;
}

// ---------------------------------------------------------------------------
// S3 client (nạp lười để chạy local không cần cấu hình S3)
let s3;
function client() {
  if (s3) return s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: optional('S3_REGION', 'auto'),
    endpoint: optional('S3_ENDPOINT') || undefined,
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', false),
    credentials: {
      accessKeyId: optional('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: optional('S3_SECRET_ACCESS_KEY', ''),
    },
  });
  return s3;
}
const BUCKET = () => optional('S3_BUCKET', '');
const cmd = (name) => require('@aws-sdk/client-s3')[name];

async function s3Upload(key, body, type) {
  const { Upload } = require('@aws-sdk/lib-storage');
  // Upload multipart: stream file lớn mà không nạp hết vào RAM
  await new Upload({
    client: client(),
    params: { Bucket: BUCKET(), Key: key, Body: body, ContentType: type || contentType(key) },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  }).done();
}

async function s3ListKeys(prefix) {
  const keys = [];
  let token;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await client().send(new (cmd('ListObjectsV2Command'))({ Bucket: BUCKET(), Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents || []) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      // eslint-disable-next-line no-await-in-loop
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// API dùng chung cho mọi service

function ensureDirs() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  if (isS3) return;
  for (const d of Object.values(dirs)) fs.mkdirSync(path.join(STORAGE_DIR, d), { recursive: true });
}

/** Thư mục tạm cục bộ (multer ghi file upload vào đây trước khi chuyển lên storage). */
function tmpDir() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return TMP_ROOT;
}

/** Tạo đường dẫn file tạm duy nhất. */
function tmpPath(ext = '') {
  return path.join(tmpDir(), `${crypto.randomUUID()}${ext}`);
}

/** Đưa file cục bộ vào storage tại key. move=true: xoá file cục bộ sau khi chuyển. */
async function putFile(key, localPath, { move = true } = {}) {
  const k = normalizeKey(key);
  if (!isS3) {
    const dest = abs(k);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (move) {
      try { await fsp.rename(localPath, dest); return k; } catch { /* khác ổ đĩa -> copy */ }
    }
    await fsp.copyFile(localPath, dest);
    if (move) await fsp.rm(localPath, { force: true });
    return k;
  }
  await s3Upload(k, fs.createReadStream(localPath));
  if (move) await fsp.rm(localPath, { force: true });
  return k;
}

/** Tải cả thư mục cục bộ lên storage dưới prefix (dùng cho output HLS). Thay thế nội dung cũ. */
async function putDir(prefix, localDir) {
  const p = normalizeKey(prefix);
  if (!isS3) {
    const dest = abs(p);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(localDir, dest);
    } catch {
      await fsp.cp(localDir, dest, { recursive: true });
      await fsp.rm(localDir, { recursive: true, force: true });
    }
    return;
  }
  await remove(p);
  const files = [];
  const walk = async (dir) => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full); else files.push(full);
    }
  };
  await walk(localDir);
  await mapLimit(files, int('S3_UPLOAD_CONCURRENCY', 8), async (file) => {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    const key = `${p}/${rel}`;
    await client().send(new (cmd('PutObjectCommand'))({
      Bucket: BUCKET(), Key: key, Body: await fsp.readFile(file), ContentType: contentType(key),
    }));
  });
  await fsp.rm(localDir, { recursive: true, force: true });
}

/**
 * Trả về đường dẫn cục bộ đọc được của key. Driver local: chính file trong STORAGE_DIR.
 * Driver s3: tải về file tạm (nhớ gọi cleanup() khi xong).
 */
async function localCopy(key) {
  const k = normalizeKey(key);
  if (!isS3) return { path: abs(k), cleanup: async () => {} };
  const dest = tmpPath(path.extname(k));
  const res = await client().send(new (cmd('GetObjectCommand'))({ Bucket: BUCKET(), Key: k }));
  const { pipeline } = require('stream/promises');
  await pipeline(res.Body, fs.createWriteStream(dest));
  return { path: dest, cleanup: () => fsp.rm(dest, { force: true }) };
}

async function readText(key) {
  const k = normalizeKey(key);
  if (!isS3) return fsp.readFile(abs(k), 'utf8');
  const res = await client().send(new (cmd('GetObjectCommand'))({ Bucket: BUCKET(), Key: k }));
  return res.Body.transformToString('utf8');
}

async function exists(key) {
  const k = normalizeKey(key);
  if (!isS3) return fs.existsSync(abs(k));
  try {
    await client().send(new (cmd('HeadObjectCommand'))({ Bucket: BUCKET(), Key: k }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

/** Xoá một file hoặc cả "thư mục" (prefix). */
async function remove(key) {
  if (!key) return;
  const k = normalizeKey(key);
  if (!isS3) {
    await fsp.rm(abs(k), { recursive: true, force: true });
    return;
  }
  const keys = [k, ...(await s3ListKeys(`${k}/`))];
  for (let i = 0; i < keys.length; i += 1000) {
    // eslint-disable-next-line no-await-in-loop
    await client().send(new (cmd('DeleteObjectsCommand'))({
      Bucket: BUCKET(), Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

/** URL tải trực tiếp có chữ ký, hết hạn sau ttl giây (chỉ driver s3). */
async function signedUrl(key, ttl = 3600) {
  if (!isS3) return null;
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(client(), new (cmd('GetObjectCommand'))({ Bucket: BUCKET(), Key: normalizeKey(key) }), { expiresIn: ttl });
}

/** Kiểm tra kết nối storage (health check). */
async function ping() {
  if (!isS3) return fs.existsSync(STORAGE_DIR);
  await client().send(new (cmd('HeadBucketCommand'))({ Bucket: BUCKET() }));
  return true;
}

/** URL public cho file thuộc thư mục public (thumbnails, avatars, images) — phục vụ qua /media. */
function publicUrl(key) {
  if (!key) return '';
  if (/^https?:\/\//.test(key) || key.startsWith('/')) return key;
  return `${PUBLIC_MEDIA_PREFIX}/${key.replace(/\\/g, '/')}`;
}

/** Ngược lại với publicUrl: trả về key nếu URL trỏ vào storage của hệ thống. */
function keyFromUrl(url) {
  if (!url) return null;
  for (const prefix of new Set([PUBLIC_MEDIA_PREFIX, '/media'])) {
    if (url.startsWith(`${prefix}/`)) return url.slice(prefix.length + 1);
  }
  return null;
}

module.exports = {
  DRIVER, isS3, STORAGE_DIR, PUBLIC_MEDIA_PREFIX, PUBLIC_DIRS, dirs, contentType,
  abs, ensureDirs, tmpDir, tmpPath, putFile, putDir, localCopy, readText, exists, remove, signedUrl, ping,
  publicUrl, keyFromUrl,
};
