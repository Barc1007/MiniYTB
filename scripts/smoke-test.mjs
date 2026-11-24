// Kiểm thử end-to-end toàn hệ thống qua API Gateway.
// Yêu cầu: hạ tầng + các service đang chạy, có ffmpeg trong PATH.
// Chạy:  npm run smoke   (hoặc GATEWAY=http://localhost:8080 node scripts/smoke-test.mjs)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATEWAY = process.env.GATEWAY || 'http://localhost:8080';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@local.test', password: process.env.ADMIN_PASSWORD || 'admin12345' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Thời gian chờ sự kiện lan qua RabbitMQ (local ~1s; cloud nên đặt SMOKE_EVENT_WAIT_MS=4000)
const EVENT_WAIT = Number(process.env.SMOKE_EVENT_WAIT_MS) || 1000;
let step = 0;

function ok(cond, msg) {
  if (!cond) {
    console.error(`  ❌ ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ ${msg}`);
}

async function api(path, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${GATEWAY}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

function title(t) {
  console.log(`\n${++step}. ${t}`);
}

// ---------------------------------------------------------------
title('Health check qua gateway');
const health = await api('/api/health');
console.log('   ', Object.entries(health.json.services || {}).map(([k, v]) => `${k}:${v.status}`).join('  '));
ok(health.status === 200, 'Tất cả service đều up');

title('Đăng ký & đăng nhập');
const email = `smoke-${Date.now()}@test.local`;
const reg = await api('/api/auth/register', { method: 'POST', body: { name: 'Smoke Tester', email, password: 'password123' } });
ok(reg.status === 201, `Đăng ký ${email}`);
let token = reg.json.data.token;
const adminLogin = await api('/api/auth/login', { method: 'POST', body: ADMIN });
ok(adminLogin.status === 200, 'Admin đăng nhập');
const adminToken = adminLogin.json.data.token;

title('Tạo video test 1080p bằng ffmpeg & upload');
const dir = mkdtempSync(join(tmpdir(), 'myt-smoke-'));
const file = join(dir, 'test.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', file]);
const form = new FormData();
form.append('title', 'Video kiểm thử tự động');
form.append('description', 'Tạo bởi smoke-test');
form.append('tags', 'test, demo');
form.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), 'test.mp4');
const up = await api('/api/videos', { method: 'POST', token, form });
ok(up.status === 201, `Upload thành công (id=${up.json.data?.video?.id})`);
const videoId = up.json.data.video.id;
rmSync(dir, { recursive: true, force: true });

title('Chờ streaming-service chuyển mã HLS');
let video;
for (let i = 0; i < 900; i++) { // tối đa 15 phút (worker yếu trên cloud)
  video = (await api(`/api/videos/${videoId}`, { token })).json.data.video;
  if (['ready', 'failed'].includes(video.processing.status)) break;
  process.stdout.write(`   ${video.processing.status} ${video.processing.progress}%\r`);
  await sleep(1000);
}
ok(video.processing.status === 'ready', `Chuyển mã xong: ${video.renditions.map((r) => r.name).join(', ')}, ${video.duration}s`);
ok(!!video.thumbnail, 'Có thumbnail tự động');

title('Kiểm duyệt');
const guestBefore = await api(`/api/videos/${videoId}`);
ok(guestBefore.status === 404, 'Khách chưa thấy video khi chưa duyệt');
const approve = await api(`/api/admin/videos/${videoId}/approve`, { method: 'PUT', token: adminToken });
ok(approve.status === 200, 'Admin duyệt video');
await sleep(EVENT_WAIT); // chờ sự kiện video.state lan tới streaming & comment service
const guestAfter = await api(`/api/videos/${videoId}`);
ok(guestAfter.status === 200, 'Khách xem được video sau khi duyệt');

