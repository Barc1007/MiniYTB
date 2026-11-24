const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { http, auth, bus, storage, env, db } = require('@myt/common');
const { Video, ViewEvent } = require('../models');
const { AUTO_APPROVE, parseTags, publishState, deleteVideo } = require('../lib');

const router = express.Router();
const { mongoose } = db;

const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.3gp', '.flv', '.wmv'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const MB = 1024 * 1024;
const LIMIT_FREE = env.int('MAX_UPLOAD_MB_FREE', 500) * MB;
const LIMIT_PREMIUM = env.int('MAX_UPLOAD_MB_PREMIUM', 4096) * MB;

const listedFilter = () => ({ 'processing.status': 'ready', 'review.status': 'approved', visibility: 'public' });

const SORTS = {
  latest: { publishedAt: -1, _id: -1 },
  oldest: { publishedAt: 1, _id: 1 },
  popular: { 'stats.views': -1, _id: -1 },
  liked: { 'stats.likes': -1, _id: -1 },
};

async function loadVideo(id) {
  if (!mongoose.isValidObjectId(id)) throw http.notFound('Không tìm thấy video');
  const video = await Video.findById(id);
  if (!video) throw http.notFound('Không tìm thấy video');
  return video;
}

function assertOwner(video, user) {
  if (!user.isAdmin && video.owner.id !== user.id) throw http.forbidden();
}

// ---------- Danh sách ----------
router.get('/', auth.optionalAuth, async (req, res) => {
  const { search, tag, owner, sort = 'latest' } = req.query;
  const p = http.pagination(req.query, { defaultLimit: 24 });
  const query = listedFilter();
  if (owner) query['owner.id'] = String(owner);
  if (tag) query.tags = String(tag).toLowerCase();
  if (search) {
    const rx = new RegExp(http.escapeRegex(String(search).trim()), 'i');
    query.$or = [{ title: rx }, { description: rx }, { tags: rx }, { 'owner.name': rx }];
  }
  const [items, total] = await Promise.all([
    Video.find(query).sort(SORTS[sort] || SORTS.latest).skip(p.skip).limit(p.limit),
    Video.countDocuments(query),
  ]);
  res.json({ success: true, data: http.paged(items.map((v) => v.toClient(req.user)), total, p) });
});

router.get('/trending', auth.optionalAuth, async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 12);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  let items = await Video.find({ ...listedFilter(), publishedAt: { $gte: since } })
    .sort({ 'stats.views': -1, 'stats.likes': -1 }).limit(limit);
  if (items.length < limit) {
    const more = await Video.find({ ...listedFilter(), _id: { $nin: items.map((v) => v._id) } })
      .sort({ 'stats.views': -1 }).limit(limit - items.length);
    items = items.concat(more);
  }
  res.json({ success: true, data: { items: items.map((v) => v.toClient(req.user)) } });
});

// Giới hạn dung lượng upload theo gói (frontend hiển thị & kiểm tra trước khi tải lên)
router.get('/limits', (req, res) => {
  res.json({ success: true, data: { freeMb: LIMIT_FREE / MB, premiumMb: LIMIT_PREMIUM / MB } });
});

router.get('/tags', async (req, res) => {
  const tags = await Video.aggregate([
    { $match: listedFilter() },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 20 },
  ]);
  res.json({ success: true, data: { tags: tags.map((t) => ({ name: t._id, count: t.count })) } });
});

router.get('/mine', auth.requireAuth, async (req, res) => {
  const p = http.pagination(req.query, { defaultLimit: 50 });
  const query = { 'owner.id': req.user.id };
  const [items, total, agg] = await Promise.all([
    Video.find(query).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    Video.countDocuments(query),
    Video.aggregate([{ $match: query }, {
      $group: { _id: null, views: { $sum: '$stats.views' }, likes: { $sum: '$stats.likes' }, comments: { $sum: '$stats.comments' } },
    }]),
  ]);
  res.json({
    success: true,
    data: { ...http.paged(items.map((v) => v.toClient(req.user)), total, p), totals: agg[0] || { views: 0, likes: 0, comments: 0 } },
  });
});

