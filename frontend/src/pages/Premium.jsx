import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, CircleAlert, CreditCard, Crown, LoaderCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { errorMessage, get, post } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { dateOnly, dateTime, money } from '../lib/format';
import { ErrorBox, PageLoader, PremiumBadge, StatusBadge } from '../components/ui';

export default function Premium() {
  const { user, isPremium } = useAuth();
  const navigate = useNavigate();
  const plans = useFetch(() => get('/payments/plans'), []);
  const orders = useFetch(() => (user ? get('/payments/mine') : Promise.resolve({ items: [] })), [user?.id]);
  const [provider, setProvider] = useState('mock');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (plans.data && !plans.data.providers.mock && plans.data.providers.vnpay) setProvider('vnpay');
  }, [plans.data]);

  const buy = async (planId) => {
    if (!user) return navigate('/login', { state: { from: '/premium' } });
    setBusy(planId);
    try {
      const { paymentUrl } = await post('/payments/checkout', { planId, provider });
      if (paymentUrl.startsWith(window.location.origin)) navigate(paymentUrl.slice(window.location.origin.length));
      else window.location.href = paymentUrl;
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
    return null;
  };

  if (plans.loading) return <PageLoader />;
  if (plans.error) return <ErrorBox message={plans.error} onRetry={plans.reload} />;
  const { providers } = plans.data;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-10 text-center">
        <Crown className="mx-auto h-12 w-12 text-amber-300" />
        <h1 className="mt-3 text-3xl font-bold">MiniYTB Premium</h1>
        <p className="mt-2 text-slate-400">Xem video ở chất lượng cao nhất và tải lên file lớn hơn.</p>
        {isPremium && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
            <PremiumBadge /> Đang hoạt động đến {dateOnly(user.plan.expiresAt)} — mua thêm sẽ cộng dồn thời hạn
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {plans.data.plans.map((p) => (
          <div key={p.id} className={clsx('card relative flex flex-col p-6', p.badge && 'border-amber-400/60')}>
            {p.badge && <span className="absolute -top-3 left-6 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-slate-900">{p.badge}</span>}
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="mt-2 text-3xl font-bold">{money(p.amount)}</p>
            <p className="text-sm text-slate-400">{p.days} ngày</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {p.features.map((f) => <li key={f} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> {f}</li>)}
            </ul>
            <button type="button" className="btn-primary mt-6" disabled={!!busy} onClick={() => buy(p.id)}>
              {busy === p.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {isPremium ? 'Gia hạn' : 'Đăng ký ngay'}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="text-slate-400">Cổng thanh toán:</span>
        {providers.mock && <label className="flex items-center gap-2"><input type="radio" name="provider" checked={provider === 'mock'} onChange={() => setProvider('mock')} className="accent-brand-500" /> Giả lập (demo)</label>}
        <label className={clsx('flex items-center gap-2', !providers.vnpay && 'opacity-50')} title={providers.vnpay ? '' : 'Cần cấu hình VNPAY_TMN_CODE và VNPAY_HASH_SECRET'}>
          <input type="radio" name="provider" disabled={!providers.vnpay} checked={provider === 'vnpay'} onChange={() => setProvider('vnpay')} className="accent-brand-500" /> VNPay (sandbox){!providers.vnpay && ' — chưa cấu hình'}
        </label>
      </div>

      {user && orders.data?.items?.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-lg font-semibold">Lịch sử giao dịch</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-700 text-left text-xs uppercase text-slate-400">
                <tr><th className="p-3">Mã đơn</th><th className="p-3">Gói</th><th className="p-3">Số tiền</th><th className="p-3">Cổng</th><th className="p-3">Trạng thái</th><th className="p-3">Thời gian</th></tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="border-b border-surface-700/60 last:border-0">
                    <td className="p-3 font-mono text-xs">{o.id.slice(-8)}</td>
                    <td className="p-3">{o.planName}</td>
                    <td className="p-3">{money(o.amount)}</td>
                    <td className="p-3 uppercase">{o.provider}</td>
                    <td className="p-3"><StatusBadge status={o.status} /></td>
                    <td className="p-3 text-slate-400">{dateTime(o.paidAt || o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/** Trang cổng thanh toán GIẢ LẬP — chỉ dùng để demo luồng thanh toán khi chạy local. */
export function MockPayment() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useFetch(() => get(`/payments/orders/${orderId}`), [orderId]);
  const [busy, setBusy] = useState(false);

  const complete = async (result) => {
    setBusy(true);
    try {
      await post(`/payments/mock/${orderId}/complete`, { result });
      navigate(`/payment/result?orderId=${orderId}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorBox message={error} />;
  const order = data.order;

  return (
    <div className="mx-auto mt-8 max-w-md">
      <div className="overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl">
        <div className="bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-4 text-white">
          <p className="text-xs uppercase tracking-widest opacity-80">Cổng thanh toán giả lập</p>
          <p className="text-lg font-semibold">Demo Pay</p>
        </div>
        <div className="space-y-3 p-6 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Đơn hàng</span><span className="font-mono">{order.id}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Nội dung</span><span>{order.planName}</span></div>
          <div className="flex justify-between border-t pt-3 text-base"><span>Số tiền</span><span className="font-bold">{money(order.amount)}</span></div>
          {order.status !== 'pending' ? (
            <p className="rounded bg-slate-100 p-3 text-center">Đơn hàng đã ở trạng thái: <b>{order.status}</b></p>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-3">
              <button type="button" disabled={busy} onClick={() => complete('fail')} className="rounded-lg border border-slate-300 py-2.5 font-medium hover:bg-slate-100">Huỷ / Thất bại</button>
              <button type="button" disabled={busy} onClick={() => complete('success')} className="rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-500">Thanh toán</button>
            </div>
          )}
          <p className="flex items-start gap-2 pt-2 text-xs text-slate-500"><CircleAlert className="h-4 w-4 shrink-0" /> Đây là cổng thanh toán thử nghiệm, không có giao dịch thật nào được thực hiện.</p>
        </div>
      </div>
    </div>
  );
}

export function PaymentResult() {
  const [params] = useSearchParams();
  const orderId = params.get('orderId');
  const { refresh } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let tries = 0;
    let timer;
    const poll = async () => {
      try {
        const { order: o } = await get(`/payments/orders/${orderId}`);
        setOrder(o);
        if (o.status === 'pending' && tries++ < 10) timer = setTimeout(poll, 1500);
        // Gói được nâng cấp bất đồng bộ qua sự kiện -> làm mới user/token vài lần
        if (o.status === 'paid') { await refresh(); setTimeout(refresh, 1500); }
      } catch (err) {
        setError(errorMessage(err));
      }
    };
    if (orderId) poll(); else setError('Thiếu mã đơn hàng');
    return () => clearTimeout(timer);
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox message={error} />;
  if (!order) return <PageLoader />;
  const paid = order.status === 'paid';
  return (
    <div className="mx-auto mt-12 max-w-md text-center">
      <div className={clsx('mx-auto flex h-16 w-16 items-center justify-center rounded-full', paid ? 'bg-emerald-500/20' : 'bg-red-500/20')}>
        {paid ? <Check className="h-8 w-8 text-emerald-400" /> : order.status === 'pending' ? <LoaderCircle className="h-8 w-8 animate-spin" /> : <CircleAlert className="h-8 w-8 text-red-400" />}
      </div>
      <h1 className="mt-4 text-2xl font-bold">{paid ? 'Thanh toán thành công!' : order.status === 'pending' ? 'Đang xác nhận thanh toán...' : 'Thanh toán không thành công'}</h1>
      {paid && <p className="mt-2 text-slate-400">Premium có hiệu lực đến {dateOnly(order.subscriptionExpiresAt)}.</p>}
      <div className="mt-6 flex justify-center gap-3">
        <Link to="/" className="btn-primary">Xem video ngay</Link>
        <Link to="/premium" className="btn-secondary">Về trang Premium</Link>
      </div>
    </div>
  );
}
