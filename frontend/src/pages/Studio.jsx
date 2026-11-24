import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, LayoutDashboard, MessageSquare, Pencil, RotateCcw, ThumbsUp, Trash2, Upload } from 'lucide-react';
import { api, del, errorMessage, get, post, put } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { bytes, compact, dateTime, duration } from '../lib/format';
import { Thumbnail } from '../components/VideoCard';
import { Empty, ErrorBox, Modal, PageLoader, PageTitle, StatusBadge } from '../components/ui';

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className="rounded-lg bg-brand-500/15 p-3"><Icon className="h-5 w-5 text-brand-400" /></div>
      <div><p className="text-xs text-slate-400">{label}</p><p className="text-xl font-bold">{value}</p></div>
    </div>
  );
}

function EditVideo({ video, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: video.title, description: video.description, tags: video.tags.join(', '), visibility: video.visibility,
  });
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { video: v } = await put(`/videos/${video.id}`, form);
      onSaved(v);
      toast.success('Đã lưu thay đổi');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadThumb = async (file) => {
    if (!file) return;
    const data = new FormData();
    data.append('thumbnail', file);
    try {
      const { video: v } = (await api.post(`/videos/${video.id}/thumbnail`, data)).data.data;
      onSaved(v);
      toast.success('Đã cập nhật thumbnail');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center gap-4">
        <Thumbnail video={video} className="w-40" />
        <label className="btn-secondary cursor-pointer">
          Đổi thumbnail
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadThumb(e.target.files[0])} />
        </label>
      </div>
      <div><label className="label" htmlFor="e-title">Tiêu đề</label><input id="e-title" className="input" required maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div><label className="label" htmlFor="e-desc">Mô tả</label><textarea id="e-desc" className="input" rows={5} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="e-tags">Thẻ</label><input id="e-tags" className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
        <div>
          <label className="label" htmlFor="e-vis">Chế độ hiển thị</label>
          <select id="e-vis" className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="public">Công khai</option>
            <option value="unlisted">Không công khai</option>
            <option value="private">Riêng tư</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
        <button type="submit" className="btn-primary" disabled={busy}>Lưu</button>
      </div>
    </form>
  );
}

export default function Studio() {
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  const { data, loading, error, reload, setData } = useFetch(() => get('/videos/mine', { limit: 100 }), []);
  const videos = data?.items || [];
  const editing = videos.find((v) => v.id === editId);
  const busyCount = videos.filter((v) => ['queued', 'processing'].includes(v.processing.status)).length;

  // Tự cập nhật tiến trình chuyển mã mỗi 3 giây khi còn video đang xử lý
  useEffect(() => {
    if (!busyCount) return undefined;
    const t = setInterval(() => reload({ silent: true }), 3000);
    return () => clearInterval(t);
  }, [busyCount, reload]);

  const replace = (v) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === v.id ? v : x)) }));

  const remove = async (v) => {
    if (!window.confirm(`Xoá vĩnh viễn video "${v.title}"?`)) return;
    try {
      await del(`/videos/${v.id}`);
      setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== v.id) }));
      toast.success('Đã xoá video');
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const retry = async (v) => {
    try {
      const { video } = await post(`/videos/${v.id}/retry`);
      replace(video);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const totals = data.totals;

  return (
    <div className="mx-auto max-w-7xl">
      <PageTitle icon={LayoutDashboard} title="Studio">
        <Link to="/upload" className="btn-primary"><Upload className="h-4 w-4" /> Tải video lên</Link>
      </PageTitle>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Upload} label="Video" value={data.pagination.total} />
        <Stat icon={Eye} label="Tổng lượt xem" value={compact(totals.views)} />
        <Stat icon={ThumbsUp} label="Lượt thích" value={compact(totals.likes)} />
        <Stat icon={MessageSquare} label="Bình luận" value={compact(totals.comments)} />
      </div>

      {!videos.length ? (
        <Empty icon={Upload} title="Bạn chưa tải video nào"><Link to="/upload" className="btn-primary mt-3">Tải video đầu tiên</Link></Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-surface-700 text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="p-3">Video</th><th className="p-3">Hiển thị</th><th className="p-3">Xử lý</th><th className="p-3">Duyệt</th>
                <th className="p-3">Ngày tải</th><th className="p-3 text-right">Xem</th><th className="p-3 text-right">Thích</th><th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.id} className="border-b border-surface-700/60 last:border-0 hover:bg-surface-700/30">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <Link to={`/watch/${v.id}`}><Thumbnail video={v} className="w-32 rounded-md" /></Link>
                      <div className="min-w-0 max-w-xs">
                        <Link to={`/watch/${v.id}`} className="line-clamp-2 font-medium hover:text-brand-400">{v.title}</Link>
                        <p className="text-xs text-slate-500">{v.duration ? duration(v.duration) : ''} {v.size ? `• ${bytes(v.size)}` : ''} {v.renditions?.length ? `• ${v.renditions.map((r) => r.name).join('/')}` : ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3"><StatusBadge status={v.visibility} /></td>
                  <td className="p-3">
                    {v.processing.status === 'processing' ? (
                      <div className="w-28">
                        <StatusBadge status="processing">Đang xử lý {v.processing.progress}%</StatusBadge>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-700"><div className="h-full bg-sky-400 transition-all" style={{ width: `${v.processing.progress}%` }} /></div>
                      </div>
                    ) : <StatusBadge status={v.processing.status} />}
                    {v.processing.status === 'failed' && <p className="mt-1 max-w-[12rem] truncate text-xs text-red-300" title={v.processing.error}>{v.processing.error}</p>}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={v.review.status} />
                    {v.review.reason && <p className="mt-1 max-w-[12rem] text-xs text-red-300">{v.review.reason}</p>}
                  </td>
                  <td className="p-3 text-slate-400">{dateTime(v.createdAt)}</td>
                  <td className="p-3 text-right">{compact(v.stats.views)}</td>
                  <td className="p-3 text-right">{compact(v.stats.likes)}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      {v.processing.status === 'failed' && <button type="button" className="btn-ghost p-2" onClick={() => retry(v)} title="Xử lý lại"><RotateCcw className="h-4 w-4" /></button>}
                      <button type="button" className="btn-ghost p-2" onClick={() => setParams({ edit: v.id })} title="Chỉnh sửa"><Pencil className="h-4 w-4" /></button>
                      <button type="button" className="btn-ghost p-2 text-red-300" onClick={() => remove(v)} title="Xoá"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!editing} onClose={() => setParams({})} title="Chỉnh sửa video" size="max-w-2xl">
        {editing && <EditVideo video={editing} onClose={() => setParams({})} onSaved={replace} />}
      </Modal>
    </div>
  );
}
