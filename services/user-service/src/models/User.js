const { mongoose } = require('@myt/common').db;
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Tên là bắt buộc'], trim: true, maxlength: [50, 'Tên tối đa 50 ký tự'] },
  email: {
    type: String,
    required: [true, 'Email là bắt buộc'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Email không hợp lệ'],
  },
  password: { type: String, minlength: [8, 'Mật khẩu tối thiểu 8 ký tự'], select: false },
  bio: { type: String, maxlength: [300, 'Giới thiệu tối đa 300 ký tự'], default: '' },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  // Gói dịch vụ - được cập nhật qua sự kiện payment.succeeded từ payment-service
  plan: {
    type: { type: String, enum: ['free', 'premium'], default: 'free' },
    expiresAt: { type: Date, default: null },
  },
  googleId: { type: String, sparse: true, unique: true },
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  resetPasswordToken: { type: String, default: null, select: false },
  resetPasswordExpires: { type: Date, default: null, select: false },
}, { timestamps: true });

userSchema.index({ name: 'text', email: 'text' });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password') || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toClient = function toClient({ includePrivate = false } = {}) {
  const premium = this.plan?.type === 'premium' && this.plan.expiresAt && this.plan.expiresAt > new Date();
  const base = {
    id: this._id.toString(),
    name: this.name,
    avatar: this.avatar,
    bio: this.bio,
    joinedAt: this.createdAt,
  };
  if (!includePrivate) return base;
  return {
    ...base,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    authProvider: this.authProvider,
    hasPassword: this.password === undefined ? undefined : !!this.password,
    plan: { type: premium ? 'premium' : 'free', expiresAt: this.plan?.expiresAt || null },
  };
};

module.exports = mongoose.model('User', userSchema);
