const test = require('node:test');
const assert = require('node:assert');
const { mongoUri } = require('../src/db');

test('mongoUri ghép tên DB riêng cho từng service', () => {
  assert.strictEqual(mongoUri('myt_users', 'mongodb://localhost:27017'), 'mongodb://localhost:27017/myt_users');
  assert.strictEqual(mongoUri('myt_users', 'mongodb://localhost:27017/'), 'mongodb://localhost:27017/myt_users');
});

test('mongoUri với URI MongoDB Atlas (có query, có dấu / thừa, có DB cũ)', () => {
  assert.strictEqual(
    mongoUri('myt_videos', 'mongodb+srv://u:p%40ss@cluster0.abc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'),
    'mongodb+srv://u:p%40ss@cluster0.abc.mongodb.net/myt_videos?retryWrites=true&w=majority&appName=Cluster0',
  );
  assert.strictEqual(
    mongoUri('myt_videos', 'mongodb+srv://u:p@cluster0.abc.mongodb.net/olddb?retryWrites=true'),
    'mongodb+srv://u:p@cluster0.abc.mongodb.net/myt_videos?retryWrites=true',
  );
});

test('mongoUri báo lỗi với URI sai', () => {
  assert.throws(() => mongoUri('x', 'postgres://abc'));
});
