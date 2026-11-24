const express = require('express');
const { http, auth, db } = require('@myt/common');
const { WatchHistory, Video } = require('../models');

const router = express.Router();
router.use(auth.requireAuth);

router.get('/', async (req, res) => {
  const p = http.pagination(req.query, { defaultLimit: 30 });
  const query = { userId: req.user.id };
  const [entries, total] = await Promise.all([
    WatchHistory.find(query).sort({ watchedAt: -1 }).skip(p.skip).limit(p.limit).populate('video'),
    WatchHistory.countDocuments(query),
  ]);
  const items = entries.filter((e) => e.video && e.video.canView(req.user)).map((e) => ({
    ...e.video.toClient(req.user),
    position: e.position,
    watchedAt: e.watchedAt,
  }));
  res.json({ success: true, data: http.paged(items, total, p) });
});

// Vị trí xem dở của 1 video (để "tiếp tục xem")
router.get('/:videoId', async (req, res) => {
  if (!db.mongoose.isValidObjectId(req.params.videoId)) throw http.badRequest('videoId không hợp lệ');
  const entry = await WatchHistory.findOne({ userId: req.user.id, video: req.params.videoId });
  res.json({ success: true, data: { position: entry?.position || 0 } });
});

router.post('/', async (req, res) => {
  const { videoId } = req.body || {};
  const position = Math.max(0, Number(req.body?.position) || 0);
  if (!db.mongoose.isValidObjectId(videoId)) throw http.badRequest('videoId không hợp lệ');
  if (!(await Video.exists({ _id: videoId }))) throw http.notFound('Không tìm thấy video');
  await WatchHistory.updateOne(
    { userId: req.user.id, video: videoId },
    { $set: { position, watchedAt: new Date() } },
    { upsert: true },
  );
  res.json({ success: true });
});

router.delete('/', async (req, res) => {
  await WatchHistory.deleteMany({ userId: req.user.id });
  res.json({ success: true, message: 'Đã xoá lịch sử xem' });
});

router.delete('/:videoId', async (req, res) => {
  await WatchHistory.deleteOne({ userId: req.user.id, video: req.params.videoId });
  res.json({ success: true });
});

module.exports = router;
