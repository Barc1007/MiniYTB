const mongoose = require('mongoose');

/** Kết nối MongoDB, tự thử lại khi DB chưa sẵn sàng (ví dụ container vừa khởi động). */
async function connectMongo(uri, { retries = 30, delayMs = 2000 } = {}) {
  mongoose.set('strictQuery', true);
  for (let attempt = 1; ; attempt++) {
    try {
      // Pool nhỏ: MongoDB Atlas gói free giới hạn 500 kết nối cho cả cluster (6 service dùng chung)
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: parseInt(process.env.MONGO_POOL_SIZE, 10) || 10 });
      console.log(`✅ MongoDB đã kết nối: ${mongoose.connection.name}`);
      return mongoose.connection;
    } catch (err) {
      if (attempt >= retries) throw err;
      console.warn(`⏳ Chưa kết nối được MongoDB (lần ${attempt}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Ghép URI gốc (MONGO_URL) với tên database riêng của từng service (database-per-service). */
function mongoUri(dbName, base = process.env.MONGO_URL) {
  const explicit = process.env.MONGO_URI;
  if (explicit) return explicit;
  // Hỗ trợ cả URI Atlas dạng "mongodb+srv://u:p@cluster.x.mongodb.net/?retryWrites=true&w=majority"
  // và URI đã có sẵn tên DB ("…/olddb?…") — tên DB luôn được thay bằng DB riêng của service.
  const m = String(base || 'mongodb://localhost:27017').trim()
    .match(/^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/);
  if (!m) throw new Error('MONGO_URL không hợp lệ (phải bắt đầu bằng mongodb:// hoặc mongodb+srv://)');
  return `${m[1]}/${dbName}${m[2] && m[2] !== '?' ? m[2] : ''}`;
}

module.exports = { connectMongo, mongoUri, mongoose };
