const express = require('express');
const { http, auth, bus, env, db } = require('@myt/common');
const { PLANS, Order, Subscription } = require('./models');
const vnpay = require('./vnpay');

const FRONTEND_URL = env.optional('FRONTEND_URL', 'http://localhost:5173');
const MOCK_ENABLED = env.bool('PAYMENT_MOCK_ENABLED', true);
const { mongoose } = db;

/**
 * Kích hoạt đơn hàng đã thanh toán. Idempotent: chỉ đơn ở trạng thái "pending" mới được chuyển
 * sang "paid" (cổng thanh toán có thể gọi IPN nhiều lần, return URL và IPN có thể đến cùng lúc).
 */
async function markPaid(orderId, { providerTxnId, providerResponse } = {}) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'paid', paidAt: new Date(), providerTxnId, providerResponse } },
    { returnDocument: 'after' },
  );
  if (!order) return null;

  const sub = await Subscription.findById(order.userId);
  const base = sub?.expiresAt && sub.expiresAt > new Date() ? sub.expiresAt : new Date();
  const expiresAt = new Date(base.getTime() + order.days * 24 * 3600 * 1000);
  await Subscription.updateOne({ _id: order.userId }, { $set: { plan: 'premium', expiresAt } }, { upsert: true });
  order.subscriptionExpiresAt = expiresAt;
  await order.save();

  await bus.publish('payment.succeeded', {
    orderId: order._id.toString(), userId: order.userId, plan: 'premium', expiresAt: expiresAt.toISOString(), amount: order.amount,
  });
  console.log(`💰 Đơn ${order._id} đã thanh toán, premium đến ${expiresAt.toISOString()}`);
  return order;
}

async function markFailed(orderId, status, providerResponse) {
  return Order.findOneAndUpdate({ _id: orderId, status: 'pending' }, { $set: { status, providerResponse } }, { returnDocument: 'after' });
}

async function loadOwnOrder(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw http.notFound('Không tìm thấy đơn hàng');
  const order = await Order.findById(req.params.id);
  if (!order || (order.userId !== req.user.id && !req.user.isAdmin)) throw http.notFound('Không tìm thấy đơn hàng');
  return order;
}

const router = express.Router();

router.get('/plans', (req, res) => {
  res.json({
    success: true,
    data: { plans: PLANS, providers: { mock: MOCK_ENABLED, vnpay: vnpay.isConfigured() } },
  });
});

router.get('/subscription', auth.requireAuth, async (req, res) => {
  const sub = await Subscription.findById(req.user.id);
  const active = !!sub?.expiresAt && sub.expiresAt > new Date();
  res.json({ success: true, data: { plan: active ? 'premium' : 'free', expiresAt: sub?.expiresAt || null } });
});

router.get('/mine', auth.requireAuth, async (req, res) => {
  const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, data: { items: orders.map((o) => o.toClient()) } });
});

router.post('/checkout', auth.requireAuth, async (req, res) => {
  const { planId, provider = 'mock' } = req.body || {};
  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) throw http.badRequest('Gói không hợp lệ');
  if (provider === 'mock' && !MOCK_ENABLED) throw http.badRequest('Cổng giả lập đã tắt');
  if (provider === 'vnpay' && !vnpay.isConfigured()) throw http.badRequest('Chưa cấu hình VNPay (VNPAY_TMN_CODE, VNPAY_HASH_SECRET)');
  if (!['mock', 'vnpay'].includes(provider)) throw http.badRequest('Cổng thanh toán không hợp lệ');

  const order = await Order.create({
    userId: req.user.id, userName: req.user.name,
    planId: plan.id, planName: plan.name, amount: plan.amount, currency: plan.currency, days: plan.days, provider,
  });

  const paymentUrl = provider === 'vnpay'
    ? vnpay.buildPaymentUrl({
      orderId: order._id.toString(), amount: order.amount,
      orderInfo: `Thanh toan ${plan.id} don ${order._id}`, ipAddr: req.clientIp?.replace('::ffff:', ''),
    })
    : `${FRONTEND_URL}/payment/mock/${order._id}`;

  res.status(201).json({ success: true, data: { order: order.toClient(), paymentUrl } });
});

router.get('/orders/:id', auth.requireAuth, async (req, res) => {
  res.json({ success: true, data: { order: (await loadOwnOrder(req)).toClient() } });
});

