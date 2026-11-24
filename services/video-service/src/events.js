// Các sự kiện video-service lắng nghe từ những service khác.
const { bus, storage, env } = require('@myt/common');
const { Video, Playlist, WatchHistory } = require('./models');
const { AUTO_APPROVE, publishState, deleteVideo, approve } = require('./lib');

const KEEP_RAW = env.bool('KEEP_RAW_VIDEO', false);

async function register() {
  // ---- Từ streaming-service: tiến trình chuyển mã ----
  await bus.subscribe('video-service.transcode', [
    'video.transcode.progress', 'video.transcoded', 'video.transcode.failed',
  ], async (data, type) => {
    const video = await Video.findById(data.videoId);
    if (!video) return;

    if (type === 'video.transcode.progress') {
      // Lọc theo trạng thái để sự kiện progress đến muộn không ghi đè trạng thái "ready"
      await Video.updateOne(
        { _id: video._id, 'processing.status': { $in: ['queued', 'processing'] } },
        { $set: { 'processing.status': 'processing', 'processing.progress': data.progress } },
      );
      return;
    }

    if (type === 'video.transcode.failed') {
      video.processing = { status: 'failed', progress: 0, error: data.error || 'Chuyển mã thất bại' };
      await video.save();
      await publishState(video);
      return;
    }

    // video.transcoded
    video.processing = { status: 'ready', progress: 100, error: '' };
    video.duration = data.duration;
    video.width = data.width;
    video.height = data.height;
    video.renditions = data.renditions;
    if (!video.customThumbnail && data.thumbnail) video.thumbnail = data.thumbnail;
    if (video.review.status === 'pending' && (AUTO_APPROVE || video.ownerIsAdmin)) approve(video, 'auto');
    const rawKey = video.rawKey;
    if (!KEEP_RAW) video.rawKey = undefined;
    await video.save();
    if (!KEEP_RAW && rawKey) await storage.remove(rawKey).catch(() => {});
    await publishState(video);
  }, { prefetch: 20 });

  // ---- Từ comment-service: cập nhật bộ đếm ----
  await bus.subscribe('video-service.counters', ['comment.created', 'comment.deleted', 'reaction.changed'], async (data, type) => {
    const inc = {};
    if (type === 'comment.created') inc['stats.comments'] = 1;
    if (type === 'comment.deleted') inc['stats.comments'] = -(data.count || 1);
    if (type === 'reaction.changed') {
      if (data.likeDelta) inc['stats.likes'] = data.likeDelta;
      if (data.dislikeDelta) inc['stats.dislikes'] = data.dislikeDelta;
    }
    if (!Object.keys(inc).length) return;
    await Video.updateOne({ _id: data.videoId }, { $inc: inc });
    // không để bộ đếm âm (trường hợp sự kiện đến không theo thứ tự)
    await Video.updateOne({ _id: data.videoId, 'stats.comments': { $lt: 0 } }, { $set: { 'stats.comments': 0 } });
  });

  // ---- Từ user-service: đồng bộ thông tin chủ kênh & dọn dữ liệu khi xoá tài khoản ----
  await bus.subscribe('video-service.users', ['user.updated', 'user.deleted'], async (data, type) => {
    if (type === 'user.updated') {
      const owner = { 'owner.name': data.name, 'owner.avatar': data.avatar };
      await Video.updateMany({ 'owner.id': data.userId }, { $set: owner });
      await Playlist.updateMany({ 'owner.id': data.userId }, { $set: owner });
      return;
    }
    const videos = await Video.find({ 'owner.id': data.userId });
    for (const v of videos) await deleteVideo(v);
    await Playlist.deleteMany({ 'owner.id': data.userId });
    await WatchHistory.deleteMany({ userId: data.userId });
    console.log(`🧹 Đã xoá ${videos.length} video của user ${data.userId}`);
  });
}

module.exports = { register, publishState };