title('Phát video HLS (giới hạn chất lượng theo gói)');
const masterGuest = await api(`/api/stream/${videoId}/master.m3u8`);
ok(masterGuest.status === 200 && masterGuest.json.includes('#EXTM3U'), 'Master playlist hợp lệ');
// Chất lượng cao nhất thực tế (worker có thể giới hạn bằng MAX_RENDITION_HEIGHT)
const top = [...video.renditions].sort((a, b) => b.height - a.height)[0].name;
const topLocked = !masterGuest.json.includes(`${top}/`);
if (topLocked) ok(true, `Khách KHÔNG có ${top} (dành cho Premium)`);
else console.log(`  ➖ Gói free đã xem được chất lượng cao nhất (${top}) — bỏ qua kiểm tra khoá`);
const variant = await api(`/api/stream/${videoId}/360p/index.m3u8`);
const firstSeg = String(variant.json).split('\n').find((l) => l && !l.startsWith('#'));
const segUrl = /^https?:/.test(firstSeg) ? firstSeg : `${GATEWAY}/api/stream/${videoId}/360p/${firstSeg}`;
const seg = await fetch(segUrl);
ok(seg.status === 200 && (await seg.arrayBuffer()).byteLength > 1000, `Tải được segment 360p${/^https?:/.test(firstSeg) ? ' (thẳng từ object storage, URL có chữ ký)' : ''}`);
if (topLocked) {
  const lockedRes = await api(`/api/stream/${videoId}/${top}/index.m3u8`, { token });
  ok(lockedRes.status === 403, `Tài khoản free bị chặn ${top}`);
}

title('Lượt xem (chống tăng ảo)');
const v1 = await api(`/api/videos/${videoId}/view`, { method: 'POST', token });
const v2 = await api(`/api/videos/${videoId}/view`, { method: 'POST', token });
ok(v1.json.data.counted && !v2.json.data.counted, 'Chỉ tính 1 view / người / 6 giờ');

title('Bình luận & like');
const c1 = await api('/api/comments', { method: 'POST', token, body: { videoId, content: 'Video hay quá!' } });
ok(c1.status === 201, 'Đăng bình luận');
const r1 = await api('/api/comments', { method: 'POST', token: adminToken, body: { videoId, content: 'Cảm ơn bạn', parentId: c1.json.data.comment.id } });
ok(r1.status === 201, 'Trả lời bình luận');
const like = await api(`/api/reactions/${videoId}`, { method: 'PUT', token, body: { reaction: 'like' } });
ok(like.json.data.likeDelta === 1, 'Like video');
await sleep(EVENT_WAIT);
video = (await api(`/api/videos/${videoId}`)).json.data.video;
ok(video.stats.comments === 2 && video.stats.likes === 1 && video.stats.views === 1, `Bộ đếm đồng bộ qua sự kiện: ${JSON.stringify(video.stats)}`);

title('Playlist & lịch sử');
const pl = await api('/api/playlists', { method: 'POST', token, body: { name: 'Playlist test' } });
const add = await api(`/api/playlists/${pl.json.data.playlist.id}/videos`, { method: 'POST', token, body: { videoId } });
ok(add.status === 200, 'Thêm video vào playlist');
await api('/api/history', { method: 'POST', token, body: { videoId, position: 3 } });
const hist = await api('/api/history', { token });
ok(hist.json.data.items[0]?.position === 3, 'Lưu lịch sử & vị trí xem dở');

title('Thanh toán Premium (cổng giả lập)');
const checkout = await api('/api/payments/checkout', { method: 'POST', token, body: { planId: 'premium_month', provider: 'mock' } });
ok(checkout.status === 201, 'Tạo đơn hàng');
const pay = await api(`/api/payments/mock/${checkout.json.data.order.id}/complete`, { method: 'POST', token, body: { result: 'success' } });
ok(pay.json.data?.order?.status === 'paid', 'Thanh toán thành công');
await sleep(EVENT_WAIT);
const me = await api('/api/users/me', { token });
ok(me.json.data.user.plan.type === 'premium', 'user-service đã nâng cấp gói qua sự kiện payment.succeeded');
token = me.json.data.token;
const masterPremium = await api(`/api/stream/${videoId}/master.m3u8`, { token });
ok(masterPremium.json.includes(`${top}/`), `Premium xem được ${top}`);

title('Xoá video & dọn dữ liệu liên quan');
const del = await api(`/api/videos/${videoId}`, { method: 'DELETE', token });
ok(del.status === 200, 'Xoá video');
await sleep(EVENT_WAIT);
const gone = await api(`/api/stream/${videoId}/master.m3u8`, { token: adminToken });
ok(gone.status === 404, 'Streaming không còn phát video đã xoá');
const comments = await api(`/api/comments?videoId=${videoId}`, { token: adminToken });
ok(comments.status === 404, 'Comment-service đã dọn dữ liệu của video');
const delMe = await api('/api/users/me', { method: 'DELETE', token, body: { password: 'password123' } });
ok(delMe.status === 200, 'Xoá tài khoản test');

console.log('\n🎉 Smoke test hoàn tất — toàn bộ luồng hoạt động.');
