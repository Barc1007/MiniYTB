import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Globe, ListVideo, Lock, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { del, errorMessage, get, post, put } from '../lib/api';
import { useFetch, usePaged } from '../lib/useFetch';
import { timeAgo } from '../lib/format';
import { VideoRow } from '../components/VideoCard';
import { Empty, ErrorBox, LoadMore, Modal, PageLoader, PageTitle } from '../components/ui';

function PlaylistCard({ playlist }) {
  return (
    <Link to={`/playlist/${playlist.id}`} className="group block">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-surface-700">
        {playlist.thumbnail
          ? <img src={playlist.thumbnail} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
          : <div className="flex h-full items-center justify-center"><ListVideo className="h-10 w-10 text-slate-500" /></div>}
        <div className="absolute inset-y-0 right-0 flex w-2/5 flex-col items-center justify-center bg-black/70 text-sm font-semibold">
          <ListVideo className="mb-1 h-5 w-5" /> {playlist.videoCount} video
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1 font-semibold group-hover:text-brand-400">
        {playlist.visibility === 'private' && <Lock className="h-3.5 w-3.5 text-slate-400" />} {playlist.name}
      </p>
      <p className="text-sm text-slate-400">{playlist.owner.name} • cập nhật {timeAgo(playlist.updatedAt)}</p>
    </Link>
  );
}

export function PlaylistGrid({ playlists }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {playlists.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
    </div>
  );
}

export default function Playlists() {
  const { items, loading, error, hasMore, loadMore, reload } = usePaged((page) => get('/playlists', { page }), []);
  return (
    <div>
      <PageTitle icon={ListVideo} title="Playlist cộng đồng" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : <PlaylistGrid playlists={items} />}
      {!loading && !items.length && !error && <Empty icon={ListVideo} title="Chưa có playlist công khai nào" />}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}

function PlaylistForm({ initial, onSubmit, submitLabel }) {
  const [form, setForm] = useState({ name: initial?.name || '', description: initial?.description || '', visibility: initial?.visibility || 'public' });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSubmit(form); } finally { setBusy(false); }
      }}
    >
      <div><label className="label" htmlFor="pl-name">Tên</label><input id="pl-name" className="input" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><label className="label" htmlFor="pl-desc">Mô tả</label><textarea id="pl-desc" className="input" rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="pl-vis">Chế độ</label>
        <select id="pl-vis" className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
          <option value="public">Công khai</option>
          <option value="private">Riêng tư</option>
        </select>
      </div>
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy || !form.name.trim()}>{submitLabel}</button></div>
    </form>
  );
}

export function PlaylistDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const { data, loading, error, reload, setData } = useFetch(() => get(`/playlists/${id}`), [id]);
  if (loading) return <PageLoader />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const pl = data.playlist;
  const isOwner = user && (user.id === pl.owner.id || user.role === 'admin');

  const removeVideo = async (videoId) => {
    try {
      await del(`/playlists/${pl.id}/videos/${videoId}`);
      setData((d) => ({ playlist: { ...d.playlist, videos: d.playlist.videos.filter((v) => v.id !== videoId), videoCount: d.playlist.videoCount - 1 } }));
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const removePlaylist = async () => {
    if (!window.confirm(`Xoá playlist "${pl.name}"?`)) return;
    await del(`/playlists/${pl.id}`);
    toast.success('Đã xoá playlist');
    navigate('/library');
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row">
      <div className="shrink-0 lg:w-80">
        <div className="sticky top-20 rounded-2xl bg-gradient-to-b from-brand-700/40 to-surface-800 p-5">
          {pl.thumbnail && <img src={pl.thumbnail} alt="" className="aspect-video w-full rounded-xl object-cover" />}
          <h1 className="mt-4 text-2xl font-bold">{pl.name}</h1>
          <Link to={`/channel/${pl.owner.id}`} className="mt-1 block text-sm font-semibold hover:underline">{pl.owner.name}</Link>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-300">
            {pl.visibility === 'private' ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            {pl.visibility === 'private' ? 'Riêng tư' : 'Công khai'} • {pl.videos.length} video • cập nhật {timeAgo(pl.updatedAt)}
          </p>
          {pl.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{pl.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {pl.videos[0] && <Link to={`/watch/${pl.videos[0].id}?list=${pl.id}`} className="btn-primary"><Play className="h-4 w-4" /> Phát tất cả</Link>}
            {isOwner && <button type="button" className="btn-secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></button>}
            {isOwner && <button type="button" className="btn-secondary" onClick={removePlaylist} aria-label="Xoá playlist"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {pl.videos.length === 0 && <Empty icon={ListVideo} title="Playlist trống">Bấm “Lưu” ở trang xem video để thêm video vào đây.</Empty>}
        {pl.videos.map((v, i) => (
          <div key={v.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-800">
            <span className="w-6 text-center text-sm text-slate-400">{i + 1}</span>
            <div className="min-w-0 flex-1"><VideoRow video={v} to={`/watch/${v.id}?list=${pl.id}`} compact /></div>
            {isOwner && (
              <button type="button" className="btn-ghost p-2" onClick={() => removeVideo(v.id)} aria-label="Xoá khỏi playlist"><X className="h-4 w-4" /></button>
            )}
          </div>
        ))}
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="Sửa playlist">
        <PlaylistForm
          initial={pl}
          submitLabel="Lưu"
          onSubmit={async (form) => {
            try {
              await put(`/playlists/${pl.id}`, form);
              setData((d) => ({ playlist: { ...d.playlist, ...form } }));
              setEditing(false);
            } catch (err) { toast.error(errorMessage(err)); }
          }}
        />
      </Modal>
    </div>
  );
}

export function Library() {
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useFetch(() => get('/playlists/mine'), []);
  const navigate = useNavigate();
  return (
    <div>
      <PageTitle icon={ListVideo} title="Playlist của tôi">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Tạo playlist</button>
      </PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <PageLoader /> : <PlaylistGrid playlists={data?.items || []} />}
      {!loading && !data?.items?.length && <Empty icon={ListVideo} title="Bạn chưa có playlist nào" />}
      <Modal open={creating} onClose={() => setCreating(false)} title="Tạo playlist">
        <PlaylistForm
          submitLabel="Tạo"
          onSubmit={async (form) => {
            try {
              const { playlist } = await post('/playlists', form);
              navigate(`/playlist/${playlist.id}`);
            } catch (err) { toast.error(errorMessage(err)); }
          }}
        />
      </Modal>
    </div>
  );
}
