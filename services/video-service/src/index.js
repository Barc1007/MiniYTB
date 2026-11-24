// VIDEO SERVICE: upload & metadata video, kiểm duyệt, playlist, lịch sử xem, lượt xem.
// Database riêng: myt_videos
const { env, http, db, bus, storage } = require('@myt/common');
const models = require('./models');
const events = require('./events');

const PORT = env.int('VIDEO_SERVICE_PORT', env.int('PORT', 4002));

async function main() {
  storage.ensureDirs();
  await db.connectMongo(db.mongoUri('myt_videos'));
  await Promise.all(Object.values(models).map((m) => m.init()));
  await events.register();
  bus.connect();

  const app = http.createApp('video-service', { healthChecks: { rabbitmq: bus.isConnected } });
  app.use('/api/videos', require('./routes/videos'));
  app.use('/api/playlists', require('./routes/playlists'));
  app.use('/api/history', require('./routes/history'));
  app.use('/api/admin/videos', require('./routes/admin'));
  http.finalize(app);
  http.listen(app, PORT, bus.close);
}

main().catch((err) => {
  console.error('❌ video-service không khởi động được:', err);
  process.exit(1);
});
