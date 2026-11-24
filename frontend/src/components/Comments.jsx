import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, CornerDownRight, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { del, errorMessage, get, post, put } from '../lib/api';
import { usePaged } from '../lib/useFetch';
import { number, timeAgo } from '../lib/format';
import { Avatar, LoadMore, Spinner } from './ui';

function CommentForm({ videoId, parentId, onCreated, onCancel, autoFocus, placeholder = 'Viết bình luận...' }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) {
    return <p className="text-sm text-slate-400"><Link to="/login" className="text-brand-400 hover:underline">Đăng nhập</Link> để bình luận.</p>;
  }
  const submit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      const { comment } = await post('/comments', { videoId, content: content.trim(), parentId });
      setContent('');
      onCreated(comment);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-3">
      <Avatar src={user.avatar} name={user.name} size={parentId ? 'h-7 w-7' : 'h-10 w-10'} />
      <div className="flex-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          rows={content.split('\n').length > 1 ? 3 : 1}
          maxLength={2000}
          autoFocus={autoFocus}
          className="w-full resize-none border-b border-surface-600 bg-transparent py-1 text-sm focus:border-slate-200 focus:outline-none"
        />
        {(content || onCancel) && (
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => { setContent(''); onCancel?.(); }}>Huỷ</button>
            <button type="submit" className="btn-primary" disabled={busy || !content.trim()}>{parentId ? 'Trả lời' : 'Bình luận'}</button>
          </div>
        )}
      </div>
    </form>
  );
}

function CommentItem({ comment, videoId, onDeleted, onReplyAdded, isReply }) {
  const [item, setItem] = useState(comment);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState(null);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const loadReplies = async () => {
    setShowReplies((s) => !s);
    if (replies) return;
    setLoadingReplies(true);
    try {
      setReplies((await get(`/comments/${item.id}/replies`, { limit: 50 })).items);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingReplies(false);
    }
  };

  const save = async () => {
    try {
      const { comment: c } = await put(`/comments/${item.id}`, { content: draft });
      setItem(c);
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!window.confirm('Xoá bình luận này?')) return;
    try {
      const res = await del(`/comments/${item.id}`);
      onDeleted(item.id, res.data.deleted);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex gap-3">
      <Link to={`/channel/${item.user.id}`}><Avatar src={item.user.avatar} name={item.user.name} size={isReply ? 'h-7 w-7' : 'h-10 w-10'} /></Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link to={`/channel/${item.user.id}`} className={item.isVideoOwner ? 'rounded-full bg-surface-600 px-2 py-0.5 font-semibold' : 'font-semibold'}>
            {item.user.name}
          </Link>
          <span className="text-slate-500">{timeAgo(item.createdAt)}{item.edited && ' (đã sửa)'}</span>
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="input" rows={2} maxLength={2000} />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Huỷ</button>
              <button type="button" className="btn-primary" onClick={save} disabled={!draft.trim()}>Lưu</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.content}</p>
        )}
        <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
          {!isReply && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setReplying(true)}>Phản hồi</button>}
          {item.canEdit && !editing && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)} aria-label="Sửa"><Pencil className="h-3.5 w-3.5" /></button>}
          {item.canDelete && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={remove} aria-label="Xoá"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        {replying && (
          <div className="mt-2">
            <CommentForm
              videoId={videoId}
              parentId={item.id}
              autoFocus
              placeholder="Viết phản hồi..."
              onCancel={() => setReplying(false)}
              onCreated={(c) => {
                setReplying(false);
                setReplies((r) => [...(r || []), c]);
                setShowReplies(true);
                setItem((it) => ({ ...it, replyCount: it.replyCount + 1 }));
                onReplyAdded();
              }}
            />
          </div>
        )}
        {!isReply && item.replyCount > 0 && (
          <button type="button" onClick={loadReplies} className="mt-1 flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-sky-400 hover:bg-sky-400/10">
            <ChevronDown className={showReplies ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} /> {number(item.replyCount)} phản hồi
          </button>
        )}
        {showReplies && (
          <div className="mt-3 space-y-4">
            {loadingReplies && <Spinner className="h-5 w-5" />}
            {replies?.map((r) => (
              <CommentItem key={r.id} comment={r} videoId={videoId} isReply onReplyAdded={() => {}}
                onDeleted={(id, n) => {
                  setReplies((list) => list.filter((x) => x.id !== id));
                  setItem((it) => ({ ...it, replyCount: Math.max(0, it.replyCount - 1) }));
                  onDeleted(null, n);
                }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Comments({ videoId, initialCount = 0 }) {
  const [sort, setSort] = useState('newest');
  const [count, setCount] = useState(initialCount);
  const { items, setItems, loading, error, hasMore, loadMore } = usePaged(
    (page) => get('/comments', { videoId, page, sort }), [videoId, sort],
  );

  return (
    <section className="mt-6">
      <div className="mb-4 flex items-center gap-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquare className="h-5 w-5" /> {number(count)} bình luận</h2>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg bg-surface-800 px-2 py-1 text-sm">
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
        </select>
      </div>
      <CommentForm videoId={videoId} onCreated={(c) => { setItems((list) => [c, ...list]); setCount((n) => n + 1); }} />
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      <div className="mt-6 space-y-6">
        {items.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            videoId={videoId}
            onReplyAdded={() => setCount((n) => n + 1)}
            onDeleted={(id, n) => {
              if (id) setItems((list) => list.filter((x) => x.id !== id));
              setCount((x) => Math.max(0, x - n));
            }}
          />
        ))}
      </div>
      {!loading && !items.length && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><CornerDownRight className="h-4 w-4" /> Chưa có bình luận nào. Hãy là người đầu tiên!</p>
      )}
      <LoadMore hasMore={hasMore} loading={loading} onClick={loadMore} />
    </section>
  );
}
