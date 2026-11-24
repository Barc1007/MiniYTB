const env = require('./env');
const http = require('./http');
const db = require('./db');
const bus = require('./bus');
const storage = require('./storage');

// auth được nạp lười vì nó bắt buộc có JWT_SECRET (gateway không cần).
module.exports = {
  env, http, db, bus, storage,
  get auth() { return require('./auth'); },
};
