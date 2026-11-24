// API phát video (HLS) + phục vụ file public (/media/thumbnails, /media/avatars, /media/images).
const fs = require('fs');
const path = require('path');
const express = require('express');
const { http, auth, bus, storage, env } = require('@myt/common');
const { StreamAsset } = require('./models');

const FREE_MAX_HEIGHT = env.int('FREE_MAX_HEIGHT', 720);

// Cache nhỏ trong bộ nhớ để không truy vấn DB cho từng segment (vài trăm request / video)
const cache = new Map();
const CACHE_TTL = 30 * 1000;
async function getAsset(id) {
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit.asset;
  const asset = await StreamAsset.findById(id).lean();
  cache.set(id, { asset, exp: Date.now() + CACHE_TTL });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return asset;
}

function canWatch(asset, viewer) {
  if (!asset || asset.processingStatus !== 'ready') return false;
  if (viewer && (viewer.isAdmin || viewer.id === asset.ownerId)) return true;
  return asset.reviewStatus === 'approved' && asset.visibility !== 'private';
}

/** Độ phân giải được phép theo gói: khách & free tối đa FREE_MAX_HEIGHT, premium/admin không giới hạn. */
function maxHeightFor(viewer) {
  if (viewer && (viewer.isAdmin || viewer.plan === 'premium')) return Infinity;
  return FREE_MAX_HEIGHT;
}

function renditionAllowed(asset, name, viewer) {
  const r = asset.renditions?.find((x) => x.name === name);
  if (!r) return false;
  // luôn cho phép bậc thấp nhất để video nhỏ hơn giới hạn vẫn xem được
  const lowest = Math.min(...asset.renditions.map((x) => x.height));
  return r.height <= maxHeightFor(viewer) || r.height === lowest;
}

const router = express.Router();
router.use(auth.optionalAuth);

async function loadWatchable(req) {
  const id = req.params.videoId;
  if (!/^[a-f0-9]{24}$/i.test(id)) throw http.notFound();
  const asset = await getAsset(id);
  if (!canWatch(asset, req.user)) throw http.notFound('Video không tồn tại hoặc bạn không có quyền xem');
  return asset;
}

// Thông tin chất lượng: frontend dùng để hiển thị nút chọn chất lượng & khoá 1080p cho tài khoản free
router.get('/:videoId/info', async (req, res) => {
  const asset = await loadWatchable(req);
  res.json({
    success: true,
    data: {
      renditions: asset.renditions.map((r) => ({ ...r, allowed: renditionAllowed(asset, r.name, req.user), premiumOnly: r.height > FREE_MAX_HEIGHT })),
      maxHeight: maxHeightFor(req.user) === Infinity ? null : FREE_MAX_HEIGHT,
      plan: req.user?.plan || 'guest',
    },
  });
});

// Master playlist được lọc theo gói dịch vụ của người xem
router.get('/:videoId/master.m3u8', async (req, res) => {
  const asset = await loadWatchable(req);
  let content;
  try {
    content = await storage.readText(`${storage.dirs.hls}/${req.params.videoId}/master.m3u8`);
  } catch {
    throw http.notFound('Video chưa sẵn sàng');
  }

  const lines = content.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const uri = lines[i + 1] || '';
      const name = uri.split('/')[0];
      if (renditionAllowed(asset, name, req.user)) out.push(line, uri);
      i++;
    } else if (line.trim()) {
      out.push(line);
    }
  }
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(`${out.join('\n')}\n`);
});

const SIGNED_TTL = 2 * 3600; // URL segment có hiệu lực 2 giờ

// Playlist từng chất lượng & segment
router.get('/:videoId/:rendition/:file', async (req, res) => {
  const { videoId, rendition, file } = req.params;
  if (!/^[\w-]+$/.test(rendition) || !/^(index\.m3u8|seg_\d+\.ts)$/.test(file)) throw http.notFound();
  const asset = await loadWatchable(req);
  if (!renditionAllowed(asset, rendition, req.user)) throw http.forbidden('Chất lượng này dành cho tài khoản Premium');
  const key = `${storage.dirs.hls}/${videoId}/${rendition}/${file}`;

  if (file.endsWith('.m3u8')) {
    let content;
    try { content = await storage.readText(key); } catch { throw http.notFound(); }
    if (storage.isS3) {
      // Thay tên segment bằng URL có chữ ký -> trình duyệt tải segment thẳng từ object storage/CDN,
      // không đi qua service (tiết kiệm băng thông), nhưng vẫn chỉ ai qua được kiểm tra quyền mới có URL.
      const lines = content.split(/\r?\n/);
      content = (await Promise.all(lines.map((line) => (/^seg_\d+\.ts$/.test(line.trim())
        ? storage.signedUrl(`${storage.dirs.hls}/${videoId}/${rendition}/${line.trim()}`, SIGNED_TTL)
        : line)))).join('\n');
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.send(content);
  }

  if (storage.isS3) return res.redirect(302, await storage.signedUrl(key, SIGNED_TTL));
  const full = storage.abs(key);
  if (!fs.existsSync(full)) throw http.notFound();
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.sendFile(full);
});

/** File public (thumbnail, avatar, ảnh): local -> phục vụ trực tiếp; s3 -> chuyển hướng tới URL có chữ ký. */
function mountMedia(app) {
  for (const dir of storage.PUBLIC_DIRS) {
    if (!storage.isS3) {
      app.use(`/media/${dir}`, express.static(storage.abs(dir), {
        maxAge: '7d', index: false, dotfiles: 'deny', fallthrough: false,
      }));
      continue;
    }
    app.get(`/media/${dir}/:file`, async (req, res) => {
      if (!/^[\w.-]+$/.test(req.params.file)) throw http.notFound();
      // Chữ ký 6 giờ, trình duyệt cache redirect 5 giờ -> ảnh được cache mà URL không hết hạn giữa chừng
      res.setHeader('Cache-Control', 'public, max-age=18000');
      res.redirect(302, await storage.signedUrl(`${dir}/${req.params.file}`, 6 * 3600));
    });
  }
}

async function registerEvents() {
  // prefetch=1 để giữ đúng thứ tự sự kiện của cùng một video
  await bus.subscribe('streaming-service.state', ['video.state', 'video.deleted'], async (data, type) => {
    cache.delete(data.videoId);
    if (type === 'video.deleted') {
      await StreamAsset.deleteOne({ _id: data.videoId });
      await storage.remove(`${storage.dirs.hls}/${data.videoId}`);
      await storage.remove(`${storage.dirs.thumbnails}/${data.videoId}-auto.jpg`);
      return;
    }
    await StreamAsset.updateOne({ _id: data.videoId }, {
      $set: {
        ownerId: data.ownerId,
        visibility: data.visibility,
        reviewStatus: data.reviewStatus,
        processingStatus: data.processingStatus,
      },
    }, { upsert: true });
  }, { prefetch: 1 });
}

module.exports = { router, mountMedia, registerEvents, canWatch, renditionAllowed, maxHeightFor };
