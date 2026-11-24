const { mongoose } = require('@myt/common').db;

// Các gói dịch vụ (cố định trong code cho đơn giản; có thể chuyển vào DB nếu cần quản trị)
const PLANS = [
  {
    id: 'premium_month', name: 'Premium 1 tháng', amount: 49000, currency: 'VND', days: 30,
    features: ['Xem video chất lượng cao nhất (HD)', 'Tải lên file video lớn hơn', 'Huy hiệu Premium'],
  },
  {
    id: 'premium_year', name: 'Premium 12 tháng', amount: 490000, currency: 'VND', days: 365,
    features: ['Mọi quyền lợi gói tháng', 'Tiết kiệm ~17%'], badge: 'Tiết kiệm nhất',
  },
];

const orderSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  userName: String,
  planId: { type: String, required: true },
  planName: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'VND' },
  days: Number,
  provider: { type: String, enum: ['mock', 'vnpay'], required: true },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'cancelled'], default: 'pending', index: true },
  providerTxnId: String,
  providerResponse: mongoose.Schema.Types.Mixed,
  paidAt: Date,
  subscriptionExpiresAt: Date,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 15 * 60 * 1000) }, // đơn hết hạn sau 15 phút
}, { timestamps: true });
orderSchema.index({ createdAt: -1 });

orderSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    planId: this.planId,
    planName: this.planName,
    amount: this.amount,
    currency: this.currency,
    provider: this.provider,
    status: this.status,
    paidAt: this.paidAt,
    subscriptionExpiresAt: this.subscriptionExpiresAt,
    createdAt: this.createdAt,
    userId: this.userId,
    userName: this.userName,
  };
};

// Nguồn dữ liệu gốc về thời hạn Premium của từng user
const subscriptionSchema = new mongoose.Schema({
  _id: String, // userId
  plan: { type: String, default: 'premium' },
  expiresAt: Date,
}, { timestamps: true });

module.exports = {
  PLANS,
  Order: mongoose.model('Order', orderSchema),
  Subscription: mongoose.model('Subscription', subscriptionSchema),
};
