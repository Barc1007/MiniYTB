// Nạp biến môi trường từ file .env ở thư mục gốc monorepo (khi chạy local bằng Node).
// Trong Docker, biến môi trường được truyền qua docker-compose nên file .env có thể không tồn tại.
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..', '..', '..');
const rootEnv = path.join(rootDir, '.env');
if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv, quiet: true });
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Thiếu biến môi trường bắt buộc: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isNaN(value) ? fallback : value;
}

module.exports = { required, optional, bool, int, rootDir };
