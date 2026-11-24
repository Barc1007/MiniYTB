// WORKER chuyển mã: nhận sự kiện video.uploaded, chạy ffmpeg -> HLS, phát video.transcoded.
// Mỗi worker chỉ nhận 1 việc một lúc (prefetch=1); chạy nhiều worker để xử lý song song.
const os = require('os');
const fsp = require('fs/promises');
const path = require('path');
const { bus, storage } = require('@myt/common');
const ffmpeg = require('./ffmpeg');
const { StreamAsset } = require('./models');

const WORKER_ID = `${os.hostname()}-${process.pid}`;

async function handleUpload({ videoId, rawKey, needThumbnail }) {
  const started = Date.now();
  // Thư mục làm việc cục bộ: ffmpeg cần file trên đĩa; kết quả được đẩy lên storage khi xong
  const workDir = path.join(storage.tmpDir(), `hls-${videoId}-${process.pid}`);
  console.log(`🎬 [${WORKER_ID}] Bắt đầu chuyển mã ${videoId}`);

  if (!(await storage.exists(rawKey))) {
    // File gốc không còn (video đã bị xoá trước khi xử lý) -> bỏ qua
    console.warn(`⚠️  Không thấy file gốc của ${videoId}, bỏ qua`);
    return;
  }

  let source;
  let thumbTmp = null;
  try {
    await bus.publish('video.transcode.progress', { videoId, progress: 0 });
    source = await storage.localCopy(rawKey); // local: dùng trực tiếp; s3: tải về file tạm
    const input = source.path;
    const meta = await ffmpeg.probe(input);
    const renditions = ffmpeg.pickRenditions(meta);

    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });
    for (const r of renditions) await fsp.mkdir(path.join(workDir, r.name));

    await ffmpeg.transcodeToHls({
      input, outDir: workDir, meta, renditions,
      onProgress: (progress) => bus.publish('video.transcode.progress', { videoId, progress }).catch(() => {}),
    });

    let thumbnailKey = '';
    if (needThumbnail) {
      thumbTmp = storage.tmpPath('.jpg');
      await ffmpeg.thumbnail({ input, output: thumbTmp, duration: meta.duration, portrait: meta.height > meta.width })
        .then(() => storage.putFile(`${storage.dirs.thumbnails}/${videoId}-auto.jpg`, thumbTmp))
        .then((key) => { thumbnailKey = key; })
        .catch((err) => console.warn('Không tạo được thumbnail:', err.message));
    }

    // Đẩy toàn bộ HLS lên storage một lần (người xem không bao giờ thấy kết quả dở dang)
    await storage.putDir(`${storage.dirs.hls}/${videoId}`, workDir);

    const renditionInfo = renditions.map((r) => ({ name: r.name, height: r.height, bitrate: (r.videoKbps + (meta.hasAudio ? r.audioKbps : 0)) * 1000 }));
    const transcodeMs = Date.now() - started;
    await StreamAsset.updateOne({ _id: videoId }, {
      $set: { renditions: renditionInfo, duration: meta.duration, transcodedAt: new Date(), transcodeMs, worker: WORKER_ID },
    }, { upsert: true });

    await bus.publish('video.transcoded', {
      videoId,
      duration: Math.round(meta.duration * 10) / 10,
      width: meta.width,
      height: meta.height,
      renditions: renditionInfo,
      thumbnail: thumbnailKey,
    });
    console.log(`✅ [${WORKER_ID}] Xong ${videoId}: ${renditions.map((r) => r.name).join(', ')} trong ${(transcodeMs / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`❌ [${WORKER_ID}] Chuyển mã ${videoId} thất bại:`, err.message);
    await bus.publish('video.transcode.failed', { videoId, error: err.message.slice(0, 500) });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    if (thumbTmp) await fsp.rm(thumbTmp, { force: true }).catch(() => {});
    await source?.cleanup().catch(() => {});
  }
}

async function start() {
  const version = await ffmpeg.checkAvailable();
  if (!version) {
    console.error('❌ Không tìm thấy ffmpeg. Cài ffmpeg hoặc đặt FFMPEG_PATH/FFPROBE_PATH trong .env');
  } else {
    console.log(`🎞️  ${version}`);
  }
  await bus.subscribe('streaming-service.transcode', ['video.uploaded'], handleUpload, { prefetch: 1 });
  console.log(`👷 Worker chuyển mã ${WORKER_ID} đang chờ việc`);
}

module.exports = { start, handleUpload };
