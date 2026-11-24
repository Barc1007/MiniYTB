const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { storage, http } = require('@myt/common');

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** Multer ghi ảnh vào thư mục tạm với tên ngẫu nhiên; route sẽ chuyển file vào storage. */
function imageUpload(maxMb = 5) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, storage.tmpDir()),
      filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ok = file.mimetype.startsWith('image/') && ALLOWED.includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : http.badRequest('Chỉ chấp nhận ảnh JPG, PNG, WEBP, GIF'), ok);
    },
  });
}

module.exports = { imageUpload };
