const express = require('express');
const { http, auth, bus } = require('@myt/common');
const { Video } = require('../models');
const { publishState, deleteVideo, approve } = require('../lib');

const router = express.Router();
router.use(auth.requireRole('admin'));

router.get('/', async (req, res) => {
  const { review, processing, search } = req.query;
  const p = http.pagination(req.query, { defaultLimit: 30 });
  const query = {};
  if (review) query['review.status'] = review;
  if (processing) query['processing.status'] = processing;
  if (search) {
    const rx = new RegExp(http.escapeRegex(search), 'i');
    query.$or = [{ title: rx }, { 'owner.name': rx }];
  }
  const [items, total] = await Promise.all([
    Video.find(query).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    Video.countDocuments(query),
  ]);
  res.json({ success: true, data: http.paged(items.map((v) => v.toClient(req.user)), total, p) });
});

router.get('/stats', async (req, res) => {
  const [byReview, byProcessing, totals, top] = await Promise.all([
    Video.aggregate([{ $group: { _id: '$review.status', count: { $sum: 1 } } }]),
    Video.aggregate([{ $group: { _id: '$processing.status', count: { $sum: 1 } } }]),
    Video.aggregate([{
      $group: {
        _id: null, videos: { $sum: 1 }, views: { $sum: '$stats.views' }, likes: { $sum: '$stats.likes' },
        comments: { $sum: '$stats.comments' }, storage: { $sum: '$size' }, duration: { $sum: '$duration' },
      },
    }]),
    Video.find({ 'review.status': 'approved' }).sort({ 'stats.views': -1 }).limit(5),
  ]);
  const toMap = (arr) => Object.fromEntries(arr.map((x) => [x._id, x.count]));
  res.json({
    success: true,
    data: {
      review: toMap(byReview),
      processing: toMap(byProcessing),
      totals: totals[0] || { videos: 0, views: 0, likes: 0, comments: 0, storage: 0, duration: 0 },
      top: top.map((v) => v.toClient(req.user)),
    },
  });
});

async function load(id) {
  const video = await Video.findById(id);
  if (!video) throw http.notFound('Không tìm thấy video');
  return video;
}

router.put('/:id/approve', async (req, res) => {
  const video = await load(req.params.id);
  approve(video, req.user.id);
  await video.save();
  await publishState(video);
  await bus.publish('video.approved', { videoId: video._id.toString(), ownerId: video.owner.id, title: video.title });
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

router.put('/:id/reject', async (req, res) => {
  const video = await load(req.params.id);
  video.review = { status: 'rejected', reason: String(req.body?.reason || '').slice(0, 500), reviewedAt: new Date(), reviewedBy: req.user.id };
  await video.save();
  await publishState(video);
  res.json({ success: true, data: { video: video.toClient(req.user) } });
});

router.delete('/:id', async (req, res) => {
  await deleteVideo(await load(req.params.id));
  res.json({ success: true, message: 'Đã xoá video' });
});

module.exports = router;
