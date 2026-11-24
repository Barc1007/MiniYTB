import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CircleAlert, Clock, ListPlus, ListVideo, Pencil, Share2, ThumbsDown, ThumbsUp } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, get, put } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { compact, dateOnly, number, timeAgo } from '../lib/format';
import VideoPlayer from '../components/VideoPlayer';
import Comments from '../components/Comments';
import SaveToPlaylist from '../components/SaveToPlaylist';
import { VideoRow } from '../components/VideoCard';
import { Avatar, ErrorBox, PageLoader, StatusBadge } from '../components/ui';

function Reactions({ video }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mine, setMine] = useState(null);
  const [counts, setCounts] = useState({ likes: video.stats.likes, dislikes: video.stats.dislikes });

  useEffect(() => {
    setCounts({ likes: video.stats.likes, dislikes: video.stats.dislikes });
    if (user) get(`/reactions/${video.id}`).then((d) => setMine(d.reaction)).catch(() => {});
    else setMine(null);
  }, [video.id, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const react = async (value) => {
    if (!user) return navigate('/login');
    const next = mine === value ? null : value;
    try {
      const d = await put(`/reactions/${video.id}`, { reaction: next });
      setMine(next);
      setCounts((c) => ({ likes: c.likes + d.likeDelta, dislikes: c.dislikes + d.dislikeDelta }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
    return null;
  };

  return (
    <div className="flex overflow-hidden rounded-full bg-surface-700">
      <button type="button" onClick={() => react('like')} className={clsx('flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-600', mine === 'like' && 'text-brand-400')} aria-label="Thích">
        <ThumbsUp className={clsx('h-5 w-5', mine === 'like' && 'fill-current')} /> {compact(counts.likes)}
      </button>
      <div className="w-px bg-surface-600" />
      <button type="button" onClick={() => react('dislike')} className={clsx('flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-600', mine === 'dislike' && 'text-brand-400')} aria-label="Không thích">
        <ThumbsDown className={clsx('h-5 w-5', mine === 'dislike' && 'fill-current')} />
      </button>
    </div>
  );
}

function Description({ video }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-xl bg-surface-800 p-3 text-sm">
      <p className="font-semibold">
        {number(video.stats.views)} lượt xem • {video.publishedAt ? `${dateOnly(video.publishedAt)} (${timeAgo(video.publishedAt)})` : `Tải lên ${timeAgo(video.createdAt)}`}
      </p>
      {video.tags?.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {video.tags.map((t) => <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="text-sky-400 hover:underline">#{t}</Link>)}
        </div>
      )}
      {video.description && (
        <>
          <p className={clsx('mt-2 whitespace-pre-wrap break-words text-slate-200', !open && 'line-clamp-2')}>{video.description}</p>
          {video.description.length > 120 && (
            <button type="button" onClick={() => setOpen(!open)} className="mt-1 font-semibold hover:underline">{open ? 'Ẩn bớt' : '...xem thêm'}</button>
          )}
        </>
      )}
    </div>
  );
}

function PlaylistPanel({ playlist, currentId }) {
  const index = playlist.videos.findIndex((v) => v.id === currentId);
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-surface-700">
      <div className="bg-surface-800 px-4 py-3">
        <Link to={`/playlist/${playlist.id}`} className="font-semibold hover:underline">{playlist.name}</Link>
        <p className="text-xs text-slate-400">{playlist.owner.name} • {index + 1}/{playlist.videos.length}</p>
      </div>
      <div className="max-h-96 overflow-y-auto scrollbar-thin">
        {playlist.videos.map((v, i) => (
          <Link key={v.id} to={`/watch/${v.id}?list=${playlist.id}`}
            className={clsx('flex items-center gap-2 px-2 py-2 hover:bg-surface-700', v.id === currentId && 'bg-surface-700')}>
            <span className="w-5 text-center text-xs text-slate-400">{v.id === currentId ? '▶' : i + 1}</span>
            <img src={v.thumbnail} alt="" className="aspect-video w-24 rounded object-cover" />
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
              <p className="truncate text-xs text-slate-400">{v.owner.name}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Watch() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const listId = params.get('list');
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [startAt, setStartAt] = useState(null);
  const lastSaved = useRef(0);
  const position = useRef(0);

  const { data, loading, error, status, reload } = useFetch(() => get(`/videos/${id}`), [id, user?.id]);
  const video = data?.video;
  const related = useFetch(() => get(`/videos/${id}/related`, { limit: 15 }), [id]);
  const playlist = useFetch(() => (listId ? get(`/playlists/${listId}`) : Promise.resolve(null)), [listId]);

  // Vị trí xem dở (chỉ khi đã đăng nhập)
  useEffect(() => {
    setStartAt(null);
    if (!user) { setStartAt(0); return; }
    get(`/history/${id}`).then((d) => setStartAt(d.position || 0)).catch(() => setStartAt(0));
  }, [id, user]);

  const saveHistory = useCallback((force = false) => {
    if (!user || !position.current) return;
    if (!force && Date.now() - lastSaved.current < 10000) return;
    lastSaved.current = Date.now();
    api.post('/history', { videoId: id, position: Math.floor(position.current) }).catch(() => {});
  }, [id, user]);

  useEffect(() => () => saveHistory(true), [saveHistory]);

  const onEnded = () => {
    position.current = 0;
    saveHistory(true);
    const list = playlist.data?.playlist?.videos;
    if (list) {
      const i = list.findIndex((v) => v.id === id);
      if (i >= 0 && i < list.length - 1) navigate(`/watch/${list[i + 1].id}?list=${listId}`);
    }
  };

  const share = async () => {
    await navigator.clipboard?.writeText(window.location.href.split('&')[0]);
    toast.success('Đã sao chép liên kết');
  };

  if (loading && !video) return <PageLoader />;
  if (error) return <ErrorBox message={status === 404 ? 'Video không tồn tại hoặc chưa được công khai.' : error} onRetry={reload} />;
  if (!video) return null;

  const isOwner = user && (user.id === video.owner.id || user.role === 'admin');
  const ready = video.processing.status === 'ready';

  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1">
        {ready && startAt !== null ? (
          <VideoPlayer
            key={`player-${video.id}`}
            video={video}
            startAt={startAt}
            onProgress={(t) => { position.current = t; saveHistory(); }}
            onEnded={onEnded}
            onWatched={() => api.post(`/videos/${video.id}/view`).catch(() => {})}
          />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-surface-800 text-center">
            {ready ? <PageLoader /> : (
              <>
                <Clock className="h-10 w-10 text-slate-400" />
                <p className="font-medium">Video đang được xử lý ({video.processing.progress}%)</p>
                {video.processing.status === 'failed' && <p className="text-sm text-red-300">{video.processing.error}</p>}
              </>
            )}
          </div>
        )}

        {isOwner && video.review.status !== 'approved' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Chỉ bạn (và quản trị viên) xem được video này. Trạng thái duyệt: <StatusBadge status={video.review.status} />
              {video.review.reason && <p className="mt-1">Lý do: {video.review.reason}</p>}
            </div>
          </div>
        )}

        <h1 className="mt-4 text-xl font-bold leading-snug">{video.title}</h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Link to={`/channel/${video.owner.id}`} className="flex items-center gap-3">
            <Avatar src={video.owner.avatar} name={video.owner.name} size="h-10 w-10" />
            <span className="font-semibold">{video.owner.name}</span>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Reactions video={video} />
            <button type="button" className="btn-secondary" onClick={share}><Share2 className="h-4 w-4" /> Chia sẻ</button>
            {user && <button type="button" className="btn-secondary" onClick={() => setSaveOpen(true)}><ListPlus className="h-4 w-4" /> Lưu</button>}
            {isOwner && <Link to={`/studio?edit=${video.id}`} className="btn-secondary"><Pencil className="h-4 w-4" /> Chỉnh sửa</Link>}
          </div>
        </div>
        <Description video={video} />
        {((ready && video.review.status === 'approved') || isOwner) && (
          <Comments key={`comments-${video.id}`} videoId={video.id} initialCount={video.stats.comments} />
        )}
      </div>

      <aside className="w-full shrink-0 xl:w-[400px]">
        {playlist.data?.playlist && <PlaylistPanel playlist={playlist.data.playlist} currentId={video.id} />}
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><ListVideo className="h-5 w-5" /> Video liên quan</h2>
        <div className="space-y-3">
          {(related.data?.items || []).map((v) => <VideoRow key={v.id} video={v} compact />)}
        </div>
      </aside>

      {user && <SaveToPlaylist videoId={video.id} open={saveOpen} onClose={() => setSaveOpen(false)} />}
    </div>
  );
}
