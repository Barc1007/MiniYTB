// Tích hợp cổng VNPay (sandbox) - API v2.1.0.
// Tài liệu: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
const crypto = require('crypto');
const { env } = require('@myt/common');

const config = () => ({
  tmnCode: env.optional('VNPAY_TMN_CODE', ''),
  hashSecret: env.optional('VNPAY_HASH_SECRET', ''),
  url: env.optional('VNPAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  returnUrl: env.optional('VNPAY_RETURN_URL',
    `${(env.optional('GATEWAY_PUBLIC_URL') || env.optional('FRONTEND_URL', 'http://localhost:5173')).replace(/\/+$/, '')}/api/payments/vnpay/return`),
});

const isConfigured = () => !!(config().tmnCode && config().hashSecret);

/** Định dạng yyyyMMddHHmmss theo giờ Việt Nam (GMT+7) như VNPay yêu cầu. */
function vnDate(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// VNPay ký trên chuỗi query đã sắp xếp theo khoá, giá trị mã hoá kiểu form (khoảng trắng = "+")
function encode(v) {
  return encodeURIComponent(String(v)).replace(/%20/g, '+');
}

function signData(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join('&');
}

function hmac(data, secret) {
  return crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');
}

function buildPaymentUrl({ orderId, amount, orderInfo, ipAddr, locale = 'vn', createdAt = new Date(), expireMinutes = 15 }) {
  const c = config();
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: c.tmnCode,
    vnp_Locale: locale,
    vnp_CurrCode: 'VND',
    vnp_TxnRef: orderId,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Amount: Math.round(amount * 100), // VNPay tính theo đơn vị x100
    vnp_ReturnUrl: c.returnUrl,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: vnDate(createdAt),
    vnp_ExpireDate: vnDate(new Date(createdAt.getTime() + expireMinutes * 60000)),
  };
  const data = signData(params);
  return `${c.url}?${data}&vnp_SecureHash=${hmac(data, c.hashSecret)}`;
}

/** Kiểm tra chữ ký dữ liệu VNPay gửi về (return URL / IPN). */
function verify(query, secret = config().hashSecret) {
  const params = { ...query };
  const received = String(params.vnp_SecureHash || '').toLowerCase();
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  const expected = hmac(signData(params), secret);
  const valid = received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  return {
    valid,
    orderId: params.vnp_TxnRef,
    amount: Number(params.vnp_Amount || 0) / 100,
    success: params.vnp_ResponseCode === '00' && (params.vnp_TransactionStatus === undefined || params.vnp_TransactionStatus === '00'),
    transactionNo: params.vnp_TransactionNo,
    responseCode: params.vnp_ResponseCode,
  };
}

module.exports = { isConfigured, buildPaymentUrl, verify, signData, hmac, vnDate };
