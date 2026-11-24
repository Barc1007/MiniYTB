import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera, Crown, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { dateOnly } from '../lib/format';
import { Avatar, PageTitle, PremiumBadge } from '../components/ui';

export default function Profile() {
  const { user, applySession, logout, isPremium } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: user.name, bio: user.bio || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [deletePw, setDeletePw] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = (e) => {
    e.preventDefault();
    run(async () => applySession((await api.put('/users/me', form)).data.data), 'Đã cập nhật hồ sơ');
  };

  const uploadAvatar = (file) => {
    if (!file) return;
    const data = new FormData();
    data.append('avatar', file);
    run(async () => applySession((await api.post('/users/me/avatar', data)).data.data), 'Đã đổi ảnh đại diện');
  };

  const changePassword = (e) => {
    e.preventDefault();
    run(async () => {
      await api.put('/users/me/password', pw);
      setPw({ currentPassword: '', newPassword: '' });
    }, 'Đã đổi mật khẩu');
  };

  const deleteAccount = (e) => {
    e.preventDefault();
    if (!window.confirm('Xoá tài khoản sẽ xoá toàn bộ video, bình luận và playlist của bạn. Không thể hoàn tác. Tiếp tục?')) return;
    run(async () => {
      await api.delete('/users/me', { data: { password: deletePw } });
      logout();
      navigate('/');
    }, 'Tài khoản đã được xoá');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle icon={Settings} title="Cài đặt tài khoản" />

      <section className="card p-6">
        <div className="flex flex-wrap items-center gap-5">
          <label className="group relative cursor-pointer">
            <Avatar src={user.avatar} name={user.name} size="h-24 w-24" className="text-3xl" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100"><Camera className="h-6 w-6" /></span>
            <input type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(e.target.files[0])} />
          </label>
          <div>
            <p className="text-xl font-semibold">{user.name}</p>
            <p className="text-sm text-slate-400">{user.email} • tham gia {dateOnly(user.joinedAt)}</p>
            <div className="mt-2 flex items-center gap-2">
              {isPremium ? (
                <><PremiumBadge /><span className="text-xs text-slate-400">đến {dateOnly(user.plan.expiresAt)}</span></>
              ) : (
                <Link to="/premium" className="badge bg-surface-700 text-amber-300 hover:bg-surface-600"><Crown className="h-3 w-3" /> Nâng cấp Premium</Link>
              )}
              {user.role === 'admin' && <span className="badge bg-indigo-500/20 text-indigo-300">Admin</span>}
            </div>
          </div>
        </div>
        <form onSubmit={saveProfile} className="mt-6 space-y-4">
          <div><label className="label" htmlFor="p-name">Tên hiển thị</label><input id="p-name" className="input" required maxLength={50} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="p-bio">Giới thiệu kênh</label><textarea id="p-bio" className="input" rows={3} maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
          <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy}>Lưu hồ sơ</button></div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold">{user.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</h2>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2">
          {user.hasPassword && (
            <input type="password" required placeholder="Mật khẩu hiện tại" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          )}
          <input type="password" required minLength={8} placeholder="Mật khẩu mới" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <div className="flex justify-end sm:col-span-2"><button type="submit" className="btn-secondary" disabled={busy}>Cập nhật mật khẩu</button></div>
        </form>
      </section>

      <section className="rounded-xl border border-red-500/40 p-6">
        <h2 className="text-lg font-semibold text-red-300">Xoá tài khoản</h2>
        <p className="mt-1 text-sm text-slate-400">Toàn bộ video, bình luận, lượt thích và playlist của bạn sẽ bị xoá khỏi mọi service.</p>
        <form onSubmit={deleteAccount} className="mt-4 flex flex-wrap gap-3">
          {user.hasPassword && <input type="password" required placeholder="Nhập mật khẩu để xác nhận" className="input max-w-xs" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />}
          <button type="submit" className="btn-danger" disabled={busy}>Xoá tài khoản</button>
        </form>
      </section>
    </div>
  );
}
