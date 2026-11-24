import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lưu user + token mới (backend trả token mới sau mỗi lần cập nhật hồ sơ / nâng cấp gói)
  const applySession = useCallback(({ user: u, token }) => {
    if (token) tokenStore.set(token);
    setUser(u || null);
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  /** Tải lại thông tin user + token từ user-service. */
  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return null;
    }
    try {
      const { data } = await api.get('/users/me');
      applySession(data.data);
      return data.data.user;
    } catch {
      logout();
      return null;
    }
  }, [applySession, logout]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    refresh().finally(() => setLoading(false));
  }, [refresh, logout]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    applySession(data.data);
    return data.data.user;
  }, [applySession]);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    applySession(data.data);
    return data.data.user;
  }, [applySession]);

  const loginWithToken = useCallback(async (token) => {
    tokenStore.set(token);
    return refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    user,
    loading,
    isAdmin: user?.role === 'admin',
    isPremium: user?.plan?.type === 'premium',
    login, register, logout, refresh, applySession, loginWithToken,
  }), [user, loading, login, register, logout, refresh, applySession, loginWithToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
