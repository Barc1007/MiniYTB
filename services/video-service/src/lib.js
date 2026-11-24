const { bus, storage, env } = require('@myt/common');
const { Video, Playlist, WatchHistory } = require('./models');

const AUTO_APPROVE = env.bool('AUTO_APPROVE_VIDEOS', false);

function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))]
    .map((t) => t.slice(0, 30))
    .slice(0, 15);
}

/**
 * Phát trạng thái truy cập của video cho các service khác (streaming-service giữ bản sao
 * để kiểm tra quyền phát mà không cần gọi đồng bộ sang video-service).
 */
function publishState(video) {
  return bus.publish('video.state', {
    videoId: video._id.toString(),
    ownerId: video.owner.id,
    visibility: video.visibility,
    reviewStatus: video.review.status,
    processingStatus: video.processing.status,
  });
}

async function deleteVideo(video) {
  await Video.deleteOne({ _id: video._id });
  await Promise.all([
    Playlist.updateMany({ 'videos.video': video._id }, { $pull: { videos: { video: video._id } } }),
    WatchHistory.deleteMany({ video: video._id }),
    video.customThumbnail ? storage.remove(video.thumbnail).catch(() => {}) : null,
    video.rawKey ? storage.remove(video.rawKey).catch(() => {}) : null,
  ]);
  // streaming-service xoá file HLS; comment-service xoá bình luận & reaction
  await bus.publish('video.deleted', { videoId: video._id.toString(), ownerId: video.owner.id });
}

function approve(video, reviewer) {
  video.review = { status: 'approved', reason: '', reviewedAt: new Date(), reviewedBy: reviewer };
  if (!video.publishedAt) video.publishedAt = new Date();
}

module.exports = { AUTO_APPROVE, parseTags, publishState, deleteVideo, approve };
