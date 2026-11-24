import { useSearchParams } from 'react-router-dom';
import { Clapperboard, Flame } from 'lucide-react';
import clsx from 'clsx';
import { get } from '../lib/api';
import { useFetch, usePaged } from '../lib/useFetch';
import { VideoGrid } from '../components/VideoCard';
import { Empty, ErrorBox, LoadMore, PageLoader, PageTitle } from '../components/ui';

function TagBar({ active, onChange }) {
  const { data } = useFetch(() => get('/videos/tags'), []);
  const tags = data?.tags || [];
  if (!tags.length) return null;
  return (
    <div className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-thin">
      <button type="button" className={!active ? 'chip-active' : 'chip'} onClick={() => onChange(null)}>Tất cả</button>
      {tags.map((t) => (
        <button key={t.name} type="button" className={active === t.name ? 'chip-active' : 'chip'} onClick={() => onChange(t.name)}>#{t.name}</button>
      ))}
    </div>
  );
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const sort = params.get('sort') || 'latest';
  const { items, loading, error, hasMore, loadMore, reload } = usePaged((page) => get('/videos', { page, tag, sort }), [tag, sort]);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };

  return (
    <div>
      <TagBar active={tag} onChange={(t) => update('tag', t)} />
      <div className="mb-4 flex gap-2 text-sm">
        {[['latest', 'Mới nhất'], ['popular', 'Xem nhiều'], ['liked', 'Yêu thích']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => update('sort', key === 'latest' ? null : key)}
            className={clsx('rounded-lg px-3 py-1.5', sort === key ? 'bg-surface-700 font-semibold' : 'text-slate-400 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !items.length ? <PageLoader /> : <VideoGrid videos={items} />}
      {!loading && !error && !items.length && (
        <Empty icon={Clapperboard} title="Chưa có video nào">Hãy là người đầu tiên tải video lên!</Empty>
      )}
      <LoadMore hasMore={hasMore} loading={loading && items.length > 0} onClick={loadMore} />
    </div>
  );
}

export function Trending() {
  const { data, loading, error, reload } = useFetch(() => get('/videos/trending', { limit: 24 }), []);
  return (
    <div>
      <PageTitle icon={Flame} title="Thịnh hành" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading ? <PageLoader /> : <VideoGrid videos={data?.items || []} />}
      {!loading && !data?.items?.length && <Empty icon={Flame} title="Chưa có video thịnh hành" />}
    </div>
  );
}
