import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Clapperboard, CreditCard, Crown, Flame, History, House, Library, LayoutDashboard, ListVideo, LogOut,
  Menu, Search, Settings, ShieldCheck, ThumbsUp, Upload, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { Avatar, PremiumBadge } from './ui';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className="hidden text-lg font-bold tracking-tight sm:inline">
        Mini<span className="text-brand-500">YTB</span>
      </span>
    </Link>
  );
}

function SearchBox() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const navigate = useNavigate();
  useEffect(() => setQ(params.get('q') || ''), [params]);
  return (
    <form
      className="flex w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm kiếm video, kênh, thẻ..."
        className="input rounded-l-full rounded-r-none border-r-0 px-4"
        aria-label="Tìm kiếm"
      />
      <button type="submit" className="rounded-r-full border border-surface-600 bg-surface-700 px-5 hover:bg-surface-600" aria-label="Tìm">
        <Search className="h-4 w-4" />
      </button>
    </form>
  );
}

function UserMenu() {
  const { user, logout, isAdmin, isPremium } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const item = 'flex w-full items-center gap-3 px-4 py-2 text-sm text-slate-200 hover:bg-surface-700';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="rounded-full ring-brand-500 focus:ring-2" aria-label="Menu tài khoản">
        <Avatar src={user.avatar} name={user.name} size="h-9 w-9" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-surface-700 bg-surface-800 py-2 shadow-2xl" onClick={() => setOpen(false)}>
          <div className="flex items-center gap-3 border-b border-surface-700 px-4 pb-3">
            <Avatar src={user.avatar} name={user.name} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="truncate text-xs text-slate-400">{user.email}</p>
              {isPremium && <PremiumBadge className="mt-1" />}
            </div>
          </div>
          <Link to={`/channel/${user.id}`} className={item}><Clapperboard className="h-4 w-4" /> Kênh của tôi</Link>
          <Link to="/studio" className={item}><LayoutDashboard className="h-4 w-4" /> Studio</Link>
          <Link to="/premium" className={item}><Crown className="h-4 w-4 text-amber-300" /> {isPremium ? 'Gói Premium' : 'Nâng cấp Premium'}</Link>
          <Link to="/profile" className={item}><Settings className="h-4 w-4" /> Cài đặt tài khoản</Link>
          {isAdmin && <Link to="/admin" className={item}><ShieldCheck className="h-4 w-4" /> Quản trị</Link>}
          <button type="button" className={clsx(item, 'text-red-300')} onClick={() => { logout(); navigate('/'); }}>
            <LogOut className="h-4 w-4" /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

function SideLink({ to, icon: Icon, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => clsx(
        'flex items-center gap-4 rounded-lg px-3 py-2 text-sm transition',
        isActive ? 'bg-surface-700 font-semibold text-white' : 'text-slate-300 hover:bg-surface-800',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function Sidebar() {
  const { user, isAdmin } = useAuth();
  return (
    <nav className="flex flex-col gap-1 p-3">
      <SideLink to="/" icon={House} end>Trang chủ</SideLink>
      <SideLink to="/trending" icon={Flame}>Thịnh hành</SideLink>
      <SideLink to="/playlists" icon={ListVideo}>Playlist cộng đồng</SideLink>
      <div className="my-2 border-t border-surface-700" />
      {user ? (
        <>
          <SideLink to="/library" icon={Library}>Thư viện</SideLink>
          <SideLink to="/history" icon={History}>Lịch sử xem</SideLink>
          <SideLink to="/liked" icon={ThumbsUp}>Video đã thích</SideLink>
          <SideLink to="/studio" icon={LayoutDashboard}>Studio</SideLink>
          <SideLink to="/premium" icon={Crown}>Premium</SideLink>
        </>
      ) : (
        <div className="px-3 py-2 text-sm text-slate-400">
          Đăng nhập để thích video, bình luận và tạo playlist.
          <Link to="/login" className="btn-secondary mt-3 w-full">Đăng nhập</Link>
        </div>
      )}
      {isAdmin && (
        <>
          <div className="my-2 border-t border-surface-700" />
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Quản trị</p>
          <SideLink to="/admin" icon={ShieldCheck} end>Tổng quan</SideLink>
          <SideLink to="/admin/videos" icon={Clapperboard}>Duyệt video</SideLink>
          <SideLink to="/admin/users" icon={Users}>Người dùng</SideLink>
          <SideLink to="/admin/payments" icon={CreditCard}>Thanh toán</SideLink>
        </>
      )}
      <p className="mt-6 px-3 text-xs text-slate-600">© MiniYTB</p>
    </nav>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const isWatch = location.pathname.startsWith('/watch');
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-surface-700 bg-surface-900/95 px-4 backdrop-blur">
        <button type="button" className="btn-ghost p-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Mở menu">
          <Menu className="h-5 w-5" />
        </button>
        <Logo />
        <div className="flex flex-1 justify-center"><SearchBox /></div>
        {user ? (
          <div className="flex items-center gap-2">
            <Link to="/upload" className="btn-secondary hidden sm:inline-flex"><Upload className="h-4 w-4" /> Tải lên</Link>
            <UserMenu />
          </div>
        ) : (
          <Link to="/login" className="btn-primary">Đăng nhập</Link>
        )}
      </header>

      <div className="flex">
        <aside className={clsx('sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto scrollbar-thin', !isWatch && 'lg:block')}>
          <Sidebar />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setDrawer(false)}>
            <aside className="h-full w-64 overflow-y-auto bg-surface-900" onClick={(e) => e.stopPropagation()}>
              <div className="flex h-14 items-center gap-3 px-4">
                <button type="button" className="btn-ghost p-2" onClick={() => setDrawer(false)} aria-label="Đóng menu"><X className="h-5 w-5" /></button>
                <Logo />
              </div>
              <Sidebar />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
