const express = require('express');
const { http, auth, bus, db } = require('@myt/common');
const { Comment, Reaction, VideoRef } = require('./models');

const { mongoose } = db;

async function loadVideoRef(videoId, viewer) {
  if (!/^[a-f0-9]{24}$/i.test(String(videoId || ''))) throw http.badRequest('videoId không hợp lệ');
  const ref = await VideoRef.findById(videoId);
  if (!ref || !ref.isOpenFor(viewer)) throw http.notFound('Không tìm thấy video');
  return ref;
}

// ================= Bình luận =================
const comments = express.Router();

comments.get('/', auth.optionalAuth, async (req, res) => {
  const ref = await loadVideoRef(req.query.videoId, req.user);
  const p = http.pagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const query = { videoId: ref._id, parentId: null };
  const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
  const [items, total, all] = await Promise.all([
    Comment.find(query).sort(sort).skip(p.skip).limit(p.limit),
    Comment.countDocuments(query),
    Comment.countDocuments({ videoId: ref._id }),
  ]);
  res.json({
    success: true,
    data: { ...http.paged(items.map((c) => c.toClient(req.user, ref.ownerId)), total, p), totalWithReplies: all },
  });
});

comments.get('/:id/replies', auth.optionalAuth, async (req, res) => {
  const parent = await Comment.findById(req.params.id);
  if (!parent) throw http.notFound('Không tìm thấy bình luận');
  const ref = await loadVideoRef(parent.videoId, req.user);
  const p = http.pagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const query = { parentId: parent._id };
  const [items, total] = await Promise.all([
    Comment.find(query).sort({ createdAt: 1 }).skip(p.skip).limit(p.limit),
    Comment.countDocuments(query),
  ]);
  res.json({ success: true, data: http.paged(items.map((c) => c.toClient(req.user, ref.ownerId)), total, p) });
});

comments.post('/', auth.requireAuth, async (req, res) => {
  const { videoId, content, parentId } = req.body || {};
  const ref = await loadVideoRef(videoId, req.user);
  let parent = null;
  if (parentId) {
    if (!mongoose.isValidObjectId(parentId)) throw http.badRequest('parentId không hợp lệ');
    parent = await Comment.findById(parentId);
    if (!parent || parent.videoId !== ref._id) throw http.notFound('Không tìm thấy bình luận gốc');
    if (parent.parentId) parent = await Comment.findById(parent.parentId); // chỉ 1 cấp trả lời
  }
  const comment = await Comment.create({
    videoId: ref._id,
    user: { id: req.user.id, name: req.user.name, avatar: req.user.avatar },
    content,
    parentId: parent?._id || null,
  });
  if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });
  await bus.publish('comment.created', {
    videoId: ref._id, commentId: comment._id.toString(), parentId: parent?._id.toString() || null,
    userId: req.user.id, videoOwnerId: ref.ownerId,
  });
  res.status(201).json({ success: true, data: { comment: comment.toClient(req.user, ref.ownerId) } });
});

comments.put('/:id', auth.requireAuth, async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw http.notFound('Không tìm thấy bình luận');
  if (comment.user.id !== req.user.id) throw http.forbidden();
  comment.content = req.body?.content;
  comment.edited = true;
  await comment.save();
  const ref = await VideoRef.findById(comment.videoId);
  res.json({ success: true, data: { comment: comment.toClient(req.user, ref?.ownerId) } });
});

comments.delete('/:id', auth.requireAuth, async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw http.notFound('Không tìm thấy bình luận');
  const ref = await VideoRef.findById(comment.videoId);
  const allowed = req.user.isAdmin || comment.user.id === req.user.id || ref?.ownerId === req.user.id;
  if (!allowed) throw http.forbidden();

  let count = 1;
  if (comment.parentId) {
    await Comment.updateOne({ _id: comment.parentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
  } else {
    const r = await Comment.deleteMany({ parentId: comment._id });
    count += r.deletedCount;
  }
  await comment.deleteOne();
  await bus.publish('comment.deleted', { videoId: comment.videoId, count });
  res.json({ success: true, data: { deleted: count } });
});

// ================= Like / Dislike =================
const reactions = express.Router();

// Danh sách video đã thích của tôi (trả về id; frontend lấy chi tiết từ video-service)
reactions.get('/mine/liked', auth.requireAuth, async (req, res) => {
  const p = http.pagination(req.query, { defaultLimit: 30 });
  const query = { userId: req.user.id, value: 'like' };
  const [items, total] = await Promise.all([
    Reaction.find(query).sort({ updatedAt: -1 }).skip(p.skip).limit(p.limit),
    Reaction.countDocuments(query),
  ]);
  res.json({ success: true, data: http.paged(items.map((r) => ({ videoId: r.videoId, likedAt: r.updatedAt })), total, p) });
});

reactions.get('/:videoId', auth.optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ success: true, data: { reaction: null } });
  const r = await Reaction.findOne({ videoId: req.params.videoId, userId: req.user.id });
  res.json({ success: true, data: { reaction: r?.value || null } });
});

reactions.put('/:videoId', auth.requireAuth, async (req, res) => {
  const value = req.body?.reaction ?? null;
  if (![null, 'like', 'dislike'].includes(value)) throw http.badRequest('reaction phải là like, dislike hoặc null');
  const ref = await loadVideoRef(req.params.videoId, req.user);
  const filter = { videoId: ref._id, userId: req.user.id };

  // Thao tác nguyên tử: trả về giá trị CŨ để tính chênh lệch bộ đếm chính xác
  const previous = value
    ? await Reaction.findOneAndUpdate(filter, { $set: { value } }, { upsert: true, returnDocument: 'before' })
    : await Reaction.findOneAndDelete(filter);
  const old = previous?.value || null;

  const delta = { likeDelta: 0, dislikeDelta: 0 };
  if (old === 'like') delta.likeDelta -= 1;
  if (old === 'dislike') delta.dislikeDelta -= 1;
  if (value === 'like') delta.likeDelta += 1;
  if (value === 'dislike') delta.dislikeDelta += 1;
  if (delta.likeDelta || delta.dislikeDelta) {
    await bus.publish('reaction.changed', { videoId: ref._id, userId: req.user.id, ...delta });
  }
  res.json({ success: true, data: { reaction: value, ...delta } });
});

module.exports = { comments, reactions };
