import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Film } from 'lucide-react';
import './index.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Empty, PageLoader } from './components/ui';
import Home, { Trending } from './pages/Home';
import Search from './pages/Search';
import Watch from './pages/Watch';
import Channel from './pages/Channel';
import Playlists, { Library, PlaylistDetail } from './pages/Playlists';
import { History, Liked } from './pages/HistoryLiked';
import Upload from './pages/Upload';
import Studio from './pages/Studio';
import Profile from './pages/Profile';
import Premium, { MockPayment, PaymentResult } from './pages/Premium';
import { AuthCallback, ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import { AdminDashboard, AdminPayments, AdminUsers, AdminVideos } from './pages/Admin';

function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

const auth = (el, role) => <RequireAuth role={role}>{el}</RequireAuth>;

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="trending" element={<Trending />} />
        <Route path="search" element={<Search />} />
        <Route path="watch/:id" element={<Watch />} />
        <Route path="channel/:id" element={<Channel />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="playlist/:id" element={<PlaylistDetail />} />
        <Route path="premium" element={<Premium />} />

        <Route path="library" element={auth(<Library />)} />
        <Route path="history" element={auth(<History />)} />
        <Route path="liked" element={auth(<Liked />)} />
        <Route path="upload" element={auth(<Upload />)} />
        <Route path="studio" element={auth(<Studio />)} />
        <Route path="profile" element={auth(<Profile />)} />
        <Route path="payment/mock/:orderId" element={auth(<MockPayment />)} />
        <Route path="payment/result" element={auth(<PaymentResult />)} />

        <Route path="admin" element={auth(<AdminDashboard />, 'admin')} />
        <Route path="admin/videos" element={auth(<AdminVideos />, 'admin')} />
        <Route path="admin/users" element={auth(<AdminUsers />, 'admin')} />
        <Route path="admin/payments" element={auth(<AdminPayments />, 'admin')} />

        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password/:token" element={<ResetPassword />} />
        <Route path="auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<Empty icon={Film} title="Không tìm thấy trang">Đường dẫn không tồn tại.</Empty>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster theme="dark" position="bottom-left" richColors />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