// Lấy nhiều video theo danh sách id (dùng cho trang "Video đã thích" — id lấy từ comment-service)
router.get('/batch', auth.optionalAuth, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((id) => mongoose.isValidObjectId(id)).slice(0, 100);
  const videos = await Video.find({ _id: { $in: ids } });
  const byId = new Map(videos.map((v) => [v._id.toString(), v]));
  const items = ids.map((id) => byId.get(id)).filter((v) => v && v.canView(req.user)).map((v) => v.toClient(req.user));
  res.json({ success: true, data: { items } });
});

// ---------- Chi tiết ----------
router.get('/:id', auth.optionalAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  if (!video.canView(req.user)) throw http.notFound('Video không tồn tại hoặc chưa được công khai');
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

router.get('/:id/related', auth.optionalAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  const limit = Math.min(30, parseInt(req.query.limit, 10) || 12);
  const base = { ...listedFilter(), _id: { $ne: video._id } };
  let items = video.tags.length
    ? await Video.find({ ...base, tags: { $in: video.tags } }).sort({ 'stats.views': -1 }).limit(limit)
    : [];
  if (items.length < limit) {
    const exclude = [video._id, ...items.map((v) => v._id)];
    const more = await Video.find({ ...listedFilter(), _id: { $nin: exclude }, 'owner.id': video.owner.id })
      .sort({ publishedAt: -1 }).limit(limit - items.length);
    items = items.concat(more);
  }
  if (items.length < limit) {
    const exclude = [video._id, ...items.map((v) => v._id)];
    const more = await Video.find({ ...listedFilter(), _id: { $nin: exclude } }).sort({ 'stats.views': -1 }).limit(limit - items.length);
    items = items.concat(more);
  }
  res.json({ success: true, data: { items: items.map((v) => v.toClient(req.user)) } });
});

