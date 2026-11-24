import axios from 'axios';

// Mặc định gọi cùng origin (/api) — Vite (dev) hoặc nginx (docker) sẽ proxy sang API Gateway.
// Khi deploy frontend tách riêng (Render Static Site), đặt VITE_GATEWAY_URL=https://<gateway> (tự thêm /api)
// hoặc VITE_API_URL=https://<gateway>/api.
const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || '').replace(/\/+$/, '');
export const API_URL = import.meta.env.VITE_API_URL || (GATEWAY ? `${GATEWAY}/api` : '/api');
const TOKEN_KEY = 'myt.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
};

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && tokenStore.get()) onUnauthorized?.();
    return Promise.reject(error);
  },
);

/** Lấy thông báo lỗi dễ đọc từ lỗi axios. */
export function errorMessage(err, fallback = 'Đã xảy ra lỗi, vui lòng thử lại') {
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.code === 'ERR_NETWORK') return 'Không kết nối được máy chủ';
  return err?.message || fallback;
}

/** Gọi API, trả về phần data. */
export async function get(url, params) {
  return (await api.get(url, { params })).data.data;
}
export async function post(url, body, config) {
  return (await api.post(url, body, config)).data.data;
}
export async function put(url, body) {
  return (await api.put(url, body)).data.data;
}
export async function del(url, body) {
  return (await api.delete(url, { data: body })).data;
}
