import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

/** Hook gọi API đơn giản: { data, error, loading, reload, setData }. */
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (id === seq.current) setState((s) => ({ ...s, error: errorMessage(err), status: err?.response?.status, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  return { ...state, reload: load, setData };
}

/** Danh sách phân trang kiểu "Tải thêm". fetchPage(page) phải trả về { items, pagination }. */
export function usePaged(fetchPage, deps = []) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (p) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage(p);
      if (id !== seq.current) return;
      setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
      setHasMore(res.pagination ? res.pagination.page < res.pagination.totalPages : false);
      setPage(p);
    } catch (err) {
      if (id === seq.current) setError(errorMessage(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load(1);
  }, [load]);

  return { items, setItems, loading, error, hasMore, loadMore: () => load(page + 1), reload: () => load(1) };
}
