const nf = new Intl.NumberFormat('vi-VN');

export function compact(n = 0) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '')} T`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} Tr`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.0', '')} N`;
  return nf.format(n);
}

export const views = (n) => `${compact(n)} lượt xem`;
export const number = (n) => nf.format(n || 0);
export const money = (n) => `${nf.format(n || 0)} ₫`;

export function duration(sec = 0) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function timeAgo(date) {
  if (!date) return '';
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  const units = [
    [31536000, 'năm'], [2592000, 'tháng'], [604800, 'tuần'], [86400, 'ngày'], [3600, 'giờ'], [60, 'phút'],
  ];
  for (const [s, label] of units) if (diff >= s) return `${Math.floor(diff / s)} ${label} trước`;
  return 'Vừa xong';
}

export function bytes(n = 0) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export const dateTime = (d) => (d ? new Date(d).toLocaleString('vi-VN') : '');
export const dateOnly = (d) => (d ? new Date(d).toLocaleDateString('vi-VN') : '');
