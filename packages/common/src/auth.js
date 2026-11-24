// Xác thực JWT không trạng thái (stateless): mọi service dùng chung JWT_SECRET
// nên tự kiểm tra token mà không cần gọi sang user-service ở mỗi request.
const jwt = require('jsonwebtoken');
const { required, optional } = require('./env');
const { unauthorized, forbidden } = require('./http');

const JWT_SECRET = required('JWT_SECRET');
const JWT_EXPIRES_IN = optional('JWT_EXPIRES_IN', '7d');

function isPremium(plan, planExpiresAt) {
  return plan === 'premium' && !!planExpiresAt && new Date(planExpiresAt) > new Date();
}

/** Tạo token từ document User (user-service). Token mang theo tên, avatar, gói dịch vụ. */
function signToken(user) {
  const payload = {
    sub: String(user._id || user.id),
    name: user.name,
    avatar: user.avatar || '',
    role: user.role || 'user',
    plan: user.plan?.type || 'free',
    planExpiresAt: user.plan?.expiresAt || null,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  const p = jwt.verify(token, JWT_SECRET);
  return {
    id: p.sub,
    name: p.name,
    avatar: p.avatar,
    role: p.role,
    plan: isPremium(p.plan, p.planExpiresAt) ? 'premium' : 'free',
    planExpiresAt: p.planExpiresAt,
    isAdmin: p.role === 'admin',
  };
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try { req.user = verifyToken(token); } catch { /* token sai -> coi như khách */ }
  }
  next();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(unauthorized(err.name === 'TokenExpiredError' ? 'Phiên đăng nhập đã hết hạn' : 'Token không hợp lệ'));
  }
}

function requireRole(...roles) {
  return [requireAuth, (req, res, next) => (roles.includes(req.user.role) ? next() : next(forbidden()))];
}

module.exports = { signToken, verifyToken, optionalAuth, requireAuth, requireRole, isPremium };
