const { mongoose } = require('@myt/common').db;

// Bản sao "read model" trạng thái video, được dựng từ sự kiện video.state của video-service.
// Nhờ vậy mỗi request segment không phải gọi đồng bộ sang video-service để kiểm tra quyền.
const assetSchema = new mongoose.Schema({
  _id: { type: String }, // videoId
  ownerId: String,
  visibility: { type: String, default: 'public' },
  reviewStatus: { type: String, default: 'pending' },
  processingStatus: { type: String, default: 'queued' },
  renditions: [{ _id: false, name: String, height: Number, bitrate: Number }],
  duration: Number,
  transcodedAt: Date,
  transcodeMs: Number,
  worker: String,
}, { timestamps: true });

module.exports = { StreamAsset: mongoose.model('StreamAsset', assetSchema) };