router.post('/orders/:id/cancel', auth.requireAuth, async (req, res) => {
  const order = await loadOwnOrder(req);
  const updated = await markFailed(order._id, 'cancelled', { reason: 'user_cancelled' });
  res.json({ success: true, data: { order: (updated || order).toClient() } });
});

// ---------- Cổng thanh toán giả lập (dùng khi chạy local / demo) ----------
router.post('/mock/:id/complete', auth.requireAuth, async (req, res) => {
  if (!MOCK_ENABLED) throw http.notFound();
  const order = await loadOwnOrder(req);
  if (order.provider !== 'mock') throw http.badRequest('Đơn hàng không dùng cổng giả lập');
  if (order.status !== 'pending') throw http.conflict(`Đơn hàng đã ở trạng thái ${order.status}`);
  if (order.expiresAt < new Date()) {
    await markFailed(order._id, 'failed', { reason: 'expired' });
    throw http.badRequest('Đơn hàng đã hết hạn');
  }
  const success = req.body?.result !== 'fail';
  const result = success
    ? await markPaid(order._id, { providerTxnId: `MOCK-${Date.now()}`, providerResponse: { mock: true } })
    : await markFailed(order._id, 'failed', { mock: true, reason: 'user_declined' });
  res.json({ success: true, data: { order: (result || (await Order.findById(order._id))).toClient() } });
});

// ---------- VNPay ----------
// Người dùng được VNPay chuyển về đây sau khi thanh toán
router.get('/vnpay/return', async (req, res) => {
  const r = vnpay.verify(req.query);
  if (r.valid && mongoose.isValidObjectId(r.orderId)) {
    const order = await Order.findById(r.orderId);
    // Khi chạy local, VNPay không gọi IPN tới localhost được -> xác nhận luôn ở return URL (đã kiểm tra chữ ký & số tiền)
    if (order && order.status === 'pending' && order.amount === r.amount) {
      if (r.success) await markPaid(order._id, { providerTxnId: r.transactionNo, providerResponse: req.query });
      else await markFailed(order._id, 'failed', req.query);
    }
  }
  res.redirect(`${FRONTEND_URL}/payment/result?orderId=${encodeURIComponent(r.orderId || '')}&valid=${r.valid ? 1 : 0}`);
});

// VNPay gọi server-to-server (IPN) để xác nhận kết quả - nguồn tin cậy khi đã deploy
router.get('/vnpay/ipn', async (req, res) => {
  const r = vnpay.verify(req.query);
  if (!r.valid) return res.json({ RspCode: '97', Message: 'Invalid signature' });
  if (!mongoose.isValidObjectId(r.orderId)) return res.json({ RspCode: '01', Message: 'Order not found' });
  const order = await Order.findById(r.orderId);
  if (!order) return res.json({ RspCode: '01', Message: 'Order not found' });
  if (order.amount !== r.amount) return res.json({ RspCode: '04', Message: 'Invalid amount' });
  if (order.status !== 'pending') return res.json({ RspCode: '02', Message: 'Order already confirmed' });
  if (r.success) await markPaid(order._id, { providerTxnId: r.transactionNo, providerResponse: req.query });
  else await markFailed(order._id, 'failed', req.query);
  res.json({ RspCode: '00', Message: 'Confirm Success' });
});

// ---------- Quản trị ----------
const admin = express.Router();
admin.use(auth.requireRole('admin'));
admin.get('/', async (req, res) => {
  const p = http.pagination(req.query, { defaultLimit: 30 });
  const query = req.query.status ? { status: req.query.status } : {};
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [orders, total, revenue, byStatus, daily, activeSubs] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    Order.countDocuments(query),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Order.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: '+07:00' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Subscription.countDocuments({ expiresAt: { $gt: new Date() } }),
  ]);
  res.json({
    success: true,
    data: {
      ...http.paged(orders.map((o) => o.toClient()), total, p),
      stats: {
        revenue: revenue[0]?.total || 0,
        paidOrders: revenue[0]?.count || 0,
        activeSubscriptions: activeSubs,
        byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
        daily: daily.map((d) => ({ date: d._id, amount: d.amount, count: d.count })),
      },
    },
  });
});

module.exports = { router, admin, markPaid };