// ---------- Upload ----------
function uploadMiddleware(req, res, next) {
  req.videoId = new mongoose.Types.ObjectId();
  const upload = multer({
    storage: multer.diskStorage({
      destination: (r, file, cb) => cb(null, storage.tmpDir()), // ghi tạm, sau đó putFile vào storage
      filename: (r, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, file.fieldname === 'video' ? `${req.videoId}${ext}` : `${req.videoId}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: req.user.plan === 'premium' ? LIMIT_PREMIUM : LIMIT_FREE, files: 2 },
    fileFilter: (r, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (file.fieldname === 'video') {
        const ok = file.mimetype.startsWith('video/') || VIDEO_EXT.includes(ext);
        return cb(ok ? null : http.badRequest('File video không được hỗ trợ'), ok);
      }
      if (file.fieldname === 'thumbnail') {
        const ok = file.mimetype.startsWith('image/') && IMAGE_EXT.includes(ext);
        return cb(ok ? null : http.badRequest('Ảnh thumbnail phải là JPG/PNG/WEBP'), ok);
      }
      return cb(http.badRequest(`Trường file không hợp lệ: ${file.fieldname}`), false);
    },
  }).fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

  upload(req, res, (err) => {
    if (err) {
      cleanupFiles(req);
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = (req.user.plan === 'premium' ? LIMIT_PREMIUM : LIMIT_FREE) / MB;
        return next(new http.HttpError(413, `Video vượt quá ${mb} MB${req.user.plan === 'premium' ? '' : ' (nâng cấp Premium để tải file lớn hơn)'}`));
      }
      return next(err);
    }
    next();
  });
}

// Xoá các file tạm multer đã ghi
function cleanupFiles(req) {
  for (const f of Object.values(req.files || {}).flat()) fs.rm(f.path, { force: true }, () => {});
}

router.post('/', auth.requireAuth, uploadMiddleware, async (req, res) => {
  const file = req.files?.video?.[0];
  const thumb = req.files?.thumbnail?.[0];
  if (!file) {
    cleanupFiles(req);
    throw http.badRequest('Vui lòng chọn file video');
  }
  const rawKey = `${storage.dirs.raw}/${file.filename}`;
  const thumbKey = thumb ? `${storage.dirs.thumbnails}/${thumb.filename}` : '';
  try {
    // Chuyển file từ thư mục tạm vào storage (ổ đĩa chung hoặc S3/R2)
    await storage.putFile(rawKey, file.path);
    if (thumb) await storage.putFile(thumbKey, thumb.path);

    const { title, description, tags, visibility } = req.body || {};
    const video = await Video.create({
      _id: req.videoId,
      title: (title || path.parse(file.originalname).name).slice(0, 150),
      description: description || '',
      tags: parseTags(tags),
      visibility: ['public', 'unlisted', 'private'].includes(visibility) ? visibility : 'public',
      owner: { id: req.user.id, name: req.user.name, avatar: req.user.avatar },
      ownerIsAdmin: req.user.isAdmin,
      rawKey,
      originalName: file.originalname,
      size: file.size,
      thumbnail: thumbKey,
      customThumbnail: !!thumb,
    });
    await bus.publish('video.uploaded', {
      videoId: video._id.toString(),
      rawKey: video.rawKey,
      needThumbnail: !thumb,
      ownerId: video.owner.id,
    });
    await publishState(video);
    res.status(201).json({ success: true, data: { video: video.toClient(req.user) } });
  } catch (err) {
    cleanupFiles(req);
    await storage.remove(rawKey).catch(() => {});
    if (thumbKey) await storage.remove(thumbKey).catch(() => {});
    throw err;
  }
});

// Thử chuyển mã lại khi lần trước thất bại (file gốc vẫn còn)
router.post('/:id/retry', auth.requireAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  assertOwner(video, req.user);
  if (video.processing.status !== 'failed' || !video.rawKey) throw http.badRequest('Video không ở trạng thái lỗi');
  video.processing = { status: 'queued', progress: 0, error: '' };
  await video.save();
  await bus.publish('video.uploaded', { videoId: video._id.toString(), rawKey: video.rawKey, needThumbnail: !video.customThumbnail, ownerId: video.owner.id });
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

// ---------- Chỉnh sửa / xoá ----------
router.put('/:id', auth.requireAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  assertOwner(video, req.user);
  const { title, description, tags, visibility } = req.body || {};
  if (title !== undefined) video.title = title;
  if (description !== undefined) video.description = description;
  if (tags !== undefined) video.tags = parseTags(tags);
  const visibilityChanged = visibility !== undefined && visibility !== video.visibility;
  if (visibility !== undefined) {
    if (!['public', 'unlisted', 'private'].includes(visibility)) throw http.badRequest('Chế độ hiển thị không hợp lệ');
    video.visibility = visibility;
  }
  await video.save();
  if (visibilityChanged) await publishState(video);
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (r, f, cb) => cb(null, storage.tmpDir()),
    filename: (r, f, cb) => cb(null, `${r.params.id}-${crypto.randomBytes(4).toString('hex')}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * MB, files: 1 },
  fileFilter: (r, file, cb) => {
    const ok = file.mimetype.startsWith('image/') && IMAGE_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : http.badRequest('Ảnh thumbnail phải là JPG/PNG/WEBP'), ok);
  },
});

router.post('/:id/thumbnail', auth.requireAuth, async (req, res, next) => {
  const video = await loadVideo(req.params.id);
  assertOwner(video, req.user);
  req.video = video;
  next();
}, thumbUpload.single('thumbnail'), async (req, res) => {
  if (!req.file) throw http.badRequest('Vui lòng chọn ảnh');
  const { video } = req;
  const old = video.thumbnail;
  video.thumbnail = await storage.putFile(`${storage.dirs.thumbnails}/${req.file.filename}`, req.file.path);
  video.customThumbnail = true;
  await video.save();
  if (old && old !== video.thumbnail) await storage.remove(old).catch(() => {});
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

router.delete('/:id', auth.requireAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  assertOwner(video, req.user);
  await deleteVideo(video);
  res.json({ success: true, message: 'Đã xoá video' });
});

// ---------- Lượt xem ----------
router.post('/:id/view', auth.optionalAuth, async (req, res) => {
  const video = await loadVideo(req.params.id);
  if (!video.canView(req.user) || video.processing.status !== 'ready') throw http.notFound();
  const viewerKey = req.user ? `u:${req.user.id}` : `ip:${req.clientIp}`;
  let counted = false;
  try {
    await ViewEvent.create({ video: video._id, viewerKey });
    await Video.updateOne({ _id: video._id }, { $inc: { 'stats.views': 1 } });
    counted = true;
  } catch (err) {
    if (err.code !== 11000) throw err; // trùng => đã tính view trong 6 giờ qua
  }
  res.json({ success: true, data: { counted, views: video.stats.views + (counted ? 1 : 0) } });
});

module.exports = router;
module.exports.AUTO_APPROVE = AUTO_APPROVE;
