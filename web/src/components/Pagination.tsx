import { useEffect, useId, useState } from 'react';
import type { LibraryPageSize } from '../types';
import type { LibraryQueryState } from '../hooks/useLibraryQuery';

export function Pagination({ query, position }: { query: LibraryQueryState; position: 'top' | 'bottom' }) {
  const id = useId();
  const { preferences, result, loading, allStatus, change } = query;
  const { page, pageSize } = preferences;
  const [jump, setJump] = useState(String(page));
  const [jumpError, setJumpError] = useState('');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(String(pageSize === 'all' ? 20 : pageSize));
  const [sizeError, setSizeError] = useState('');
  const totalPages = pageSize === 'all' ? 1 : result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;
  useEffect(() => { setJump(String(page)); setJumpError(''); }, [page]);
  useEffect(() => { setCustom(false); setSizeError(''); }, [pageSize]);
  const applySize = () => {
    const value = Number(draft);
    if (!/^\d+$/.test(draft.trim()) || !Number.isInteger(value) || value < 1 || value > 500) { setSizeError('请输入 1–500 的整数。'); return; }
    change({ pageSize: value }); setCustom(false); setSizeError('');
  };
  const applyJump = () => {
    const value = Number(jump);
    if (!/^\d+$/.test(jump.trim()) || !Number.isSafeInteger(value) || value < 1 || value > totalPages) { setJumpError(`请输入 1–${totalPages} 的页码。`); return; }
    change({ page: value }); setJumpError('');
  };
  const all = pageSize === 'all';
  const sizeValue = custom ? 'custom' : String(pageSize);
  const range = all && allStatus !== 'complete'
    ? `已加载 ${result?.games.length ?? 0} / 共 ${result?.total ?? '—'} 条（${allStatus === 'loading' ? '加载中' : allStatus === 'cancelled' ? '已取消，未完成' : '未完成'}）`
    : result ? `${result.rangeStart}–${result.rangeEnd} / 共 ${result.total} 条` : '0–0 / 共 — 条';
  return <nav className="pagination" aria-label={position === 'top' ? '顶部分页' : '底部分页'} aria-busy={loading}>
    <div className="pagination-summary"><span className="pagination-range" role={position === 'top' ? 'status' : undefined}>{range}</span><div className="pagination-size"><label htmlFor={`${id}-size`}>每页</label><select id={`${id}-size`} value={sizeValue} onChange={(event) => {
      const value = event.target.value;
      if (value === 'custom') { setCustom(true); setDraft(String(all ? 20 : pageSize)); setSizeError(''); }
      else { setCustom(false); change({ pageSize: value === 'all' ? 'all' : Number(value) as LibraryPageSize }); }
    }}><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option>{!all && ![20, 50, 100].includes(pageSize) && <option value={String(pageSize)}>{pageSize} 条（自定义）</option>}<option value="custom">自定义</option><option value="all">全部</option></select></div></div>
    {custom && <form className="pagination-custom" onSubmit={(event) => { event.preventDefault(); applySize(); }}><label htmlFor={`${id}-custom`}>每页条数</label><input id={`${id}-custom`} type="text" inputMode="numeric" value={draft} onChange={(event) => { setDraft(event.target.value); setSizeError(''); }} aria-describedby={`${id}-size-hint`} aria-invalid={!!sizeError}/><span id={`${id}-size-hint`}>1–500 条，整数</span><button className="button secondary" type="submit">应用</button><button className="button secondary" type="button" onClick={() => { setCustom(false); setSizeError(''); }}>取消</button>{sizeError && <p className="pagination-error" role="alert">{sizeError}</p>}</form>}
    <div className="pagination-navigation"><div className="pagination-pages"><button className="button secondary" disabled={all || page <= 1} onClick={() => change({ page: 1 })}>首页</button><button className="button secondary" disabled={all || page <= 1} onClick={() => change({ page: page - 1 })}>上一页</button><span className="pagination-page">第 {all ? 1 : page} / {totalPages} 页</span><button className="button secondary" disabled={all || page >= totalPages} onClick={() => change({ page: page + 1 })}>下一页</button><button className="button secondary" disabled={all || page >= totalPages} onClick={() => change({ page: totalPages })}>尾页</button></div>
      <form className="pagination-jump" onSubmit={(event) => { event.preventDefault(); applyJump(); }}><label htmlFor={`${id}-jump`}>跳至</label><input id={`${id}-jump`} type="text" inputMode="numeric" value={jump} onChange={(event) => { setJump(event.target.value); setJumpError(''); }} aria-label="跳至页码" aria-describedby={`${id}-jump-hint`} aria-invalid={!!jumpError} disabled={all}/><span>页</span><button className="button secondary" type="submit" disabled={all}>跳转</button><span id={`${id}-jump-hint`} className="sr-only">页码范围 1–{totalPages}</span>{jumpError && <p className="pagination-error" role="alert">{jumpError}</p>}</form>
      {all && allStatus === 'loading' && <button className="button secondary" onClick={query.cancelAll}>取消加载</button>}
      {all && ['cancelled', 'changed', 'failed'].includes(allStatus) && <button className="button secondary" onClick={query.refresh}>重新加载全部</button>}
    </div>
  </nav>;
}
