const { mongoose } = require('@myt/common').db;

const { Schema } = mongoose;

const commentSchema = new Schema({
  videoId: { type: String, required: true },
  user: {
    id: { type: String, required: true },
    name: String,
    avatar: String,
  },
  content: { type: String, required: [true, 'Nội dung không được để trống'], trim: true, maxlength: [2000, 'Bình luận tối đa 2000 ký tự'] },
  parentId: { type: Schema.Types.ObjectId, default: null }, // null = bình luận gốc; khác null = trả lời
  replyCount: { type: Number, default: 0 },
  edited: { type: Boolean, default: false },
}, { timestamps: true });
commentSchema.index({ videoId: 1, parentId: 1, createdAt: -1 });
commentSchema.index({ 'user.id': 1 });

commentSchema.methods.toClient = function toClient(viewer, videoOwnerId) {
  return {
    id: this._id.toString(),
    videoId: this.videoId,
    user: this.user,
    content: this.content,
    parentId: this.parentId ? this.parentId.toString() : null,
    replyCount: this.replyCount,
    edited: this.edited,
    isVideoOwner: this.user.id === videoOwnerId,
    canEdit: !!viewer && viewer.id === this.user.id,
    canDelete: !!viewer && (viewer.isAdmin || viewer.id === this.user.id || viewer.id === videoOwnerId),
    createdAt: this.createdAt,
  };
};

// Like / dislike video: mỗi user tối đa 1 reaction / video
const reactionSchema = new Schema({
  videoId: { type: String, required: true },
  userId: { type: String, required: true },
  value: { type: String, enum: ['like', 'dislike'], required: true },
}, { timestamps: true });
reactionSchema.index({ videoId: 1, userId: 1 }, { unique: true });
reactionSchema.index({ userId: 1, value: 1, updatedAt: -1 });

// Read model: trạng thái video (từ sự kiện video.state) để biết video có tồn tại / được bình luận không
const videoRefSchema = new Schema({
  _id: String,
  ownerId: String,
  visibility: String,
  reviewStatus: String,
  processingStatus: String,
});
videoRefSchema.methods.isOpenFor = function isOpenFor(viewer) {
  if (viewer && (viewer.isAdmin || viewer.id === this.ownerId)) return true;
  return this.processingStatus === 'ready' && this.reviewStatus === 'approved' && this.visibility !== 'private';
};

module.exports = {
  Comment: mongoose.model('Comment', commentSchema),
  Reaction: mongoose.model('Reaction', reactionSchema),
  VideoRef: mongoose.model('VideoRef', videoRefSchema),
};
