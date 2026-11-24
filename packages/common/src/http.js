const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Bạn cần đăng nhập') => new HttpError(401, msg);
const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này') => new HttpError(403, msg);
const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

/**
 * Tạo Express app chuẩn cho mọi service: JSON body, log request, header bảo mật,
 * endpoint /health. Gọi finalize(app) sau khi gắn route để thêm 404 + error handler.
 */
function createApp(serviceName, { jsonLimit = '1mb', healthChecks = {}, mongo = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Số proxy đứng trước service (frontend proxy -> gateway -> service = 2). Không dùng `true`
  // vì client có thể tự giả X-Forwarded-For để lách cơ chế chống tăng lượt xem ảo.
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS, 10) || 2);
  app.set('serviceName', serviceName);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Service', serviceName);
    next();
  });

  // Khi deploy mà service có URL public (vd Render gói free), chỉ nhận request đi qua gateway:
  // gateway gắn header X-Internal-Token bí mật. Đặt INTERNAL_TOKEN giống nhau ở gateway & service.
  const internalToken = process.env.INTERNAL_TOKEN;
  app.use((req, res, next) => {
    const fromGateway = !!internalToken && safeEqual(req.headers['x-internal-token'], internalToken);
    if (internalToken && !fromGateway && req.path !== '/health') {
      return res.status(403).json({ success: false, message: 'Chỉ chấp nhận request qua API Gateway' });
    }
    // IP thật của người dùng: lấy từ gateway (đáng tin) nếu có, ngược lại theo trust proxy
    req.clientIp = (fromGateway && req.headers['x-client-ip']) || req.ip;
    return next();
  });

  if (process.env.NODE_ENV !== 'test') {
    // Dùng hàm format (không nhúng tên vào chuỗi) vì morgan hiểu ":xxx" là token
    // -> tên như "streaming-service:api" từng làm service crash.
    const format = (t, req, res) => `[${serviceName}] ${t.method(req, res)} ${t.url(req, res)} ${t.status(req, res)} ${t['response-time'](req, res)} ms`;
    app.use(morgan(format, {
      skip: (req) => req.path === '/health' || req.path.endsWith('.ts') || req.path.endsWith('.m4s'),
    }));
  }
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', async (req, res) => {
    const checks = {};
    if (mongo) checks.mongo = mongoose.connection.readyState === 1 ? 'up' : 'down';
    for (const [name, fn] of Object.entries(healthChecks)) {
      try { checks[name] = (await fn()) ? 'up' : 'down'; } catch { checks[name] = 'down'; }
    }
    const ok = Object.values(checks).every((v) => v === 'up');
    res.status(ok ? 200 : 503).json({
      service: serviceName, status: ok ? 'ok' : 'degraded', checks, uptime: Math.round(process.uptime()),
    });
  });

  return app;
}

function finalize(app) {
  app.use((req, res) => {
    res.status(404).json({ success: false, message: `Không tìm thấy route ${req.method} ${req.originalUrl}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Lỗi máy chủ';
    let details = err.details;

    if (err.name === 'ValidationError' && err.errors) {
      status = 400;
      details = Object.values(err.errors).map((e) => e.message);
      message = details.join(', ');
    } else if (err.name === 'CastError') {
      status = 400;
      message = 'ID không hợp lệ';
    } else if (err.code === 11000) {
      status = 409;
      message = 'Dữ liệu đã tồn tại';
    } else if (err.name === 'MulterError') {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File vượt quá dung lượng cho phép' : err.message;
    } else if (err.type === 'entity.too.large') {
      status = 413;
    }

    if (status >= 500) console.error(`[${app.get('serviceName')}]`, err);
    res.status(status).json({
      success: false,
      message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Lỗi máy chủ' : message,
      ...(details ? { details } : {}),
    });
  });
  return app;
}

function listen(app, port, onShutdown) {
  const name = app.get('serviceName');
  const server = app.listen(port, () => console.log(`🚀 ${name} đang chạy tại cổng ${port}`));
  // Giữ kết nối keep-alive lâu hơn client/load balancer (mặc định 5s dễ gây lỗi ECONNRESET
  // khi client tái sử dụng socket vừa bị server đóng)
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 66 * 1000;
  server.requestTimeout = 0; // upload video lớn có thể kéo dài
  const shutdown = async () => {
    console.log(`👋 ${name} đang tắt...`);
    setTimeout(() => process.exit(0), 5000).unref();
    try { await onShutdown?.(); } catch { /* bỏ qua */ }
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

/** Phân trang: đọc ?page & ?limit an toàn. */
function pagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function paged(items, total, { page, limit }) {
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

function safeEqual(a, b) {
  const crypto = require('crypto');
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Escape chuỗi trước khi đưa vào RegExp (tránh ReDoS / lỗi cú pháp từ input người dùng). */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  createApp, finalize, listen, pagination, paged, escapeRegex,
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
};
