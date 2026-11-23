import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryTableResult } from './arrowFormat';

export interface TablePageNav {
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  cacheHit: boolean;
  onChangePage: (nextPage: number) => void;
}

interface DataGridProps {
  title: string;
  result: QueryTableResult | null;
  error?: string | null;
  pageNav?: TablePageNav | null;
}

export function DataGrid({ title, result, error, pageNav }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowCount = result?.rows.length ?? 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 14,
    initialRect: { width: 900, height: 400 },
  });

  if (error) {
    return (
      <section className="wb-grid-card" aria-label="Query error output">
        <div className="wb-grid-toolbar">
          <strong>{title}</strong>
          <span className="wb-tag wb-tag-err">SQL Error</span>
        </div>
        <pre className="wb-error-box">{error}</pre>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="wb-grid-card wb-grid-empty" aria-label="Empty data grid">
        <div>
          <strong>No active result set</strong>
          <p>
            Open a local CSV / Parquet / JSON file or click <strong>Load Messy Demo</strong> to
            query inside DuckDB-WASM.
          </p>
        </div>
      </section>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1]!.end : 0;

  const baseOffset = pageNav ? pageNav.pageIndex * pageNav.pageSize : 0;
  const pageCount = pageNav ? Math.max(1, Math.ceil(pageNav.totalRows / pageNav.pageSize)) : 1;

  return (
    <section className="wb-grid-card" aria-label="Interactive Data Grid">
      <div className="wb-grid-toolbar">
        <div className="wb-grid-title">
          <strong>{title}</strong>
          <span className="wb-grid-meta">
            {result.rows.length.toLocaleString('en-US')} row(s) virtualized
            {pageNav ? ` of ${pageNav.totalRows.toLocaleString('en-US')}` : ''} ·{' '}
            {result.columns.length} cols · {result.elapsedMs.toFixed(1)} ms
            {result.truncated ? ' (capped)' : ''}
          </span>
          {pageNav ? (
            <span className={pageNav.cacheHit ? 'wb-tag wb-tag-ok' : 'wb-tag'}>
              500-row Arrow page {pageNav.cacheHit ? 'CACHE HIT' : 'LOADED'}
            </span>
          ) : null}
        </div>

        {pageNav ? (
          <div className="wb-grid-pager">
            <button
              type="button"
              className="wb-btn-mini"
              disabled={pageNav.pageIndex <= 0}
              onClick={() => pageNav.onChangePage(pageNav.pageIndex - 1)}
            >
              Prev 500
            </button>
            <span className="wb-page-num">
              Page {pageNav.pageIndex + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="wb-btn-mini"
              disabled={pageNav.pageIndex >= pageCount - 1}
              onClick={() => pageNav.onChangePage(pageNav.pageIndex + 1)}
            >
              Next 500
            </button>
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="wb-table-scroll">
        <table className="wb-data-table">
          <thead>
            <tr>
              <th className="wb-row-idx">#</th>
              {result.columns.map((col) => (
                <th key={col.name}>
                  <span className="wb-th-name">{col.name}</span>
                  <span className="wb-th-type">{col.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={result.columns.length + 1}
                  style={{ height: `${paddingTop}px`, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}

            {virtualItems.map((vRow) => {
              const row = result.rows[vRow.index];
              if (!row) return null;
              return (
                <tr key={vRow.key} data-index={vRow.index}>
                  <td className="wb-row-idx">{baseOffset + vRow.index + 1}</td>
                  {row.map((cell, colIdx) => (
                    <td key={colIdx} className={cell === 'NULL' ? 'wb-null-cell' : undefined}>
                      {cell === 'NULL' ? <span className="wb-null-pill">NULL</span> : cell}
                    </td>
                  ))}
                </tr>
              );
            })}

            {paddingBottom > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={result.columns.length + 1}
                  style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
