const express = require('express');
const { http, auth, db } = require('@myt/common');
const { Playlist, Video } = require('../models');

const router = express.Router();
const { mongoose } = db;

function summary(pl, viewer, videos) {
  const visible = (videos || []).filter((v) => v && v.canView(viewer));
  return {
    id: pl._id.toString(),
    name: pl.name,
    description: pl.description,
    owner: pl.owner,
    visibility: pl.visibility,
    videoCount: pl.videos.length,
    thumbnail: visible[0]?.toClient(viewer).thumbnail || '',
    createdAt: pl.createdAt,
    updatedAt: pl.updatedAt,
  };
}

async function withFirstVideos(playlists) {
  const firstIds = playlists.map((p) => p.videos[0]?.video).filter(Boolean);
  const vids = await Video.find({ _id: { $in: firstIds } });
  const map = new Map(vids.map((v) => [v._id.toString(), v]));
  return playlists.map((p) => [p, p.videos[0] ? [map.get(p.videos[0].video.toString())] : []]);
}

async function loadPlaylist(id) {
  if (!mongoose.isValidObjectId(id)) throw http.notFound('Không tìm thấy playlist');
  const pl = await Playlist.findById(id);
  if (!pl) throw http.notFound('Không tìm thấy playlist');
  return pl;
}

const isOwner = (pl, user) => !!user && (user.isAdmin || pl.owner.id === user.id);

router.get('/', auth.optionalAuth, async (req, res) => {
  const p = http.pagination(req.query, { defaultLimit: 24 });
  const query = { visibility: 'public', 'videos.0': { $exists: true } };
  if (req.query.owner) query['owner.id'] = String(req.query.owner);
  if (req.query.search) query.name = new RegExp(http.escapeRegex(req.query.search), 'i');
  const [list, total] = await Promise.all([
    Playlist.find(query).sort({ updatedAt: -1 }).skip(p.skip).limit(p.limit),
    Playlist.countDocuments(query),
  ]);
  const items = (await withFirstVideos(list)).map(([pl, vids]) => summary(pl, req.user, vids));
  res.json({ success: true, data: http.paged(items, total, p) });
});

router.get('/mine', auth.requireAuth, async (req, res) => {
  const list = await Playlist.find({ 'owner.id': req.user.id }).sort({ updatedAt: -1 });
  const items = (await withFirstVideos(list)).map(([pl, vids]) => ({
    ...summary(pl, req.user, vids),
    videoIds: pl.videos.map((v) => v.video.toString()),
  }));
  res.json({ success: true, data: { items } });
});

router.get('/:id', auth.optionalAuth, async (req, res) => {
  const pl = await loadPlaylist(req.params.id);
  if (pl.visibility === 'private' && !isOwner(pl, req.user)) throw http.notFound('Không tìm thấy playlist');
  const ids = pl.videos.map((v) => v.video);
  const vids = await Video.find({ _id: { $in: ids } });
  const map = new Map(vids.map((v) => [v._id.toString(), v]));
  const ordered = pl.videos.map((entry) => ({ entry, video: map.get(entry.video.toString()) }))
    .filter((x) => x.video && x.video.canView(req.user));
  res.json({
    success: true,
    data: {
      playlist: {
        ...summary(pl, req.user, ordered.map((x) => x.video)),
        videos: ordered.map((x) => ({ ...x.video.toClient(req.user), addedAt: x.entry.addedAt })),
      },
    },
  });
});

router.post('/', auth.requireAuth, async (req, res) => {
  const { name, description, visibility } = req.body || {};
  const count = await Playlist.countDocuments({ 'owner.id': req.user.id });
  if (count >= 200) throw http.badRequest('Bạn đã đạt giới hạn 200 playlist');
  const pl = await Playlist.create({
    name, description,
    visibility: visibility === 'private' ? 'private' : 'public',
    owner: { id: req.user.id, name: req.user.name, avatar: req.user.avatar },
  });
  res.status(201).json({ success: true, data: { playlist: { ...summary(pl, req.user, []), videoIds: [] } } });
});

router.put('/:id', auth.requireAuth, async (req, res) => {
  const pl = await loadPlaylist(req.params.id);
  if (!isOwner(pl, req.user)) throw http.forbidden();
  const { name, description, visibility } = req.body || {};
  if (name !== undefined) pl.name = name;
  if (description !== undefined) pl.description = description;
  if (visibility !== undefined) pl.visibility = visibility === 'private' ? 'private' : 'public';
  await pl.save();
  res.json({ success: true, data: { playlist: summary(pl, req.user, []) } });
});

router.delete('/:id', auth.requireAuth, async (req, res) => {
  const pl = await loadPlaylist(req.params.id);
  if (!isOwner(pl, req.user)) throw http.forbidden();
  await pl.deleteOne();
  res.json({ success: true, message: 'Đã xoá playlist' });
});

router.post('/:id/videos', auth.requireAuth, async (req, res) => {
  const pl = await loadPlaylist(req.params.id);
  if (!isOwner(pl, req.user)) throw http.forbidden();
  const { videoId } = req.body || {};
  if (!mongoose.isValidObjectId(videoId)) throw http.badRequest('videoId không hợp lệ');
  const video = await Video.findById(videoId);
  if (!video || !video.canView(req.user)) throw http.notFound('Không tìm thấy video');
  if (pl.videos.some((v) => v.video.toString() === videoId)) throw http.conflict('Video đã có trong playlist');
  if (pl.videos.length >= 500) throw http.badRequest('Playlist tối đa 500 video');
  pl.videos.push({ video: video._id });
  await pl.save();
  res.json({ success: true, data: { videoCount: pl.videos.length } });
});

router.delete('/:id/videos/:videoId', auth.requireAuth, async (req, res) => {
  const pl = await loadPlaylist(req.params.id);
  if (!isOwner(pl, req.user)) throw http.forbidden();
  const before = pl.videos.length;
  pl.videos = pl.videos.filter((v) => v.video.toString() !== req.params.videoId);
  if (pl.videos.length === before) throw http.notFound('Video không có trong playlist');
  await pl.save();
  res.json({ success: true, data: { videoCount: pl.videos.length } });
});

module.exports = router;
