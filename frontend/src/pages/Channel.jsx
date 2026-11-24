import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Clapperboard, ListVideo, Settings } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { get } from '../lib/api';
import { useFetch, usePaged } from '../lib/useFetch';
import { dateOnly } from '../lib/format';
import { VideoGrid } from '../components/VideoCard';
import { Avatar, Empty, ErrorBox, LoadMore, PageLoader } from '../components/ui';
import { PlaylistGrid } from './Playlists';

export default function Channel() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState('videos');
  const [sort, setSort] = useState('latest');
  const profile = useFetch(() => get(`/users/${id}`), [id]);
  const videos = usePaged((page) => get('/videos', { owner: id, page, sort }), [id, sort]);
  const playlists = useFetch(() => (tab === 'playlists' ? get('/playlists', { owner: id, limit: 50 }) : Promise.resolve(null)), [id, tab]);

  if (profile.loading) return <PageLoader />;
  if (profile.error) return <ErrorBox message={profile.error} />;
  const channel = profile.data.user;
  const isMe = user?.id === id;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="h-32 rounded-2xl bg-gradient-to-r from-brand-700 via-rose-700 to-indigo-700 sm:h-44" />
      <div className="-mt-10 flex flex-wrap items-end gap-4 px-4">
        <Avatar src={channel.avatar} name={channel.name} size="h-24 w-24 sm:h-28 sm:w-28" className="border-4 border-surface-900 text-3xl" />
        <div className="min-w-0 flex-1 pb-2">
          <h1 className="text-2xl font-bold">{channel.name}</h1>
          <p className="text-sm text-slate-400">Tham gia {dateOnly(channel.joinedAt)}</p>
          {channel.bio && <p className="mt-1 max-w-2xl text-sm text-slate-300">{channel.bio}</p>}
        </div>
        {isMe && (
          <div className="flex gap-2 pb-2">
            <Link to="/profile" className="btn-secondary"><Settings className="h-4 w-4" /> Tuỳ chỉnh</Link>
            <Link to="/studio" className="btn-secondary">Quản lý video</Link>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-6 border-b border-surface-700 px-4">
        {[['videos', 'Video'], ['playlists', 'Playlist']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={clsx('-mb-px border-b-2 py-3 text-sm font-semibold', tab === key ? 'border-white' : 'border-transparent text-slate-400 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'videos' && (
          <>
            <div className="mb-4 flex gap-2">
              {[['latest', 'Mới nhất'], ['popular', 'Phổ biến'], ['oldest', 'Cũ nhất']].map(([key, label]) => (
                <button key={key} type="button" className={sort === key ? 'chip-active' : 'chip'} onClick={() => setSort(key)}>{label}</button>
              ))}
            </div>
            {videos.loading && !videos.items.length ? <PageLoader /> : <VideoGrid videos={videos.items} />}
            {!videos.loading && !videos.items.length && <Empty icon={Clapperboard} title="Kênh chưa có video công khai" />}
            <LoadMore hasMore={videos.hasMore} loading={videos.loading && videos.items.length > 0} onClick={videos.loadMore} />
          </>
        )}
        {tab === 'playlists' && (
          playlists.loading ? <PageLoader /> : playlists.data?.items?.length
            ? <PlaylistGrid playlists={playlists.data.items} />
            : <Empty icon={ListVideo} title="Chưa có playlist công khai" />
        )}
      </div>
    </div>
  );
}
