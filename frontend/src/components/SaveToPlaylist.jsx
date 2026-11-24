import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Globe, Lock, Plus } from 'lucide-react';
import { del, errorMessage, get, post } from '../lib/api';
import { Modal, Spinner } from './ui';

/** Hộp thoại "Lưu vào playlist": tick/bỏ tick từng playlist, tạo playlist mới. */
export default function SaveToPlaylist({ videoId, open, onClose }) {
  const [lists, setLists] = useState(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLists(null);
    get('/playlists/mine').then((d) => setLists(d.items)).catch((err) => toast.error(errorMessage(err)));
  }, [open]);

  const toggle = async (pl) => {
    const has = pl.videoIds.includes(videoId);
    try {
      if (has) await del(`/playlists/${pl.id}/videos/${videoId}`);
      else await post(`/playlists/${pl.id}/videos`, { videoId });
      setLists((ls) => ls.map((x) => (x.id === pl.id
        ? { ...x, videoIds: has ? x.videoIds.filter((v) => v !== videoId) : [...x.videoIds, videoId] }
        : x)));
      toast.success(has ? `Đã xoá khỏi "${pl.name}"` : `Đã lưu vào "${pl.name}"`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { playlist } = await post('/playlists', { name: name.trim(), visibility });
      await post(`/playlists/${playlist.id}/videos`, { videoId });
      setLists((ls) => [{ ...playlist, videoIds: [videoId] }, ...(ls || [])]);
      setName('');
      toast.success(`Đã tạo playlist "${playlist.name}"`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Lưu vào playlist" size="max-w-sm">
      {!lists ? <Spinner /> : (
        <div className="max-h-64 space-y-1 overflow-y-auto scrollbar-thin">
          {lists.length === 0 && <p className="text-sm text-slate-400">Bạn chưa có playlist nào.</p>}
          {lists.map((pl) => (
            <label key={pl.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-700">
              <input type="checkbox" checked={pl.videoIds.includes(videoId)} onChange={() => toggle(pl)} className="h-4 w-4 accent-brand-500" />
              <span className="flex-1 truncate">{pl.name}</span>
              {pl.visibility === 'private' ? <Lock className="h-4 w-4 text-slate-500" /> : <Globe className="h-4 w-4 text-slate-500" />}
            </label>
          ))}
        </div>
      )}
      <form onSubmit={create} className="mt-4 space-y-2 border-t border-surface-700 pt-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên playlist mới" maxLength={100} className="input" />
        <div className="flex items-center gap-2">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="input w-auto">
            <option value="public">Công khai</option>
            <option value="private">Riêng tư</option>
          </select>
          <button type="submit" className="btn-primary ml-auto" disabled={busy || !name.trim()}><Plus className="h-4 w-4" /> Tạo</button>
        </div>
      </form>
    </Modal>
  );
}
