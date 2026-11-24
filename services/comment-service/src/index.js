// COMMENT SERVICE: bình luận (có trả lời), like/dislike video.
// Database riêng: myt_comments
const { env, http, db, bus } = require('@myt/common');
const { Comment, Reaction, VideoRef } = require('./models');
const { comments, reactions } = require('./routes');

const PORT = env.int('COMMENT_SERVICE_PORT', env.int('PORT', 4004));

async function registerEvents() {
  await bus.subscribe('comment-service.videos', ['video.state', 'video.deleted'], async (data, type) => {
    if (type === 'video.deleted') {
      await Promise.all([
        Comment.deleteMany({ videoId: data.videoId }),
        Reaction.deleteMany({ videoId: data.videoId }),
        VideoRef.deleteOne({ _id: data.videoId }),
      ]);
      return;
    }
    await VideoRef.updateOne({ _id: data.videoId }, {
      $set: { ownerId: data.ownerId, visibility: data.visibility, reviewStatus: data.reviewStatus, processingStatus: data.processingStatus },
    }, { upsert: true });
  }, { prefetch: 1 });

  await bus.subscribe('comment-service.users', ['user.updated', 'user.deleted'], async (data, type) => {
    if (type === 'user.updated') {
      await Comment.updateMany({ 'user.id': data.userId }, { $set: { 'user.name': data.name, 'user.avatar': data.avatar } });
      return;
    }
    // Xoá bình luận của user + trả lời bên dưới, rồi báo video-service giảm bộ đếm
    const mine = await Comment.find({ 'user.id': data.userId });
    const topIds = mine.filter((c) => !c.parentId).map((c) => c._id);
    const replies = await Comment.find({ parentId: { $in: topIds } });
    const doomed = [...mine, ...replies.filter((r) => r.user.id !== data.userId)];
    const perVideo = {};
    for (const c of doomed) perVideo[c.videoId] = (perVideo[c.videoId] || 0) + 1;
    for (const c of mine) {
      if (c.parentId && !topIds.some((id) => id.equals(c.parentId))) {
        await Comment.updateOne({ _id: c.parentId, replyCount: { $gt: 0 } }, { $inc: { replyCount: -1 } });
      }
    }
    await Comment.deleteMany({ _id: { $in: doomed.map((c) => c._id) } });
    for (const [videoId, count] of Object.entries(perVideo)) await bus.publish('comment.deleted', { videoId, count });

    const myReactions = await Reaction.find({ userId: data.userId });
    await Reaction.deleteMany({ userId: data.userId });
    for (const r of myReactions) {
      await bus.publish('reaction.changed', {
        videoId: r.videoId, userId: data.userId,
        likeDelta: r.value === 'like' ? -1 : 0, dislikeDelta: r.value === 'dislike' ? -1 : 0,
      });
    }
  });
}

async function main() {
  await db.connectMongo(db.mongoUri('myt_comments'));
  await Promise.all([Comment.init(), Reaction.init(), VideoRef.init()]);
  await registerEvents();
  bus.connect();

  const app = http.createApp('comment-service', { healthChecks: { rabbitmq: bus.isConnected } });
  app.use('/api/comments', comments);
  app.use('/api/reactions', reactions);
  http.finalize(app);
  http.listen(app, PORT, bus.close);
}

main().catch((err) => {
  console.error('❌ comment-service không khởi động được:', err);
  process.exit(1);
});
