const { mongoose } = require('@myt/common').db;
const { storage } = require('@myt/common');

const { Schema } = mongoose;

// Bản sao (snapshot) thông tin chủ kênh — được đồng bộ qua sự kiện user.updated
const ownerSchema = new Schema({ id: { type: String, required: true, index: true }, name: String, avatar: String }, { _id: false });

const videoSchema = new Schema({
  title: { type: String, required: [true, 'Tiêu đề là bắt buộc'], trim: true, maxlength: [150, 'Tiêu đề tối đa 150 ký tự'] },
  description: { type: String, default: '', maxlength: [5000, 'Mô tả tối đa 5000 ký tự'] },
  tags: { type: [String], default: [], index: true },
  owner: { type: ownerSchema, required: true },
  ownerIsAdmin: { type: Boolean, default: false },
  visibility: { type: String, enum: ['public', 'unlisted', 'private'], default: 'public' },

  processing: {
    status: { type: String, enum: ['queued', 'processing', 'ready', 'failed'], default: 'queued' },
    progress: { type: Number, default: 0 },
    error: { type: String, default: '' },
  },
  review: {
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: { type: String, default: '' },
    reviewedAt: Date,
    reviewedBy: String,
  },

  rawKey: String,
  originalName: String,
  size: Number,
  thumbnail: { type: String, default: '' },
  customThumbnail: { type: Boolean, default: false },
  duration: { type: Number, default: 0 }, // giây
  width: Number,
  height: Number,
  renditions: [{ _id: false, name: String, height: Number, bitrate: Number }],

  stats: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
  },
  publishedAt: { type: Date, default: null },
}, { timestamps: true });

videoSchema.index({ title: 'text', description: 'text', tags: 'text' });
videoSchema.index({ 'processing.status': 1, 'review.status': 1, visibility: 1, publishedAt: -1 });
videoSchema.index({ 'stats.views': -1 });

videoSchema.methods.isListed = function isListed() {
  return this.processing.status === 'ready' && this.review.status === 'approved' && this.visibility === 'public';
};

/** Ai được xem video này? Chủ kênh và admin luôn xem được; người khác chỉ khi đã duyệt & không riêng tư. */
videoSchema.methods.canView = function canView(viewer) {
  if (viewer && (viewer.isAdmin || viewer.id === this.owner.id)) return true;
  return this.processing.status === 'ready' && this.review.status === 'approved' && this.visibility !== 'private';
};

videoSchema.methods.toClient = function toClient(viewer) {
  const isOwner = !!viewer && (viewer.isAdmin || viewer.id === this.owner.id);
  const ready = this.processing.status === 'ready';
  return {
    id: this._id.toString(),
    title: this.title,
    description: this.description,
    tags: this.tags,
    owner: this.owner,
    visibility: this.visibility,
    thumbnail: storage.publicUrl(this.thumbnail),
    duration: this.duration,
    width: this.width,
    height: this.height,
    renditions: this.renditions,
    stats: this.stats,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
    streamUrl: ready ? `/api/stream/${this._id}/master.m3u8` : null,
    processing: this.processing,
    review: isOwner ? this.review : { status: this.review.status },
    ...(isOwner ? { originalName: this.originalName, size: this.size } : {}),
  };
};

const Video = mongoose.model('Video', videoSchema);

const playlistSchema = new Schema({
  name: { type: String, required: [true, 'Tên playlist là bắt buộc'], trim: true, maxlength: [100, 'Tên tối đa 100 ký tự'] },
  description: { type: String, default: '', maxlength: [1000, 'Mô tả tối đa 1000 ký tự'] },
  owner: { type: ownerSchema, required: true },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  videos: [{ _id: false, video: { type: Schema.Types.ObjectId, ref: 'Video' }, addedAt: { type: Date, default: Date.now } }],
}, { timestamps: true });
playlistSchema.index({ name: 'text', description: 'text' });
playlistSchema.index({ 'videos.video': 1 });

const Playlist = mongoose.model('Playlist', playlistSchema);

// Lịch sử xem: 1 bản ghi / (user, video), lưu vị trí xem dở để tiếp tục
const historySchema = new Schema({
  userId: { type: String, required: true },
  video: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
  position: { type: Number, default: 0 },
  watchedAt: { type: Date, default: Date.now },
});
historySchema.index({ userId: 1, video: 1 }, { unique: true });
historySchema.index({ userId: 1, watchedAt: -1 });
const WatchHistory = mongoose.model('WatchHistory', historySchema);

// Chống tăng view ảo: mỗi người xem (user hoặc IP) chỉ được tính 1 view / video / 6 giờ.
// MongoDB tự xoá bản ghi hết hạn nhờ TTL index.
const viewSchema = new Schema({
  video: { type: Schema.Types.ObjectId, required: true },
  viewerKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 6 * 60 * 60 },
});
viewSchema.index({ video: 1, viewerKey: 1 }, { unique: true });
const ViewEvent = mongoose.model('ViewEvent', viewSchema);

module.exports = { Video, Playlist, WatchHistory, ViewEvent };
