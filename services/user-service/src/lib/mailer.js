// Gửi email theo thứ tự ưu tiên:
//  1. Gmail API + OAuth2 (HTTPS cổng 443) khi có GMAIL_REFRESH_TOKEN: dùng khi deploy
//     (Render gói free chặn cổng SMTP 25/465/587 nên không dùng được Gmail SMTP).
//  2. SMTP khi có SMTP_HOST (local dùng Mailpit: xem thư tại http://localhost:8025).
//  3. Không cấu hình gì: in nội dung ra console để dev vẫn lấy được link.
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

// Gmail API: OAuth client có thể dùng chung với client đăng nhập Google (GOOGLE_CLIENT_ID/SECRET)
const GMAIL = {
  clientId: env.optional('GMAIL_CLIENT_ID', '') || env.optional('GOOGLE_CLIENT_ID', ''),
  clientSecret: env.optional('GMAIL_CLIENT_SECRET', '') || env.optional('GOOGLE_CLIENT_SECRET', ''),
  refreshToken: env.optional('GMAIL_REFRESH_TOKEN', ''),
};
const gmailEnabled = Boolean(GMAIL.refreshToken && GMAIL.clientId && GMAIL.clientSecret);
if (env.optional('GMAIL_REFRESH_TOKEN', '') && !gmailEnabled) {
  console.warn('⚠️ Có GMAIL_REFRESH_TOKEN nhưng thiếu GMAIL_CLIENT_ID/SECRET (hoặc GOOGLE_CLIENT_ID/SECRET): không gửi được qua Gmail');
}

// Dựng email MIME chuẩn (UTF-8, multipart text + html) mà không gửi đi
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

let cachedToken = { value: '', expiresAt: 0 };
async function gmailAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL.clientId,
      client_secret: GMAIL.clientSecret,
      refresh_token: GMAIL.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google OAuth2 ${res.status}: ${data.error || ''} ${data.error_description || ''}`.trim());
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function sendViaGmail(mail) {
  const { message } = await composer.sendMail(mail);
  const send = async (token) => fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(message).toString('base64url') }),
    signal: AbortSignal.timeout(15000),
  });
  let res = await send(await gmailAccessToken());
  if (res.status === 401) { // token bị thu hồi sớm: lấy token mới và thử lại 1 lần
    cachedToken = { value: '', expiresAt: 0 };
    res = await send(await gmailAccessToken());
  }
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendMail({ to, subject, html, text }) {
  const mail = { from: FROM, to, subject, html, text };
  if (gmailEnabled) return sendViaGmail(mail);
  if (!transporter) {
    console.log(`📧 [Chưa cấu hình email] Gửi tới ${to}: ${subject}\n${text || html}`);
    return;
  }
  await transporter.sendMail(mail);
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
