import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { API_URL, api, errorMessage } from '../lib/api';
import { PageLoader } from '../components/ui';

function AuthCard({ title, subtitle, children }) {
  return (
    <div className="mx-auto mt-8 max-w-md">
      <div className="card p-8">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto h-12 w-12" />
          <h1 className="mt-3 text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function GoogleButton() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    api.get('/auth/google/status').then((r) => setAvailable(r.data.available)).catch(() => {});
  }, []);
  if (!available) return null;
  return (
    <>
      <div className="my-5 flex items-center gap-3 text-xs text-slate-500"><div className="h-px flex-1 bg-surface-600" />hoặc<div className="h-px flex-1 bg-surface-600" /></div>
      <a href={`${API_URL}/auth/google`} className="btn-secondary w-full">
        <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
        Tiếp tục với Google
      </a>
    </>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const from = location.state?.from || '/';

  useEffect(() => {
    if (params.get('error')) toast.error(params.get('error') === 'account_locked' ? 'Tài khoản đã bị khoá' : 'Đăng nhập Google thất bại');
  }, [params]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(form.email, form.password);
      toast.success(`Chào mừng ${u.name}!`);
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Đăng nhập" subtitle="Xem, thích và chia sẻ video">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" required autoComplete="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div>
          <div className="flex justify-between"><label className="label" htmlFor="password">Mật khẩu</label><Link to="/forgot-password" className="text-xs text-brand-400 hover:underline">Quên mật khẩu?</Link></div>
          <input id="password" type="password" required autoComplete="current-password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>Đăng nhập</button>
      </form>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-slate-400">Chưa có tài khoản? <Link to="/register" className="text-brand-400 hover:underline">Đăng ký</Link></p>
    </AuthCard>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast.error('Mật khẩu xác nhận không khớp');
    setBusy(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password });
      toast.success('Tạo tài khoản thành công!');
      navigate('/');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
    return null;
  };

  return (
    <AuthCard title="Tạo tài khoản" subtitle="Miễn phí — tải video lên ngay sau khi đăng ký">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="name">Tên hiển thị</label><input id="name" required maxLength={50} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="r-email">Email</label><input id="r-email" type="email" required autoComplete="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label" htmlFor="r-pass">Mật khẩu (tối thiểu 8 ký tự)</label><input id="r-pass" type="password" required minLength={8} autoComplete="new-password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div><label className="label" htmlFor="r-confirm">Nhập lại mật khẩu</label><input id="r-confirm" type="password" required minLength={8} autoComplete="new-password" className="input" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>Đăng ký</button>
      </form>
      <GoogleButton />
      <p className="mt-6 text-center text-sm text-slate-400">Đã có tài khoản? <Link to="/login" className="text-brand-400 hover:underline">Đăng nhập</Link></p>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Quên mật khẩu" subtitle="Nhập email để nhận link đặt lại mật khẩu">
      {sent ? (
        <div className="space-y-3 text-center text-sm text-slate-300">
          <p>Nếu email tồn tại trong hệ thống, link đặt lại mật khẩu đã được gửi. Link có hiệu lực trong 1 giờ.</p>
          {import.meta.env.DEV && <p className="text-xs text-slate-500">Chạy local: xem email tại <a className="text-brand-400 hover:underline" href="http://localhost:8025" target="_blank" rel="noreferrer">Mailpit (localhost:8025)</a></p>}
          <Link to="/login" className="btn-secondary">Quay lại đăng nhập</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <input type="email" required className="input" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn-primary w-full" disabled={busy}>Gửi link</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password });
      toast.success('Đặt lại mật khẩu thành công, hãy đăng nhập');
      navigate('/login');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Đặt mật khẩu mới">
      <form onSubmit={submit} className="space-y-4">
        <input type="password" required minLength={8} className="input" placeholder="Mật khẩu mới (tối thiểu 8 ký tự)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>Lưu mật khẩu</button>
      </form>
    </AuthCard>
  );
}

/** Google OAuth chuyển về đây với token sau dấu # */
export function AuthCallback() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', '/auth/callback');
    if (!token) { navigate('/login?error=google_auth_failed', { replace: true }); return; }
    loginWithToken(token).then((u) => {
      if (u) toast.success(`Chào mừng ${u.name}!`);
      navigate(u ? '/' : '/login?error=google_auth_failed', { replace: true });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <PageLoader />;
}
