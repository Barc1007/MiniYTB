// Đăng nhập Google (tuỳ chọn). Chỉ bật khi có GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET.
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { env } = require('@myt/common');
const User = require('../models/User');

const enabled = !!(env.optional('GOOGLE_CLIENT_ID') && env.optional('GOOGLE_CLIENT_SECRET'));

if (enabled) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // Mặc định: <GATEWAY_PUBLIC_URL hoặc FRONTEND_URL>/api/auth/google/callback
    callbackURL: env.optional('GOOGLE_CALLBACK_URL',
      `${(env.optional('GATEWAY_PUBLIC_URL') || env.optional('FRONTEND_URL', 'http://localhost:5173')).replace(/\/+$/, '')}/api/auth/google/callback`),
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const photo = profile.photos?.[0]?.value || '';
      let user = await User.findOne({ googleId: profile.id });
      if (!user && email) {
        user = await User.findOne({ email });
        if (user) user.googleId = profile.id; // liên kết với tài khoản email sẵn có
      }
      if (!user) {
        user = new User({
          googleId: profile.id,
          name: (profile.displayName || 'Người dùng').slice(0, 50),
          email: email || `${profile.id}@google.oauth`,
          avatar: photo,
          authProvider: 'google',
        });
      }
      if (!user.avatar && photo) user.avatar = photo;
      await user.save();
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
  console.log('✅ Google OAuth đã bật');
}

module.exports = { passport, googleEnabled: enabled };
