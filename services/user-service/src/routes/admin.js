const express = require('express');
const { http, auth } = require('@myt/common');
const User = require('../models/User');
const { deleteUser } = require('./users');

const router = express.Router();
router.use(auth.requireRole('admin'));

router.get('/', async (req, res) => {
  const { search, role, isActive, plan } = req.query;
  const p = http.pagination(req.query);
  const query = {};
  if (search) {
    const rx = new RegExp(http.escapeRegex(search), 'i');
    query.$or = [{ name: rx }, { email: rx }];
  }
  if (role) query.role = role;
  if (isActive !== undefined && isActive !== '') query.isActive = isActive === 'true';
  if (plan === 'premium') query['plan.expiresAt'] = { $gt: new Date() };

  const [users, total, stats] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
    User.countDocuments(query),
    Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ 'plan.type': 'premium', 'plan.expiresAt': { $gt: new Date() } }),
    ]),
  ]);
  res.json({
    success: true,
    data: {
      ...http.paged(users.map((u) => u.toClient({ includePrivate: true })), total, p),
      stats: { total: stats[0], active: stats[1], inactive: stats[0] - stats[1], admins: stats[2], premium: stats[3] },
    },
  });
});

async function findOther(req) {
  if (req.params.id === req.user.id) throw http.forbidden('Không thể tự thay đổi tài khoản của chính mình tại đây');
  const user = await User.findById(req.params.id);
  if (!user) throw http.notFound('Không tìm thấy người dùng');
  return user;
}

router.put('/:id/role', async (req, res) => {
  const { role } = req.body || {};
  if (!['user', 'admin'].includes(role)) throw http.badRequest('Vai trò không hợp lệ');
  const user = await findOther(req);
  user.role = role;
  await user.save();
  res.json({ success: true, data: { user: user.toClient({ includePrivate: true }) } });
});

router.put('/:id/status', async (req, res) => {
  const user = await findOther(req);
  user.isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : !user.isActive;
  await user.save();
  res.json({ success: true, data: { user: user.toClient({ includePrivate: true }) } });
});

router.delete('/:id', async (req, res) => {
  const user = await findOther(req);
  await deleteUser(user);
  res.json({ success: true, message: 'Đã xoá người dùng' });
});

module.exports = router;
