process.env.VNPAY_TMN_CODE = 'TESTCODE';
process.env.VNPAY_HASH_SECRET = 'SECRETKEY123';

const test = require('node:test');
const assert = require('node:assert');
const vnpay = require('../src/vnpay');

test('vnDate định dạng theo giờ Việt Nam', () => {
  assert.strictEqual(vnpay.vnDate(new Date('2026-01-02T03:04:05Z')), '20260102100405');
});

test('URL thanh toán có chữ ký hợp lệ và verify được', () => {
  const url = vnpay.buildPaymentUrl({ orderId: 'abc123', amount: 49000, orderInfo: 'Thanh toan don abc123', ipAddr: '1.2.3.4' });
  const query = Object.fromEntries(new URL(url).searchParams);
  assert.strictEqual(query.vnp_Amount, '4900000');
  assert.strictEqual(query.vnp_TmnCode, 'TESTCODE');
  // Giả lập VNPay trả về: bỏ vài trường request, thêm trường kết quả rồi ký lại
  const back = { vnp_TxnRef: 'abc123', vnp_Amount: '4900000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_OrderInfo: 'Thanh toan don abc123' };
  back.vnp_SecureHash = vnpay.hmac(vnpay.signData(back), 'SECRETKEY123');
  const r = vnpay.verify(back);
  assert.ok(r.valid);
  assert.ok(r.success);
  assert.strictEqual(r.amount, 49000);
});

test('Sửa số tiền làm chữ ký không còn hợp lệ', () => {
  const back = { vnp_TxnRef: 'abc', vnp_Amount: '4900000', vnp_ResponseCode: '00' };
  back.vnp_SecureHash = vnpay.hmac(vnpay.signData(back), 'SECRETKEY123');
  back.vnp_Amount = '100';
  assert.strictEqual(vnpay.verify(back).valid, false);
});
