import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Clapperboard, CreditCard, Eye, Lock, LockOpen, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { API_URL, del, errorMessage, get, put } from '../lib/api';
import { useFetch, usePaged } from '../lib/useFetch';
import { bytes, compact, dateOnly, dateTime, duration, money, number } from '../lib/format';
import VideoPlayer from '../components/VideoPlayer';
import { Thumbnail } from '../components/VideoCard';
import { Avatar, ErrorBox, LoadMore, Modal, PageLoader, PageTitle, PremiumBadge, StatusBadge } from '../components/ui';

function Tile({ label, value, hint, to }) {
  const body = (
    <div className="card h-full p-4 transition hover:border-surface-600">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

// Tổng quan: gọi song song 3 service (video, user, payment) — mỗi phần lỗi độc lập
export function AdminDashboard() {
  const videos = useFetch(() => get('/admin/videos/stats'), []);
  const users = useFetch(() => get('/admin/users', { limit: 1 }), []);
  const payments = useFetch(() => get('/admin/payments', { limit: 1 }), []);
  const health = useFetch(async () => (await fetch(`${API_URL}/health`)).json(), []);

  const v = videos.data;
  const u = users.data?.stats;
  const p = payments.data?.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageTitle icon={ShieldCheck} title="Tổng quan quản trị" />

      <section>
        <h2 className="mb-3 font-semibold">Tình trạng microservices</h2>
        <div className="flex flex-wrap gap-2">
          {health.data?.services ? Object.entries(health.data.services).map(([name, s]) => (
            <span key={name} className={clsx('badge px-3 py-1.5 text-sm', s.status === 'up' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>
              {s.status === 'up' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {name}-service
              {s.uptime !== undefined && <span className="text-xs text-slate-400">· {Math.round(s.uptime / 60)} phút</span>}
            </span>
          )) : <span className="text-sm text-slate-500">Đang kiểm tra...</span>}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Video" value={v ? number(v.totals.videos) : '—'} hint={v ? `${number(v.review.pending || 0)} chờ duyệt • ${bytes(v.totals.storage)}` : videos.error} to="/admin/videos" />
        <Tile label="Lượt xem" value={v ? compact(v.totals.views) : '—'} hint={v ? `${compact(v.totals.likes)} thích • ${compact(v.totals.comments)} bình luận` : ''} />
        <Tile label="Người dùng" value={u ? number(u.total) : '—'} hint={u ? `${number(u.premium)} premium • ${number(u.inactive)} bị khoá` : users.error} to="/admin/users" />
        <Tile label="Doanh thu" value={p ? money(p.revenue) : '—'} hint={p ? `${number(p.paidOrders)} đơn • ${number(p.activeSubscriptions)} gói đang chạy` : payments.error} to="/admin/payments" />
      </section>

      {v?.top?.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Video xem nhiều nhất</h2>
          <div className="card divide-y divide-surface-700">
            {v.top.map((video, i) => (
              <Link key={video.id} to={`/watch/${video.id}`} className="flex items-center gap-4 p-3 hover:bg-surface-700/40">
                <span className="w-5 text-center text-slate-500">{i + 1}</span>
                <Thumbnail video={video} className="w-28 rounded-md" />
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{video.title}</p><p className="text-xs text-slate-400">{video.owner.name}</p></div>
                <span className="text-sm text-slate-300">{compact(video.stats.views)} lượt xem</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const REVIEW_TABS = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối'], ['', 'Tất cả']];

export function AdminVideos() {
  const [review, setReview] = useState('pending');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const { items, setItems, loading, error, hasMore, loadMore, reload } = usePaged(
    (page) => get('/admin/videos', { page, review: review || undefined, search: query || undefined }), [review, query],
  );

  const update = (v) => setItems((list) => (review && v.review.status !== review ? list.filter((x) => x.id !== v.id) : list.map((x) => (x.id === v.id ? v : x))));

  const approve = async (video) => {
    try {
      update((await put(`/admin/videos/${video.id}/approve`)).video);
      toast.success('Đã duyệt video');
      setPreview(null);
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const reject = async () => {
    try {
      update((await put(`/admin/videos/${rejecting.id}/reject`, { reason })).video);
      toast.success('Đã từ chối video');
      setRejecting(null);
      setPreview(null);
      setReason('');
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async (video) => {
    if (!window.confirm(`Xoá vĩnh viễn "${video.title}"?`)) return;
    try {
      await del(`/admin/videos/${video.id}`);
      setItems((list) => list.filter((x) => x.id !== video.id));
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageTitle icon={Clapperboard} title="Kiểm duyệt video">
        <form onSubmit={(e) => { e.preventDefault(); setQuery(search); }}>
          <input className="input w-64" placeholder="Tìm theo tiêu đề / kênh" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
      </PageTitle>
      <div className="mb-4 flex gap-2">
        {REVIEW_TABS.map(([key, label]) => (
          <button key={key} type="button" className={review === key ? 'chip-active' : 'chip'} onClick={() => setReview(key)}>{label}</button>
        ))}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((v) => (
            <div key={v.id} className="card overflow-hidden">
              <button type="button" className="block w-full" onClick={() => setPreview(v)}><Thumbnail video={v} className="rounded-none" /></button>
              <div className="space-y-2 p-4">
                <p className="line-clamp-2 font-semibold">{v.title}</p>
                <p className="text-xs text-slate-400">{v.owner.name} • {dateTime(v.createdAt)} • {duration(v.duration)}</p>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={v.processing.status}>{v.processing.status === 'processing' ? `Đang xử lý ${v.processing.progress}%` : undefined}</StatusBadge>
                  <StatusBadge status={v.review.status} />
                  <StatusBadge status={v.visibility} />
                </div>
                {v.review.reason && <p className="text-xs text-red-300">Lý do: {v.review.reason}</p>}
                <div className="flex gap-2 pt-1">
                  {v.review.status !== 'approved' && <button type="button" className="btn-primary flex-1" disabled={v.processing.status !== 'ready'} onClick={() => approve(v)}><Check className="h-4 w-4" /> Duyệt</button>}
                  {v.review.status !== 'rejected' && <button type="button" className="btn-secondary flex-1" onClick={() => setRejecting(v)}><X className="h-4 w-4" /> Từ chối</button>}
                  <button type="button" className="btn-ghost p-2 text-red-300" onClick={() => remove(v)} aria-label="Xoá"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && !items.length && <p className="py-16 text-center text-slate-500">Không có video nào.</p>}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title || ''} size="max-w-4xl">
        {preview && (
          <div className="space-y-3">
            {preview.streamUrl ? <VideoPlayer video={preview} autoPlay={false} /> : <p className="text-slate-400">Video chưa xử lý xong.</p>}
            <p className="whitespace-pre-wrap text-sm text-slate-300">{preview.description || <i className="text-slate-500">Không có mô tả</i>}</p>
            <div className="flex justify-end gap-2">
              <Link to={`/watch/${preview.id}`} className="btn-ghost"><Eye className="h-4 w-4" /> Trang xem</Link>
              {preview.review.status !== 'rejected' && <button type="button" className="btn-secondary" onClick={() => setRejecting(preview)}>Từ chối</button>}
              {preview.review.status !== 'approved' && <button type="button" className="btn-primary" disabled={preview.processing.status !== 'ready'} onClick={() => approve(preview)}>Duyệt</button>}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Từ chối video" size="max-w-md">
        <textarea className="input" rows={3} placeholder="Lý do (người đăng sẽ thấy)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRejecting(null)}>Huỷ</button>
          <button type="button" className="btn-danger" onClick={reject}>Từ chối</button>
        </div>
      </Modal>
    </div>
  );
}

export function AdminUsers() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', role: '', isActive: '' });
  const { items, setItems, loading, error, hasMore, loadMore, reload } = usePaged(
    (page) => get('/admin/users', { page, ...Object.fromEntries(Object.entries(filters).filter(([, x]) => x !== '')) }), [filters],
  );
  const replace = (u) => setItems((list) => list.map((x) => (x.id === u.id ? u : x)));
  const act = async (fn) => { try { await fn(); } catch (err) { toast.error(errorMessage(err)); } };

  return (
    <div className="mx-auto max-w-7xl">
      <PageTitle icon={Users} title="Quản lý người dùng" />
      <div className="mb-4 flex flex-wrap gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setFilters({ ...filters, search }); }}>
          <input className="input w-64" placeholder="Tìm tên hoặc email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <select className="input w-auto" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
          <option value="">Mọi vai trò</option><option value="user">User</option><option value="admin">Admin</option>
        </select>
        <select className="input w-auto" value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
          <option value="">Mọi trạng thái</option><option value="true">Hoạt động</option><option value="false">Bị khoá</option>
        </select>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-surface-700 text-left text-xs uppercase text-slate-400">
            <tr><th className="p-3">Người dùng</th><th className="p-3">Vai trò</th><th className="p-3">Gói</th><th className="p-3">Trạng thái</th><th className="p-3">Tham gia</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b border-surface-700/60 last:border-0">
                <td className="p-3">
                  <Link to={`/channel/${u.id}`} className="flex items-center gap-3">
                    <Avatar src={u.avatar} name={u.name} size="h-8 w-8" />
                    <div><p className="font-medium">{u.name}</p><p className="text-xs text-slate-400">{u.email} {u.authProvider === 'google' && '· Google'}</p></div>
                  </Link>
                </td>
                <td className="p-3">
                  <select className="rounded bg-surface-700 px-2 py-1" value={u.role} disabled={u.id === me.id}
                    onChange={(e) => act(async () => replace((await put(`/admin/users/${u.id}/role`, { role: e.target.value })).user))}>
                    <option value="user">User</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="p-3">{u.plan.type === 'premium' ? <span className="flex items-center gap-1"><PremiumBadge /><span className="text-xs text-slate-400">{dateOnly(u.plan.expiresAt)}</span></span> : <span className="text-slate-400">Free</span>}</td>
                <td className="p-3">{u.isActive ? <span className="badge bg-emerald-500/15 text-emerald-300">Hoạt động</span> : <span className="badge bg-red-500/15 text-red-300">Bị khoá</span>}</td>
                <td className="p-3 text-slate-400">{dateOnly(u.joinedAt)}</td>
                <td className="p-3">
                  {u.id !== me.id && (
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn-ghost p-2" title={u.isActive ? 'Khoá' : 'Mở khoá'}
                        onClick={() => act(async () => replace((await put(`/admin/users/${u.id}/status`, { isActive: !u.isActive })).user))}>
                        {u.isActive ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </button>
                      <button type="button" className="btn-ghost p-2 text-red-300" title="Xoá"
                        onClick={() => window.confirm(`Xoá ${u.name} cùng toàn bộ dữ liệu?`) && act(async () => { await del(`/admin/users/${u.id}`); setItems((l) => l.filter((x) => x.id !== u.id)); })}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && !items.length && <PageLoader />}
      </div>
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}

export function AdminPayments() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(() => get('/admin/payments', { status: status || undefined, limit: 50 }), [status]);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const { stats, items } = data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageTitle icon={CreditCard} title="Thanh toán" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Tổng doanh thu" value={money(stats.revenue)} hint={`${number(stats.paidOrders)} đơn đã thanh toán`} />
        <Tile label="Gói Premium đang chạy" value={number(stats.activeSubscriptions)} />
        <Tile label="Đơn thất bại / huỷ" value={number((stats.byStatus.failed || 0) + (stats.byStatus.cancelled || 0))} hint={`${number(stats.byStatus.pending || 0)} đang chờ`} />
      </div>
      {stats.daily.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Doanh thu 30 ngày gần nhất</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-700 text-left text-xs uppercase text-slate-400"><tr><th className="p-3">Ngày</th><th className="p-3 text-right">Số đơn</th><th className="p-3 text-right">Doanh thu</th></tr></thead>
              <tbody>{stats.daily.map((d) => <tr key={d.date} className="border-b border-surface-700/60 last:border-0"><td className="p-3">{d.date}</td><td className="p-3 text-right">{d.count}</td><td className="p-3 text-right">{money(d.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Đơn hàng</h2>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả</option><option value="paid">Đã thanh toán</option><option value="pending">Đang chờ</option><option value="failed">Thất bại</option><option value="cancelled">Đã huỷ</option>
          </select>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-surface-700 text-left text-xs uppercase text-slate-400">
              <tr><th className="p-3">Mã</th><th className="p-3">Người dùng</th><th className="p-3">Gói</th><th className="p-3 text-right">Số tiền</th><th className="p-3">Cổng</th><th className="p-3">Trạng thái</th><th className="p-3">Thời gian</th></tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-b border-surface-700/60 last:border-0">
                  <td className="p-3 font-mono text-xs">{o.id.slice(-8)}</td>
                  <td className="p-3"><Link to={`/channel/${o.userId}`} className="hover:underline">{o.userName}</Link></td>
                  <td className="p-3">{o.planName}</td>
                  <td className="p-3 text-right">{money(o.amount)}</td>
                  <td className="p-3 uppercase">{o.provider}</td>
                  <td className="p-3"><StatusBadge status={o.status} /></td>
                  <td className="p-3 text-slate-400">{dateTime(o.paidAt || o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <p className="p-6 text-center text-slate-500">Chưa có đơn hàng.</p>}
        </div>
      </section>
    </div>
  );
}
