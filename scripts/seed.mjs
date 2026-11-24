// Tạo dữ liệu demo: vài người dùng + video mẫu (sinh bằng ffmpeg), bình luận, like, playlist.
// Chạy khi hệ thống đang chạy:  npm run seed
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATEWAY = process.env.GATEWAY || 'http://localhost:8080';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@local.test', password: process.env.ADMIN_PASSWORD || 'admin12345' };

async function api(path, { method = 'GET', token, body, form } = {}, attempt = 1) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${GATEWAY}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  } catch (err) {
    // socket keep-alive bị đóng giữa chừng -> thử lại 1 lần
    if (attempt < 3 && ['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(err.cause?.code)) return api(path, { method, token, body, form }, attempt + 1);
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message || ''}`);
  return json.data;
}

async function account(name, email, password = 'password123') {
  try {
    return (await api('/api/auth/register', { method: 'POST', body: { name, email, password } })).token;
  } catch {
    return (await api('/api/auth/login', { method: 'POST', body: { email, password } })).token;
  }
}

// Các nguồn hình ảnh tổng hợp có sẵn trong ffmpeg (lavfi)
const VIDEOS = [
  { title: 'Phố cổ về đêm — timelapse ánh đèn', tags: 'du lịch, timelapse', src: 'mandelbrot=size=1920x1080:rate=30', dur: 12, tone: 330 },
  { title: 'Hướng dẫn microservices với RabbitMQ (demo)', tags: 'lập trình, microservices, cloud', src: 'testsrc2=size=1920x1080:rate=30', dur: 10, tone: 440 },
  { title: 'Nhạc nền lo-fi thư giãn để học bài', tags: 'âm nhạc, lofi', src: 'cellauto=size=1280x720:rate=30:rule=110', dur: 15, tone: 262 },
  { title: 'Sóng màu — thử nghiệm đồ hoạ chuyển động', tags: 'đồ hoạ, thử nghiệm', src: 'gradients=size=1920x1080:rate=30:speed=0.05', dur: 8, tone: 523 },
  { title: 'Video dọc: một ngày ở quê', tags: 'vlog, shorts', src: 'life=size=720x1280:rate=30:mold=10:ratio=0.5', dur: 9, tone: 392 },
  { title: 'Điện toán đám mây là gì? Giải thích trong 10 giây', tags: 'cloud, giáo dục', src: 'smptehdbars=size=1280x720:rate=30', dur: 10, tone: 660 },
];

function makeVideo(dir, v, i) {
  const file = join(dir, `seed-${i}.mp4`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `${v.src}`, '-f', 'lavfi', '-i', `sine=frequency=${v.tone}:duration=${v.dur}`,
    '-t', String(v.dur), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  return file;
}

const adminToken = (await api('/api/auth/login', { method: 'POST', body: ADMIN })).token;
const users = [
  { name: 'Lan Nguyễn', token: await account('Lan Nguyễn', 'lan@demo.local') },
  { name: 'Minh Dev', token: await account('Minh Dev', 'minh@demo.local') },
];
console.log('👤 Tài khoản demo: lan@demo.local, minh@demo.local (mật khẩu: password123)');

const dir = mkdtempSync(join(tmpdir(), 'myt-seed-'));
const ids = [];
for (const [i, v] of VIDEOS.entries()) {
  process.stdout.write(`🎬 Tạo & tải lên: ${v.title} ... `);
  const owner = users[i % users.length];
  const form = new FormData();
  form.append('title', v.title);
  form.append('description', `Video mẫu được tạo tự động bằng ffmpeg để demo hệ thống.\n\nNguồn: ${v.src.split('=')[0]}`);
  form.append('tags', v.tags);
  form.append('video', new Blob([readFileSync(makeVideo(dir, v, i))], { type: 'video/mp4' }), `seed-${i}.mp4`);
  const { video } = await api('/api/videos', { method: 'POST', token: owner.token, form });
  ids.push({ id: video.id, owner });
  console.log('ok');
}
rmSync(dir, { recursive: true, force: true });

console.log('⏳ Chờ chuyển mã...');
for (const { id } of ids) {
  for (let t = 0; t < 180; t++) {
    const { items } = await api(`/api/admin/videos?search=`, { token: adminToken });
    const v = items.find((x) => x.id === id);
    if (v && ['ready', 'failed'].includes(v.processing.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await api(`/api/admin/videos/${id}/approve`, { method: 'PUT', token: adminToken });
}
await new Promise((r) => setTimeout(r, 1000));

const comments = ['Video hay quá 👍', 'Cảm ơn bạn đã chia sẻ!', 'Chất lượng hình ảnh rất nét', 'Mong có thêm phần 2'];
for (const [i, { id }] of ids.entries()) {
  for (const [j, u] of users.entries()) {
    await api(`/api/videos/${id}/view`, { method: 'POST', token: u.token });
    if ((i + j) % 2 === 0) await api(`/api/reactions/${id}`, { method: 'PUT', token: u.token, body: { reaction: 'like' } });
    await api('/api/comments', { method: 'POST', token: u.token, body: { videoId: id, content: comments[(i + j) % comments.length] } });
  }
}
const { playlist } = await api('/api/playlists', { method: 'POST', token: users[0].token, body: { name: 'Du lịch Việt Nam', description: 'Tuyển tập video du lịch' } });
for (const { id } of ids.filter((_, i) => i % 2 === 0)) {
  await api(`/api/playlists/${playlist.id}/videos`, { method: 'POST', token: users[0].token, body: { videoId: id } });
}
console.log(`✅ Xong: ${ids.length} video, bình luận, like, 1 playlist. Mở http://localhost:5173`);
