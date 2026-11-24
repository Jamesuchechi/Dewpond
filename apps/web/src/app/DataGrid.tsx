import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryTableResult } from './arrowFormat';

export interface TablePageNav {
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  cacheHit: boolean;
  keyset?: boolean;
  onChangePage: (nextPage: number) => void;
}

interface DataGridProps {
  title: string;
  result: QueryTableResult | null;
  error?: string | null;
  pageNav?: TablePageNav | null;
  editable?: boolean;
  onEditCell?: (rid: string, column: string, nextValue: string | null) => void;
  onInsertRowAfter?: (afterOrd: number, afterRid: string) => void;
  onDeleteRow?: (rid: string) => void;
}

export function DataGrid({
  title,
  result,
  error,
  pageNav,
  editable = false,
  onEditCell,
  onInsertRowAfter,
  onDeleteRow,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    colName: string;
    draft: string;
  } | null>(null);
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
              {pageNav.keyset ? 'Keyset' : '500-row'} Arrow page{' '}
              {pageNav.cacheHit ? 'CACHE HIT' : 'LOADED'}
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
              const ridColIdx = result.columns.findIndex((c) => c.name === '__rid');
              const ordColIdx = result.columns.findIndex((c) => c.name === '__ord');
              const ridVal = ridColIdx >= 0 ? (row[ridColIdx] ?? null) : null;
              const ordVal = ordColIdx >= 0 ? Number(row[ordColIdx]) : Number(ridVal);
              const canEditRow = editable && ridVal !== null && ridVal !== 'NULL';

              return (
                <tr key={vRow.key} data-index={vRow.index}>
                  <td className="wb-row-idx">
                    <span>{baseOffset + vRow.index + 1}</span>
                    {canEditRow && onInsertRowAfter && onDeleteRow ? (
                      <span className="wb-row-ops">
                        <button
                          type="button"
                          className="wb-row-op-btn"
                          title="Insert row below (fractional ord)"
                          aria-label={`Insert row after ${ridVal}`}
                          onClick={() =>
                            onInsertRowAfter(
                              Number.isFinite(ordVal) ? ordVal : baseOffset + vRow.index + 1,
                              ridVal,
                            )
                          }
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="wb-row-op-btn"
                          title="Delete row"
                          aria-label={`Delete row ${ridVal}`}
                          onClick={() => onDeleteRow(ridVal)}
                        >
                          ×
                        </button>
                      </span>
                    ) : null}
                  </td>
                  {row.map((cell, colIdx) => {
                    const col = result.columns[colIdx]!;
                    const isSystemCol = col.name === '__rid' || col.name === '__ord';
                    const isEditing =
                      editingCell?.rowIdx === vRow.index && editingCell.colName === col.name;

                    if (isEditing) {
                      return (
                        <td key={colIdx} className="wb-editing-cell">
                          <input
                            type="text"
                            autoFocus
                            aria-label={`Edit cell ${col.name}`}
                            className="wb-cell-input"
                            value={editingCell.draft}
                            onChange={(e) =>
                              setEditingCell({ ...editingCell, draft: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const nextVal = editingCell.draft === '' ? null : editingCell.draft;
                                setEditingCell(null);
                                if (ridVal) onEditCell?.(ridVal, col.name, nextVal);
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                              }
                            }}
                            onBlur={() => {
                              const nextVal = editingCell.draft === '' ? null : editingCell.draft;
                              setEditingCell(null);
                              if (ridVal) onEditCell?.(ridVal, col.name, nextVal);
                            }}
                          />
                        </td>
                      );
                    }

                    return (
                      <td
                        key={colIdx}
                        className={cell === 'NULL' ? 'wb-null-cell' : undefined}
                        title={canEditRow && !isSystemCol ? 'Double-click to edit cell' : undefined}
                        onDoubleClick={() => {
                          if (!canEditRow || isSystemCol || !onEditCell) return;
                          setEditingCell({
                            rowIdx: vRow.index,
                            colName: col.name,
                            draft: cell === 'NULL' || cell === null ? '' : cell,
                          });
                        }}
                      >
                        {cell === 'NULL' ? <span className="wb-null-pill">NULL</span> : cell}
                      </td>
                    );
                  })}
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
