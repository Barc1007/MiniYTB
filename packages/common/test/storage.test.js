const test = require('node:test');
const assert = require('node:assert');
const storage = require('../src/storage');
const { escapeRegex, pagination } = require('../src/http');

test('Chặn path traversal ra ngoài STORAGE_DIR', () => {
  assert.throws(() => storage.abs('../secret.txt'));
  assert.throws(() => storage.abs('thumbnails/../../x'));
  assert.ok(storage.abs('thumbnails/a.jpg').startsWith(storage.STORAGE_DIR));
});

test('publicUrl / keyFromUrl', () => {
  assert.strictEqual(storage.publicUrl('avatars/a.png'), '/media/avatars/a.png');
  assert.strictEqual(storage.keyFromUrl('/media/avatars/a.png'), 'avatars/a.png');
  assert.strictEqual(storage.keyFromUrl('https://lh3.googleusercontent.com/x'), null);
});

test('escapeRegex vô hiệu hoá ký tự đặc biệt', () => {
  assert.ok(new RegExp(escapeRegex('a.*(b')).test('xa.*(b'));
  assert.ok(!new RegExp(escapeRegex('a.c')).test('abc'));
});

test('pagination giới hạn giá trị', () => {
  assert.deepStrictEqual(pagination({ page: '-3', limit: '9999' }), { page: 1, limit: 100, skip: 0 });
  assert.deepStrictEqual(pagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 });
});
