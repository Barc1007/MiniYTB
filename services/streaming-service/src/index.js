// STREAMING SERVICE
//  - mode "api":    phát video HLS (kiểm tra quyền + giới hạn chất lượng theo gói), phục vụ file public
//  - mode "worker": chuyển mã video gốc -> HLS bằng ffmpeg (scale ngang bằng cách chạy nhiều worker)
//  - mode "all":    cả hai (mặc định khi chạy local)
// Database riêng: myt_streaming
const { env, http, db, bus, storage } = require('@myt/common');
const { StreamAsset } = require('./models');

const PORT = env.int('STREAMING_SERVICE_PORT', env.int('PORT', 4003));
const MODE = env.optional('STREAMING_MODE', 'all');

async function main() {
  storage.ensureDirs();
  await db.connectMongo(db.mongoUri('myt_streaming'));
  await StreamAsset.init();

  const app = http.createApp(`streaming-service${MODE === 'all' ? '' : `:${MODE}`}`, { healthChecks: { rabbitmq: bus.isConnected, storage: storage.ping } });

  if (MODE === 'api' || MODE === 'all') {
    const api = require('./api');
    await api.registerEvents();
    api.mountMedia(app);
    app.use('/api/stream', api.router);
  }
  if (MODE === 'worker' || MODE === 'all') {
    await require('./worker').start();
  }
  bus.connect();

  http.finalize(app);
  http.listen(app, PORT, bus.close);
}

main().catch((err) => {
  console.error('❌ streaming-service không khởi động được:', err);
  process.exit(1);
});
