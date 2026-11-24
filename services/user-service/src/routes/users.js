const fs = require('fs');
const express = require('express');
const { http, auth, bus, storage } = require('@myt/common');
const User = require('../models/User');
const { imageUpload } = require('../lib/imageUpload');

const router = express.Router();
const avatarUpload = imageUpload(5);

async function loadMe(req) {
  const user = await User.findById(req.user.id).select('+password');
  if (!user || !user.isActive) throw http.unauthorized('Tài khoản không tồn tại hoặc đã bị khoá');
  return user;
}

function meResponse(user) {
  // Luôn trả token mới: tên/avatar/gói dịch vụ trong token được làm mới sau mỗi lần thay đổi.
  return { success: true, data: { user: user.toClient({ includePrivate: true }), token: auth.signToken(user) } };
}

function publishProfile(user) {
  return bus.publish('user.updated', { userId: user._id.toString(), name: user.name, avatar: user.avatar });
}

router.get('/me', auth.requireAuth, async (req, res) => {
  res.json(meResponse(await loadMe(req)));
});

router.put('/me', auth.requireAuth, async (req, res) => {
  const user = await loadMe(req);
  const { name, bio } = req.body || {};
  const nameChanged = name !== undefined && name !== user.name;
  if (name !== undefined) user.name = name;
  if (bio !== undefined) user.bio = bio;
  await user.save();
  if (nameChanged) await publishProfile(user);
  res.json(meResponse(user));
});

router.post('/me/avatar', auth.requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) throw http.badRequest('Vui lòng chọn ảnh');
  let user;
  try {
    user = await loadMe(req);
  } catch (err) {
    fs.rmSync(req.file.path, { force: true }); // xoá file tạm
    throw err;
  }
  const oldKey = storage.keyFromUrl(user.avatar);
  const key = await storage.putFile(`${storage.dirs.avatars}/${req.file.filename}`, req.file.path);
  user.avatar = storage.publicUrl(key);
  await user.save();
  if (oldKey) await storage.remove(oldKey).catch(() => {});
  await publishProfile(user);
  res.json(meResponse(user));
});

router.put('/me/password', auth.requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) throw http.badRequest('Mật khẩu mới tối thiểu 8 ký tự');
  const user = await loadMe(req);
  // Tài khoản Google chưa có mật khẩu được phép đặt mật khẩu lần đầu
  if (user.password) {
    if (!currentPassword || !(await user.comparePassword(currentPassword))) throw http.badRequest('Mật khẩu hiện tại không đúng');
    if (await user.comparePassword(newPassword)) throw http.badRequest('Mật khẩu mới phải khác mật khẩu cũ');
  }
  user.password = newPassword;
  await user.save();
  res.json({ success: true, message: 'Đổi mật khẩu thành công' });
});

router.delete('/me', auth.requireAuth, async (req, res) => {
  const user = await loadMe(req);
  if (user.password && !(await user.comparePassword(req.body?.password || ''))) throw http.badRequest('Mật khẩu không đúng');
  await deleteUser(user);
  res.json({ success: true, message: 'Tài khoản đã được xoá' });
});

// Hồ sơ công khai (trang kênh)
router.get('/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.isActive) throw http.notFound('Không tìm thấy người dùng');
  res.json({ success: true, data: { user: user.toClient() } });
});

/** Xoá user và phát sự kiện để các service khác dọn dữ liệu liên quan (video, bình luận, playlist...). */
async function deleteUser(user) {
  const avatarKey = storage.keyFromUrl(user.avatar);
  await User.deleteOne({ _id: user._id });
  if (avatarKey) await storage.remove(avatarKey).catch(() => {});
  await bus.publish('user.deleted', { userId: user._id.toString() });
}

module.exports = router;
module.exports.deleteUser = deleteUser;
