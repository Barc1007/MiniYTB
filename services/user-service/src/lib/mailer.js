// Gửi email qua SMTP (local dùng Mailpit: xem thư tại http://localhost:8025).
// Nếu chưa cấu hình SMTP_HOST thì in nội dung ra console để dev vẫn lấy được link.
const nodemailer = require('nodemailer');
const { env } = require('@myt/common');

const host = env.optional('SMTP_HOST', '');
const transporter = host
  ? nodemailer.createTransport({
    host,
    port: env.int('SMTP_PORT', 587),
    secure: [465, 2465].includes(env.int('SMTP_PORT', 587)),
    auth: env.optional('SMTP_USER', '') ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  : null;

const FROM = env.optional('MAIL_FROM', 'MiniYTB <no-reply@local.test>');

// Brevo HTTP API (cổng 443): dùng khi nền tảng chặn cổng SMTP (Render gói free chặn 25/465/587)
const BREVO_API_KEY = env.optional('BREVO_API_KEY', '');

function parseFrom(from) {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { email: from.trim() };
}

async function sendViaBrevo({ to, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(FROM), to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brevo API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendMail({ to, subject, html, text }) {
  if (BREVO_API_KEY) return sendViaBrevo({ to, subject, html, text });
  if (!transporter) {
    console.log(`📧 [Chưa cấu hình SMTP] Gửi tới ${to}: ${subject}\n${text || html}`);
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

function sendResetPasswordEmail(user, resetUrl) {
  return sendMail({
    to: user.email,
    subject: 'Đặt lại mật khẩu MiniYTB',
    text: `Xin chào ${user.name},\n\nMở link sau để đặt lại mật khẩu (hết hạn sau 1 giờ):\n${resetUrl}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    html: `<div style="font-family:sans-serif;max-width:520px">
      <h2>Đặt lại mật khẩu</h2>
      <p>Xin chào <b>${escapeHtml(user.name)}</b>,</p>
      <p>Bấm nút dưới đây để đặt lại mật khẩu. Link hết hạn sau 1 giờ.</p>
      <p><a href="${resetUrl}" style="background:#ef4444;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Đặt lại mật khẩu</a></p>
      <p style="color:#666;font-size:13px">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p></div>`,
  });
}

function sendPremiumEmail(user, expiresAt) {
  return sendMail({
    to: user.email,
    subject: 'Chào mừng bạn đến với MiniYTB Premium 🎉',
    text: `Xin chào ${user.name}, gói Premium của bạn có hiệu lực đến ${new Date(expiresAt).toLocaleString('vi-VN')}.`,
    html: `<p>Xin chào <b>${escapeHtml(user.name)}</b>,</p><p>Gói <b>Premium</b> của bạn có hiệu lực đến <b>${new Date(expiresAt).toLocaleString('vi-VN')}</b>. Bạn đã có thể xem video chất lượng 1080p và tải lên file lớn hơn.</p>`,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendMail, sendResetPasswordEmail, sendPremiumEmail };
