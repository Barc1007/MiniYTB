// Bọc lời gọi ffmpeg/ffprobe: đọc thông tin video, chuyển mã HLS nhiều độ phân giải, chụp thumbnail.
const { spawn } = require('child_process');
const { env } = require('@myt/common');

const FFMPEG = env.optional('FFMPEG_PATH', 'ffmpeg');
const FFPROBE = env.optional('FFPROBE_PATH', 'ffprobe');
const PRESET = env.optional('FFMPEG_PRESET', 'veryfast');
const SEGMENT_SECONDS = env.int('HLS_SEGMENT_SECONDS', 4);
const MAX_HEIGHT = env.int('MAX_RENDITION_HEIGHT', 1080);
const THREADS = env.int('FFMPEG_THREADS', 0); // 0 = ffmpeg tự chọn

// Bậc chất lượng (adaptive bitrate ladder). "height" = cạnh ngắn của khung hình.
const LADDER = [
  { name: '360p', height: 360, videoKbps: 800, audioKbps: 96 },
  { name: '480p', height: 480, videoKbps: 1400, audioKbps: 128 },
  { name: '720p', height: 720, videoKbps: 2800, audioKbps: 128 },
  { name: '1080p', height: 1080, videoKbps: 5000, audioKbps: 192 },
];

function run(cmd, args, { cwd, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      if (onStdout) onStdout(s); else stdout += s;
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-10000);
    });
    child.on('error', (err) => reject(new Error(`Không chạy được ${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} thoát với mã ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

async function probe(input) {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input]);
  const info = JSON.parse(out);
  const video = info.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) throw new Error('File không chứa luồng video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');

  let rotation = Number(video.tags?.rotate || 0);
  const sideRot = video.side_data_list?.find((d) => d.rotation !== undefined);
  if (sideRot) rotation = Number(sideRot.rotation);
  const rotated = Math.abs(rotation) % 180 === 90;
  const width = rotated ? video.height : video.width;
  const height = rotated ? video.width : video.height;
  const duration = Number(info.format.duration || video.duration || 0);
  return { width, height, duration, hasAudio: !!audio };
}

/** Chọn các bậc chất lượng phù hợp với video gốc (không phóng to video nhỏ). */
function pickRenditions({ width, height }, maxHeight = MAX_HEIGHT) {
  const shortSide = Math.min(width, height);
  // MAX_RENDITION_HEIGHT: giới hạn bậc cao nhất khi worker yếu (vd 0.5 CPU/512 MB -> 720)
  const chosen = LADDER.filter((r) => r.height <= shortSide && r.height <= maxHeight);
  if (!chosen.length) {
    const h = Math.max(2, shortSide - (shortSide % 2));
    return [{ name: `${h}p`, height: h, videoKbps: 500, audioKbps: 96 }];
  }
  return chosen;
}

/**
 * Chuyển mã sang HLS trong MỘT lần chạy ffmpeg: giải mã 1 lần, tách (split) thành nhiều
 * độ phân giải, mỗi độ phân giải một thư mục <name>/index.m3u8 + segment .ts, kèm master.m3u8.
 */
async function transcodeToHls({ input, outDir, meta, renditions, onProgress }) {
  const portrait = meta.height > meta.width;
  const n = renditions.length;
  const splits = renditions.map((_, i) => `[v${i}]`).join('');
  const scales = renditions.map((r, i) => {
    const scale = portrait ? `scale=${r.height}:-2` : `scale=-2:${r.height}`;
    return `[v${i}]${scale}[v${i}o]`;
  }).join(';');
  const filter = `[0:v:0]split=${n}${splits};${scales}`;

  const args = ['-hide_banner', '-y', '-i', input, '-filter_complex', filter];
  if (THREADS > 0) args.push('-threads', String(THREADS));
  renditions.forEach((r, i) => {
    args.push('-map', `[v${i}o]`);
    if (meta.hasAudio) args.push('-map', '0:a:0');
  });
  args.push(
    '-c:v', 'libx264', '-preset', PRESET, '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    // keyframe đúng mỗi SEGMENT_SECONDS giây để các bậc chất lượng chuyển đổi mượt
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`, '-sc_threshold', '0',
  );
  renditions.forEach((r, i) => {
    args.push(`-b:v:${i}`, `${r.videoKbps}k`, `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.07)}k`, `-bufsize:v:${i}`, `${r.videoKbps * 2}k`);
    if (meta.hasAudio) args.push(`-b:a:${i}`, `${r.audioKbps}k`);
  });
  if (meta.hasAudio) args.push('-c:a', 'aac', '-ac', '2', '-ar', '48000');
  const streamMap = renditions.map((r, i) => (meta.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`)).join(' ');
  args.push(
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', '%v/seg_%04d.ts', '-master_pl_name', 'master.m3u8',
    '-var_stream_map', streamMap,
    '-progress', 'pipe:1', '-nostats',
    '%v/index.m3u8',
  );

  let lastReported = -1;
  let buffer = '';
  await run(FFMPEG, args, {
    cwd: outDir, // dùng đường dẫn tương đối để tránh lỗi với thư mục có dấu cách/ký tự Unicode
    onStdout: (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && meta.duration > 0) {
          const pct = Math.min(99, Math.floor((Number(m[1]) / 1e6 / meta.duration) * 100));
          if (pct >= lastReported + 5) {
            lastReported = pct;
            onProgress?.(pct);
          }
        }
      }
    },
  });
}

async function thumbnail({ input, output, duration, portrait }) {
  const at = duration > 0 ? Math.min(duration * 0.25, 30) : 0;
  await run(FFMPEG, [
    '-hide_banner', '-y', '-ss', at.toFixed(2), '-i', input, '-frames:v', '1',
    '-vf', portrait ? 'scale=-2:720' : 'scale=1280:-2', '-q:v', '3', output,
  ]);
}

async function checkAvailable() {
  try {
    const out = await run(FFMPEG, ['-hide_banner', '-version']);
    return out.split('\n')[0];
  } catch {
    return null;
  }
}

module.exports = { probe, pickRenditions, transcodeToHls, thumbnail, checkAvailable, LADDER };
