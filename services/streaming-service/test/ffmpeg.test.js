const test = require('node:test');
const assert = require('node:assert');
const { pickRenditions } = require('../src/ffmpeg');

const names = (meta) => pickRenditions(meta).map((r) => r.name);

test('Video 1080p ngang -> đủ 4 bậc chất lượng', () => {
  assert.deepStrictEqual(names({ width: 1920, height: 1080 }), ['360p', '480p', '720p', '1080p']);
});

test('Video 4K bị giới hạn ở 1080p', () => {
  assert.deepStrictEqual(names({ width: 3840, height: 2160 }), ['360p', '480p', '720p', '1080p']);
});

test('Video dọc 720x1280 dùng cạnh ngắn', () => {
  assert.deepStrictEqual(names({ width: 720, height: 1280 }), ['360p', '480p', '720p']);
});

test('MAX_RENDITION_HEIGHT giới hạn bậc cao nhất (worker yếu)', () => {
  assert.deepStrictEqual(pickRenditions({ width: 1920, height: 1080 }, 720).map((r) => r.name), ['360p', '480p', '720p']);
});

test('Video nhỏ hơn 360p giữ nguyên kích thước, không phóng to', () => {
  assert.deepStrictEqual(names({ width: 320, height: 241 }), ['240p']);
});
