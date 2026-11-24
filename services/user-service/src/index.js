// USER SERVICE: tài khoản, xác thực (JWT, Google OAuth), hồ sơ, quản trị người dùng, gói dịch vụ.
// Database riêng: myt_users
const { env, http, db, bus, storage } = require('@myt/common');
const User = require('./models/User');
const { passport } = require('./lib/google');
const { sendPremiumEmail } = require('./lib/mailer');

const PORT = env.int('USER_SERVICE_PORT', env.int('PORT', 4001));

async function seedAdmin() {
  const email = env.optional('ADMIN_EMAIL');
  const password = env.optional('ADMIN_PASSWORD');
  if (!email || !password) return;
  if (await User.exists({ email: email.toLowerCase() })) return;
  await User.create({ name: env.optional('ADMIN_NAME', 'Admin'), email, password, role: 'admin' });
  console.log(`👑 Đã tạo tài khoản admin: ${email}`);
}

async function main() {
  storage.ensureDirs();
  await db.connectMongo(db.mongoUri('myt_users'));
  await User.init(); // tạo index
  await seedAdmin();

  // Thanh toán thành công -> nâng cấp gói (payment-service là nguồn dữ liệu gốc của ngày hết hạn)
  await bus.subscribe('user-service.payments', ['payment.succeeded'], async ({ userId, plan, expiresAt }) => {
    const user = await User.findByIdAndUpdate(userId, { plan: { type: plan, expiresAt } }, { returnDocument: 'after' });
    if (user) {
      console.log(`💎 ${user.email} đã nâng cấp ${plan} đến ${expiresAt}`);
      sendPremiumEmail(user, expiresAt).catch((e) => console.warn('Gửi email premium lỗi:', e.message));
    }
  });
  bus.connect();

  const app = http.createApp('user-service', { healthChecks: { rabbitmq: bus.isConnected } });
  app.use(passport.initialize());
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/admin/users', require('./routes/admin'));
  http.finalize(app);
  http.listen(app, PORT, bus.close);
}

main().catch((err) => {
  console.error('❌ user-service không khởi động được:', err);
  process.exit(1);
});
