import { Link } from 'react-router-dom';
import { Film } from 'lucide-react';
import clsx from 'clsx';
import { Avatar } from './ui';
import { duration, timeAgo, views } from '../lib/format';

export function Thumbnail({ video, className, children }) {
  return (
    <div className={clsx('relative aspect-video overflow-hidden rounded-xl bg-surface-700', className)}>
      {video.thumbnail ? (
        <img src={video.thumbnail} alt={video.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
      ) : (
        <div className="flex h-full w-full items-center justify-center"><Film className="h-10 w-10 text-slate-500" /></div>
      )}
      {video.duration > 0 && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium">{duration(video.duration)}</span>
      )}
      {children}
    </div>
  );
}

/** Thẻ video dạng lưới (trang chủ, tìm kiếm, kênh). */
export default function VideoCard({ video, showOwner = true, to }) {
  const href = to || `/watch/${video.id}`;
  return (
    <div className="group">
      <Link to={href}><Thumbnail video={video} /></Link>
      <div className="mt-3 flex gap-3">
        {showOwner && (
          <Link to={`/channel/${video.owner.id}`} className="shrink-0">
            <Avatar src={video.owner.avatar} name={video.owner.name} />
          </Link>
        )}
        <div className="min-w-0">
          <Link to={href} className="line-clamp-2 font-semibold leading-snug hover:text-brand-400" title={video.title}>{video.title}</Link>
          {showOwner && (
            <Link to={`/channel/${video.owner.id}`} className="mt-1 block truncate text-sm text-slate-400 hover:text-slate-200">{video.owner.name}</Link>
          )}
          <p className="text-sm text-slate-400">{views(video.stats.views)} • {timeAgo(video.publishedAt || video.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}

/** Thẻ video dạng hàng ngang (video liên quan, lịch sử, playlist). */
export function VideoRow({ video, to, compact = false, extra, actions }) {
  const href = to || `/watch/${video.id}`;
  return (
    <div className="group flex gap-3">
      <Link to={href} className={clsx('shrink-0', compact ? 'w-40' : 'w-56 sm:w-64')}>
        <Thumbnail video={video} className="rounded-lg">
          {video.position > 0 && video.duration > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (video.position / video.duration) * 100)}%` }} />
            </div>
          )}
        </Thumbnail>
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={href} className={clsx('line-clamp-2 font-semibold leading-snug hover:text-brand-400', compact ? 'text-sm' : 'text-base')}>{video.title}</Link>
        <Link to={`/channel/${video.owner.id}`} className="mt-1 block truncate text-xs text-slate-400 hover:text-slate-200">{video.owner.name}</Link>
        <p className="text-xs text-slate-400">{views(video.stats.views)} • {timeAgo(video.publishedAt || video.createdAt)}</p>
        {!compact && video.description && <p className="mt-1 hidden text-xs text-slate-500 sm:line-clamp-2">{video.description}</p>}
        {extra}
      </div>
      {actions}
    </div>
  );
}

export function VideoGrid({ videos }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {videos.map((v) => <VideoCard key={v.id} video={v} />)}
    </div>
  );
}
