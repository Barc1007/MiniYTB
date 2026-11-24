import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Crown, Film, ImagePlus, Upload as UploadIcon } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, get } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { bytes } from '../lib/format';
import { PageTitle } from '../components/ui';

export default function Upload() {
  const { isPremium } = useAuth();
  const limits = useFetch(() => get('/videos/limits'), []);
  const LIMIT_MB = { free: limits.data?.freeMb ?? 200, premium: limits.data?.premiumMb ?? 1024 };
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [drag, setDrag] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tags: '', visibility: 'public' });
  const [progress, setProgress] = useState(null);
  const limit = LIMIT_MB[isPremium ? 'premium' : 'free'] * 1024 * 1024;

  const pick = (f) => {
    if (!f) return;
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v|mpe?g|3gp|flv|wmv)$/i.test(f.name)) {
      toast.error('Vui lòng chọn file video');
      return;
    }
    if (f.size > limit) {
      toast.error(`File vượt quá ${bytes(limit)}${isPremium ? '' : ' — nâng cấp Premium để tải file lớn hơn'}`);
      return;
    }
    setFile(f);
    if (!form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, '').slice(0, 150) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, v));
    if (thumb) data.append('thumbnail', thumb);
    data.append('video', file); // file lớn để cuối
    setProgress(0);
    try {
      await api.post('/videos', data, {
        onUploadProgress: (ev) => ev.total && setProgress(Math.round((ev.loaded / ev.total) * 100)),
      });
      toast.success('Tải lên thành công! Video đang được xử lý.');
      navigate('/studio');
    } catch (err) {
      toast.error(errorMessage(err));
      setProgress(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle icon={UploadIcon} title="Tải video lên" />
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={clsx('flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-16 text-center transition',
            drag ? 'border-brand-500 bg-brand-500/10' : 'border-surface-600 hover:border-slate-400')}
        >
          <div className="rounded-full bg-surface-700 p-6"><UploadIcon className="h-10 w-10 text-slate-300" /></div>
          <div>
            <p className="text-lg font-semibold">Kéo thả file video vào đây</p>
            <p className="text-sm text-slate-400">hoặc bấm để chọn file • MP4, MOV, MKV, WEBM... tối đa {bytes(limit)}</p>
          </div>
          {!isPremium && (
            <Link to="/premium" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-sm text-amber-300 hover:underline">
              <Crown className="h-4 w-4" /> Premium: tải lên tới {bytes(LIMIT_MB.premium * 1024 * 1024)} và xem chất lượng cao nhất
            </Link>
          )}
          <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files[0])} />
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div className="flex items-center gap-3 rounded-lg bg-surface-700 p-3">
            <Film className="h-8 w-8 text-brand-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-xs text-slate-400">{bytes(file.size)}</p>
            </div>
            {progress === null && <button type="button" className="btn-ghost" onClick={() => setFile(null)}>Đổi file</button>}
          </div>

          <div>
            <label className="label" htmlFor="title">Tiêu đề *</label>
            <input id="title" className="input" required maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="desc">Mô tả</label>
            <textarea id="desc" className="input" rows={5} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Giới thiệu về video của bạn" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="tags">Thẻ (phân cách bằng dấu phẩy)</label>
              <input id="tags" className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="du lịch, ẩm thực, vlog" />
            </div>
            <div>
              <label className="label" htmlFor="vis">Chế độ hiển thị</label>
              <select id="vis" className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                <option value="public">Công khai — ai cũng thấy</option>
                <option value="unlisted">Không công khai — chỉ ai có link</option>
                <option value="private">Riêng tư — chỉ mình tôi</option>
              </select>
            </div>
          </div>
          <div>
            <span className="label">Ảnh thumbnail (tuỳ chọn — để trống sẽ tự tạo từ video)</span>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-surface-600 p-3 hover:border-slate-400">
              {thumb ? <img src={URL.createObjectURL(thumb)} alt="" className="aspect-video w-32 rounded object-cover" /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
              <span className="text-sm text-slate-300">{thumb ? thumb.name : 'Chọn ảnh JPG/PNG/WEBP'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setThumb(e.target.files[0] || null)} />
            </label>
          </div>

          {progress !== null && (
            <div>
              <div className="mb-1 flex justify-between text-sm"><span>{progress < 100 ? 'Đang tải lên...' : 'Đang lưu...'}</span><span>{progress}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-700"><div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          <p className="text-xs text-slate-500">Sau khi tải lên, hệ thống sẽ chuyển mã video sang nhiều độ phân giải (360p trở lên, tuỳ chất lượng video gốc) và gửi cho quản trị viên duyệt.</p>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={progress !== null || !form.title.trim()}><UploadIcon className="h-4 w-4" /> Tải lên</button>
          </div>
        </form>
      )}
    </div>
  );
}
