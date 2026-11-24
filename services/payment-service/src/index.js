// PAYMENT SERVICE: gói Premium, đơn hàng, cổng thanh toán (giả lập / VNPay sandbox).
// Database riêng: myt_payments
const { env, http, db, bus } = require('@myt/common');
const { Order, Subscription } = require('./models');
const { router, admin } = require('./routes');

const PORT = env.int('PAYMENT_SERVICE_PORT', env.int('PORT', 4005));

async function main() {
  await db.connectMongo(db.mongoUri('myt_payments'));
  await Promise.all([Order.init(), Subscription.init()]);

  // User bị xoá -> huỷ các đơn đang chờ (giữ lại đơn đã thanh toán để đối soát)
  await bus.subscribe('payment-service.users', ['user.deleted'], async ({ userId }) => {
    await Order.updateMany({ userId, status: 'pending' }, { $set: { status: 'cancelled' } });
    await Subscription.deleteOne({ _id: userId });
  });
  bus.connect();

  // Đơn quá hạn 15 phút mà chưa thanh toán -> failed
  setInterval(() => {
    Order.updateMany({ status: 'pending', expiresAt: { $lt: new Date() } }, { $set: { status: 'failed', providerResponse: { reason: 'expired' } } })
      .catch((e) => console.warn('Dọn đơn hết hạn lỗi:', e.message));
  }, 60 * 1000).unref();

  const app = http.createApp('payment-service', { healthChecks: { rabbitmq: bus.isConnected } });
  app.use('/api/payments', router);
  app.use('/api/admin/payments', admin);
  http.finalize(app);
  http.listen(app, PORT, bus.close);
}

main().catch((err) => {
  console.error('❌ payment-service không khởi động được:', err);
  process.exit(1);
});
