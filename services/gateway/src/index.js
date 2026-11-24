// API Gateway: điểm vào duy nhất của hệ thống.
// - Định tuyến /api/* tới đúng microservice (reverse proxy)
// - CORS, giới hạn tần suất (rate limit), gắn X-Request-Id
// - /api/health tổng hợp tình trạng mọi service
// Gateway KHÔNG đọc body (để upload video stream thẳng sang video-service).
const crypto = require('crypto');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { env, http } = require('@myt/common');

const PORT = env.int('GATEWAY_PORT', env.int('PORT', 8080));
const INTERNAL_TOKEN = env.optional('INTERNAL_TOKEN', '');

// Chấp nhận cả "host:port" (Render private network) lẫn URL đầy đủ
const url = (v) => (/^https?:\/\//.test(v) ? v : `http://${v}`).replace(/\/+$/, '');
const services = {
  user: url(env.optional('USER_SERVICE_URL', 'http://localhost:4001')),
  video: url(env.optional('VIDEO_SERVICE_URL', 'http://localhost:4002')),
  streaming: url(env.optional('STREAMING_SERVICE_URL', 'http://localhost:4003')),
  comment: url(env.optional('COMMENT_SERVICE_URL', 'http://localhost:4004')),
  payment: url(env.optional('PAYMENT_SERVICE_URL', 'http://localhost:4005')),
};

// Bảng định tuyến: tiền tố đường dẫn -> service
const routes = [
  { prefixes: ['/api/auth', '/api/users', '/api/admin/users'], target: 'user' },
  { prefixes: ['/api/videos', '/api/playlists', '/api/history', '/api/admin/videos'], target: 'video' },
  { prefixes: ['/api/stream', '/media'], target: 'streaming' },
  { prefixes: ['/api/comments', '/api/reactions'], target: 'comment' },
  { prefixes: ['/api/payments', '/api/admin/payments'], target: 'payment' },
];

const app = require('express')();
app.disable('x-powered-by');
app.set('trust proxy', env.int('TRUST_PROXY_HOPS', 1));
app.set('serviceName', 'gateway');

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  req.headers['x-request-id'] = req.id;
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

const origins = env.optional('CORS_ORIGINS', 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origins.includes('*') || origins.includes(origin)),
  credentials: true,
}));

if (process.env.NODE_ENV !== 'test') {
  app.use(require('morgan')('[gateway] :method :url :status :response-time ms', {
    skip: (req) => /\.(ts|m4s|jpg|png|webp)$/.test(req.path) || req.path === '/api/health',
  }));
}

// Rate limit: chung cho API + chặt hơn cho đăng nhập/đăng ký/quên mật khẩu.
// Không áp dụng cho segment video (một video có hàng trăm request segment).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.int('RATE_LIMIT_PER_MIN', 600),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/stream') || req.path.startsWith('/media'),
  message: { success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.int('AUTH_RATE_LIMIT', 50),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Quá nhiều lần thử, vui lòng đợi 15 phút' },
});
app.use(apiLimiter);
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password'], authLimiter);

// Health của riêng gateway (Render dùng để biết gateway còn sống — không phụ thuộc service khác)
app.get('/health', (req, res) => res.json({ service: 'gateway', status: 'ok', uptime: Math.round(process.uptime()) }));

// Health tổng hợp mọi service (service gói free có thể đang "ngủ" -> báo down cho tới khi thức dậy)
app.get('/api/health', async (req, res) => {
  const results = await Promise.all(Object.entries(services).map(async ([name, base]) => {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(env.int('HEALTH_TIMEOUT_MS', 5000)) });
      const detail = await r.json().catch(() => ({}));
      return [name, { ...detail, status: r.ok ? 'up' : 'degraded' }];
    } catch {
      return [name, { status: 'down' }];
    }
  }));
  const body = Object.fromEntries(results);
  const ok = results.every(([, v]) => v.status === 'up');
  res.status(ok ? 200 : 503).json({ gateway: 'up', services: body });
});

// Đánh thức streaming-service (nơi chuyển mã) khi có upload hoặc Studio đang theo dõi tiến trình.
// Service gói free ngủ khi không có request HTTP và khi ngủ thì không nhận việc từ RabbitMQ.
// Tối đa 1 lần / WAKE_STREAMING_INTERVAL_MS (mặc định 5 phút, Render ngủ sau 15 phút). 0 = tắt.
const WAKE_INTERVAL = env.int('WAKE_STREAMING_INTERVAL_MS', 5 * 60 * 1000);
let lastWake = 0;
app.use(['/api/videos'], (req, res, next) => {
  const triggers = (req.method === 'POST' && (req.path === '/' || /\/retry$/.test(req.path))) || req.path === '/mine';
  if (WAKE_INTERVAL > 0 && triggers && Date.now() - lastWake > WAKE_INTERVAL) {
    lastWake = Date.now();
    fetch(`${services.streaming}/health`, { signal: AbortSignal.timeout(90 * 1000) }).catch(() => {});
  }
  next();
});

// Header nội bộ gắn vào request GỐC trước khi proxy (không dùng sự kiện proxyReq: với request có
// "Expect: 100-continue" — curl/app mobile upload file lớn — header đã gửi đi trước khi sự kiện chạy).
app.use((req, res, next) => {
  delete req.headers['x-internal-token']; // không tin giá trị client tự gửi
  if (INTERNAL_TOKEN) req.headers['x-internal-token'] = INTERNAL_TOKEN;
  req.headers['x-client-ip'] = req.ip || '';
  next();
});

for (const route of routes) {
  app.use(createProxyMiddleware({
    target: services[route.target],
    pathFilter: route.prefixes,
    // Đặt Host = địa chỉ service đích (bắt buộc với Render/Heroku vì chúng định tuyến theo Host).
    // Các redirect (OAuth, thanh toán) dùng FRONTEND_URL / *_CALLBACK_URL nên không phụ thuộc Host.
    changeOrigin: true,
    xfwd: true,
    proxyTimeout: 60 * 60 * 1000, // upload video lớn
    on: {
      error: (err, req, res) => {
        console.error(`[gateway] ${route.target}-service lỗi: ${err.code || err.message}`);
        if (res.headersSent || typeof res.status !== 'function') return res.end?.();
        res.status(502).json({ success: false, message: `Dịch vụ ${route.target} tạm thời không khả dụng` });
      },
    },
  }));
}

http.finalize(app);
http.listen(app, PORT);
console.log('🧭 Bảng định tuyến:', Object.fromEntries(routes.map((r) => [r.prefixes.join(', '), services[r.target]])));
