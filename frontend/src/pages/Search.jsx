import { useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { get } from '../lib/api';
import { usePaged } from '../lib/useFetch';
import { VideoRow } from '../components/VideoCard';
import { Empty, ErrorBox, LoadMore, PageLoader } from '../components/ui';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'latest';
  const { items, loading, error, hasMore, loadMore, reload } = usePaged(
    (page) => get('/videos', { search: q, page, sort, limit: 20 }), [q, sort],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Kết quả cho “{q}”</h1>
        <select value={sort} onChange={(e) => { const n = new URLSearchParams(params); n.set('sort', e.target.value); setParams(n); }} className="input w-auto">
          <option value="latest">Mới nhất</option>
          <option value="popular">Xem nhiều nhất</option>
          <option value="liked">Nhiều lượt thích</option>
        </select>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : (
        <div className="space-y-5">{items.map((v) => <VideoRow key={v.id} video={v} />)}</div>
      )}
      {!loading && !error && !items.length && <Empty icon={SearchX} title="Không tìm thấy video">Thử từ khoá khác nhé.</Empty>}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}
