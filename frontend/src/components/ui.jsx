import { useEffect } from 'react';
import { CircleAlert, Crown, LoaderCircle, X } from 'lucide-react';
import clsx from 'clsx';

export function Spinner({ className = 'h-6 w-6' }) {
  return <LoaderCircle className={clsx('animate-spin text-brand-500', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="mx-auto my-10 flex max-w-md flex-col items-center gap-3 text-center">
      <CircleAlert className="h-10 w-10 text-red-400" />
      <p className="text-slate-300">{message}</p>
      {onRetry && <button type="button" className="btn-secondary" onClick={() => onRetry()}>Thử lại</button>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="mx-auto my-16 flex max-w-md flex-col items-center gap-3 text-center">
      {Icon && <Icon className="h-12 w-12 text-slate-500" />}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="text-sm text-slate-400">{children}</div>}
    </div>
  );
}

export function Avatar({ src, name = '?', size = 'h-9 w-9', className }) {
  const initials = name.trim()[0]?.toUpperCase() || '?';
  if (src) return <img src={src} alt={name} className={clsx(size, 'shrink-0 rounded-full object-cover', className)} />;
  return (
    <div className={clsx(size, 'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-500 font-semibold text-white', className)}>
      {initials}
    </div>
  );
}

export function PremiumBadge({ className }) {
  return (
    <span className={clsx('badge bg-amber-400/15 text-amber-300', className)}>
      <Crown className="h-3 w-3" /> Premium
    </span>
  );
}

export function Modal({ open, onClose, title, children, size = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className={clsx('card w-full p-5 shadow-2xl', size)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageTitle({ icon: Icon, title, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        {Icon && <Icon className="h-6 w-6 text-brand-500" />}
        {title}
      </h1>
      {children}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }) {
  if (!hasMore && !loading) return null;
  return (
    <div className="mt-6 flex justify-center">
      {loading ? <Spinner /> : <button type="button" className="btn-secondary" onClick={onClick}>Tải thêm</button>}
    </div>
  );
}

const STATUS_STYLES = {
  queued: ['Đang chờ xử lý', 'bg-slate-500/20 text-slate-300'],
  processing: ['Đang xử lý', 'bg-sky-500/20 text-sky-300'],
  ready: ['Sẵn sàng', 'bg-emerald-500/20 text-emerald-300'],
  failed: ['Lỗi xử lý', 'bg-red-500/20 text-red-300'],
  pending: ['Chờ duyệt', 'bg-amber-500/20 text-amber-300'],
  approved: ['Đã duyệt', 'bg-emerald-500/20 text-emerald-300'],
  rejected: ['Bị từ chối', 'bg-red-500/20 text-red-300'],
  public: ['Công khai', 'bg-emerald-500/15 text-emerald-300'],
  unlisted: ['Không công khai', 'bg-slate-500/20 text-slate-300'],
  private: ['Riêng tư', 'bg-slate-500/20 text-slate-300'],
  paid: ['Đã thanh toán', 'bg-emerald-500/20 text-emerald-300'],
  cancelled: ['Đã huỷ', 'bg-slate-500/20 text-slate-300'],
};

export function StatusBadge({ status, children }) {
  const [label, cls] = STATUS_STYLES[status] || [status, 'bg-slate-500/20 text-slate-300'];
  return <span className={clsx('badge', cls)}>{children || label}</span>;
}
