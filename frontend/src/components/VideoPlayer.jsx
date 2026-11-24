import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Hls from 'hls.js';
import { Lock, Settings2 } from 'lucide-react';
import clsx from 'clsx';
import { API_URL, get, tokenStore } from '../lib/api';

// URL tuyệt đối của API (VITE_API_URL có thể là "/api" hoặc "https://gateway.../api")
const API_ORIGIN_BASE = new URL(API_URL, window.location.origin).href.replace(/\/+$/, '');

/**
 * Trình phát HLS (adaptive bitrate).
 * - Gửi kèm JWT ở mọi request playlist/segment để streaming-service lọc chất lượng theo gói.
 * - Cho chọn chất lượng thủ công; bậc dành cho Premium hiển thị khoá.
 */
export default function VideoPlayer({ video, startAt = 0, autoPlay = true, onProgress, onEnded, onWatched }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const watchedRef = useRef({ seconds: 0, last: null, reported: false });
  const [levels, setLevels] = useState([]);
  const [current, setCurrent] = useState(-1); // -1 = tự động
  const [playingHeight, setPlayingHeight] = useState(null);
  const [locked, setLocked] = useState([]);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState(null);

  const src = video.streamUrl?.startsWith('/api') ? `${API_URL}${video.streamUrl.slice(4)}` : video.streamUrl;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return undefined;
    setError(null);
    setLevels([]);
    setCurrent(-1);
    watchedRef.current = { seconds: 0, last: null, reported: false };

    get(`/stream/${video.id}/info`)
      .then((info) => setLocked(info.renditions.filter((r) => !r.allowed)))
      .catch(() => setLocked([]));

    if (Hls.isSupported()) {
      const hls = new Hls({
        startPosition: startAt > 5 ? startAt : -1,
        xhrSetup: (xhr, url) => {
          // Chỉ gắn JWT cho request tới API của hệ thống. Segment có thể là URL có chữ ký
          // của object storage (R2/S3) — thêm header Authorization sẽ bị storage từ chối.
          const token = tokenStore.get();
          if (token && url.startsWith(API_ORIGIN_BASE)) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        },
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLevels(data.levels.map((l, i) => ({ index: i, height: Math.min(l.height, l.width) || l.height, bitrate: l.bitrate })));
        if (autoPlay) el.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const l = hls.levels[data.level];
        if (l) setPlayingHeight(Math.min(l.height, l.width) || l.height);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code !== 404 && data.response?.code !== 403) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setError('Không phát được video này.');
          hls.destroy();
        }
      });
      hls.loadSource(src);
      hls.attachMedia(el);
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari iOS: HLS gốc của trình duyệt (không gửi được header -> chất lượng như khách)
      el.src = src;
      if (startAt > 5) el.currentTime = startAt;
      if (autoPlay) el.play().catch(() => {});
      return () => { el.removeAttribute('src'); el.load(); };
    }
    setError('Trình duyệt không hỗ trợ phát HLS.');
    return undefined;
  }, [src, video.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseLevel = (index) => {
    if (hlsRef.current) hlsRef.current.currentLevel = index;
    setCurrent(index);
    setMenu(false);
  };

  // Đếm thời gian xem thật (bỏ qua tua) để gửi 1 lượt xem sau 5 giây
  const handleTimeUpdate = () => {
    const el = videoRef.current;
    const w = watchedRef.current;
    if (w.last !== null && el.currentTime > w.last && el.currentTime - w.last < 1.5) w.seconds += el.currentTime - w.last;
    w.last = el.currentTime;
    if (!w.reported && w.seconds >= Math.min(5, (video.duration || 5) * 0.5)) {
      w.reported = true;
      onWatched?.();
    }
    onProgress?.(el.currentTime, el.duration);
  };

  const sortedLevels = [...levels].sort((a, b) => b.height - a.height);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      {error ? (
        <div className="flex h-full items-center justify-center text-slate-300">{error}</div>
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full"
          controls
          playsInline
          poster={video.thumbnail || undefined}
          onTimeUpdate={handleTimeUpdate}
          onEnded={onEnded}
        />
      )}

      {levels.length > 0 && (
        <div className="absolute right-3 top-3">
          <button
            type="button"
            onClick={() => setMenu(!menu)}
            className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium hover:bg-black/90"
            aria-label="Chọn chất lượng"
          >
            <Settings2 className="h-4 w-4" />
            {current === -1 ? `Tự động${playingHeight ? ` (${playingHeight}p)` : ''}` : `${levels[current]?.height}p`}
          </button>
          {menu && (
            <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-lg bg-black/90 py-1 text-sm shadow-xl">
              {sortedLevels.map((l) => (
                <button key={l.index} type="button" onClick={() => chooseLevel(l.index)}
                  className={clsx('flex w-full items-center justify-between px-4 py-2 hover:bg-white/10', current === l.index && 'text-brand-400')}>
                  {l.height}p {l.height >= 720 && <span className="text-[10px] font-bold text-slate-400">HD</span>}
                </button>
              ))}
              {locked.map((r) => (
                <Link key={r.name} to="/premium" className="flex w-full items-center justify-between px-4 py-2 text-slate-400 hover:bg-white/10">
                  {r.name} <span className="flex items-center gap-1 text-xs text-amber-300"><Lock className="h-3 w-3" /> Premium</span>
                </Link>
              ))}
              <button type="button" onClick={() => chooseLevel(-1)}
                className={clsx('flex w-full px-4 py-2 hover:bg-white/10', current === -1 && 'text-brand-400')}>
                Tự động
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
