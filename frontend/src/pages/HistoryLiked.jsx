import { toast } from 'sonner';
import { History as HistoryIcon, ThumbsUp, Trash2, X } from 'lucide-react';
import { del, errorMessage, get } from '../lib/api';
import { usePaged } from '../lib/useFetch';
import { timeAgo } from '../lib/format';
import { VideoRow } from '../components/VideoCard';
import { Empty, ErrorBox, LoadMore, PageLoader, PageTitle } from '../components/ui';

export function History() {
  const { items, setItems, loading, error, hasMore, loadMore, reload } = usePaged((page) => get('/history', { page }), []);

  const clearAll = async () => {
    if (!window.confirm('Xoá toàn bộ lịch sử xem?')) return;
    try {
      await del('/history');
      setItems([]);
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const removeOne = async (id) => {
    await del(`/history/${id}`).catch(() => {});
    setItems((list) => list.filter((v) => v.id !== id));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle icon={HistoryIcon} title="Lịch sử xem">
        {items.length > 0 && <button type="button" className="btn-secondary" onClick={clearAll}><Trash2 className="h-4 w-4" /> Xoá tất cả</button>}
      </PageTitle>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : (
        <div className="space-y-5">
          {items.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              extra={<p className="mt-1 text-xs text-slate-500">Đã xem {timeAgo(v.watchedAt)}</p>}
              actions={<button type="button" className="btn-ghost h-9 p-2" onClick={() => removeOne(v.id)} aria-label="Xoá khỏi lịch sử"><X className="h-4 w-4" /></button>}
            />
          ))}
        </div>
      )}
      {!loading && !items.length && !error && <Empty icon={HistoryIcon} title="Chưa có lịch sử xem" />}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}

export function Liked() {
  // comment-service trả danh sách id -> video-service trả chi tiết (ghép dữ liệu từ 2 service)
  const { items, loading, error, hasMore, loadMore, reload } = usePaged(async (page) => {
    const liked = await get('/reactions/mine/liked', { page });
    if (!liked.items.length) return { items: [], pagination: liked.pagination };
    const { items: videos } = await get('/videos/batch', { ids: liked.items.map((x) => x.videoId).join(',') });
    return { items: videos, pagination: liked.pagination };
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle icon={ThumbsUp} title="Video đã thích" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : <div className="space-y-5">{items.map((v) => <VideoRow key={v.id} video={v} />)}</div>}
      {!loading && !items.length && !error && <Empty icon={ThumbsUp} title="Bạn chưa thích video nào" />}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}
