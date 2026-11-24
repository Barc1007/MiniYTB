const crypto = require('crypto');
const express = require('express');
const { http, env, auth } = require('@myt/common');
const User = require('../models/User');
const { sendResetPasswordEmail } = require('../lib/mailer');
const { passport, googleEnabled } = require('../lib/google');

const router = express.Router();
const FRONTEND_URL = env.optional('FRONTEND_URL', 'http://localhost:5173');

function authResponse(user) {
  return { success: true, data: { user: user.toClient({ includePrivate: true }), token: auth.signToken(user) } };
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) throw http.badRequest('Vui lòng nhập tên, email và mật khẩu');
  if (String(password).length < 8) throw http.badRequest('Mật khẩu tối thiểu 8 ký tự');

  const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (existing) throw http.conflict('Email đã được sử dụng');

  const user = await User.create({ name, email, password, role: 'user' });
  res.status(201).json(authResponse(user));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw http.badRequest('Vui lòng nhập email và mật khẩu');

  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
  if (!user || !(await user.comparePassword(password))) throw http.unauthorized('Email hoặc mật khẩu không đúng');
  if (!user.isActive) throw http.forbidden('Tài khoản đã bị khoá');

  res.json(authResponse(user));
});

router.post('/logout', (req, res) => {
  // JWT không trạng thái: client tự xoá token.
  res.json({ success: true, message: 'Đã đăng xuất' });
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) throw http.badRequest('Vui lòng nhập email');

  const genericReply = { success: true, message: 'Nếu email tồn tại, link đặt lại mật khẩu đã được gửi.' };
  const user = await User.findOne({ email });
  if (!user) return res.json(genericReply); // không tiết lộ email có tồn tại hay không

  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  try {
    await sendResetPasswordEmail(user, `${FRONTEND_URL}/reset-password/${token}`);
  } catch (err) {
    console.error('Gửi email thất bại:', err.message);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    throw new http.HttpError(502, 'Không gửi được email, vui lòng thử lại sau');
  }
  res.json(genericReply);
});

router.post('/reset-password/:token', async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) throw http.badRequest('Mật khẩu tối thiểu 8 ký tự');

  const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({ resetPasswordToken: hashed, resetPasswordExpires: { $gt: new Date() } });
  if (!user) throw http.badRequest('Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();
  res.json({ success: true, message: 'Đặt lại mật khẩu thành công, hãy đăng nhập lại.' });
});

// ---------- Google OAuth ----------
router.get('/google/status', (req, res) => res.json({ success: true, available: googleEnabled }));

router.get('/google', (req, res, next) => {
  if (!googleEnabled) throw new http.HttpError(503, 'Chưa cấu hình đăng nhập Google');
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!googleEnabled) throw new http.HttpError(503, 'Chưa cấu hình đăng nhập Google');
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) return res.redirect(`${FRONTEND_URL}/login?error=google_auth_failed`);
    if (!user.isActive) return res.redirect(`${FRONTEND_URL}/login?error=account_locked`);
    // Đặt token sau dấu # để không lọt vào log của server/proxy
    res.redirect(`${FRONTEND_URL}/auth/callback#token=${auth.signToken(user)}`);
  })(req, res, next);
});

module.exports = router;
