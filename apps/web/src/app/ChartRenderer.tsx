import { useRef, useState } from 'react';
import type { ChartType } from './sqlCompiler';

export interface ChartCategoryPoint {
  label: string;
  value: number;
  series?: string;
  binMin?: number;
  binMax?: number;
}

export interface ChartBoxPoint {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  count: number;
}

export interface ChartScatterPoint {
  x: number;
  y: number;
}

export interface ChartRendererProps {
  chartType: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  categoryData: readonly ChartCategoryPoint[];
  scatterData: readonly ChartScatterPoint[];
  boxData?: readonly ChartBoxPoint[];
  onSelectCategory?: (point: ChartCategoryPoint) => void;
  onPinReport?: (title: string, svgMarkup: string) => void;
}

const SERIES_PALETTE = ['#1d4ed8', '#059669', '#d97706', '#7c3aed', '#0284c7', '#dc2626'];

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChartRenderer({
  chartType,
  title,
  xLabel,
  yLabel,
  categoryData,
  scatterData,
  boxData = [],
  onSelectCategory,
  onPinReport,
}: ChartRendererProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ text: string; x: number; y: number } | null>(null);

  const width = 1040;
  const height = 420;
  const pad = { top: 24, right: 24, bottom: 56, left: 68 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  function serializeSvg(): string | null {
    if (!svgRef.current) return null;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    return xml;
  }

  function handleExportSvg(): void {
    const xml = serializeSvg();
    if (!xml) return;
    triggerDownload(
      `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'chart'}.svg`,
      new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
    );
  }

  function handleExportPng(): void {
    const xml = serializeSvg();
    if (!xml) return;
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            triggerDownload(
              `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'chart'}.png`,
              pngBlob,
            );
          }
        }, 'image/png');
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  const isEmpty =
    chartType === 'scatter'
      ? scatterData.length === 0
      : chartType === 'box'
        ? boxData.length === 0
        : categoryData.length === 0;

  if (isEmpty) {
    return (
      <div className="wb-chart-empty">
        <p>No numeric/grouped data to plot for the current selection.</p>
      </div>
    );
  }

  // Compute scales
  const values = categoryData.map((d) => d.value);
  const rawMaxY =
    chartType === 'scatter'
      ? Math.max(...scatterData.map((p) => p.y))
      : chartType === 'box'
        ? Math.max(...boxData.map((b) => b.max))
        : Math.max(0, ...values);
  const rawMinY =
    chartType === 'scatter'
      ? Math.min(...scatterData.map((p) => p.y))
      : chartType === 'box'
        ? Math.min(...boxData.map((b) => b.min))
        : Math.min(0, ...values);
  const spanY = Math.max(1e-9, rawMaxY - rawMinY);
  const maxY = rawMaxY + spanY * 0.08;
  const minY = chartType === 'scatter' || chartType === 'box' ? rawMinY - spanY * 0.08 : rawMinY;
  const yScale = (v: number) =>
    pad.top + plotH - ((v - minY) / Math.max(1e-9, maxY - minY)) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minY + t * (maxY - minY));
  const seriesNames = Array.from(
    new Set(categoryData.map((d) => d.series).filter((s): s is string => Boolean(s))),
  );

  const renderSeries = () => {
    if (chartType === 'scatter') {
      const xs = scatterData.map((p) => p.x);
      const rawMinX = Math.min(...xs);
      const rawMaxX = Math.max(...xs);
      const spanX = Math.max(1e-9, rawMaxX - rawMinX);
      const minX = rawMinX - spanX * 0.05;
      const maxX = rawMaxX + spanX * 0.05;
      const xScale = (x: number) => pad.left + ((x - minX) / Math.max(1e-9, maxX - minX)) * plotW;

      return (
        <>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const xv = minX + t * (maxX - minX);
            const px = xScale(xv);
            return (
              <text key={t} x={px} y={height - 24} textAnchor="middle" fontSize="10" fill="#64748b">
                {formatNum(xv)}
              </text>
            );
          })}
          {scatterData.map((pt, i) => {
            const cx = xScale(pt.x);
            const cy = yScale(pt.y);
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={3.5}
                fill="#1d4ed8"
                fillOpacity={0.68}
                stroke="#ffffff"
                strokeWidth={0.8}
                onMouseEnter={() =>
                  setHoverInfo({
                    text: `${xLabel}: ${formatNum(pt.x)} · ${yLabel}: ${formatNum(pt.y)}`,
                    x: cx,
                    y: cy,
                  })
                }
                onMouseLeave={() => setHoverInfo(null)}
              />
            );
          })}
        </>
      );
    }

    if (chartType === 'line') {
      const n = categoryData.length;
      const xStep = n > 1 ? plotW / (n - 1) : plotW / 2;
      const pts = categoryData.map((d, i) => ({
        x: pad.left + (n > 1 ? i * xStep : plotW / 2),
        y: yScale(d.value),
        d,
      }));
      const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const areaPath =
        pts.length > 0
          ? `${linePath} L ${pts[pts.length - 1]!.x} ${yScale(minY)} L ${pts[0]!.x} ${yScale(minY)} Z`
          : '';
      const labelStep = Math.max(1, Math.ceil(n / 8));

      return (
        <>
          {areaPath ? <path d={areaPath} fill="#1d4ed8" fillOpacity={0.1} /> : null}
          {linePath ? <path d={linePath} fill="none" stroke="#1d4ed8" strokeWidth={2.25} /> : null}
          {pts.map((p, i) => (
            <g key={`${p.d.label}-${i}`}>
              {i % labelStep === 0 ? (
                <text x={p.x} y={height - 24} textAnchor="middle" fontSize="10" fill="#64748b">
                  {p.d.label.slice(0, 12)}
                </text>
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={4}
                fill="#1d4ed8"
                stroke="#ffffff"
                strokeWidth={1.5}
                style={{ cursor: onSelectCategory ? 'pointer' : 'default' }}
                onClick={() => onSelectCategory?.(p.d)}
                onMouseEnter={() =>
                  setHoverInfo({
                    text: `${p.d.label}: ${formatNum(p.d.value)}`,
                    x: p.x,
                    y: p.y,
                  })
                }
                onMouseLeave={() => setHoverInfo(null)}
              />
            </g>
          ))}
        </>
      );
    }

    if (chartType === 'box') {
      const n = boxData.length;
      const slotW = plotW / Math.max(1, n);
      const boxW = Math.max(10, Math.min(44, slotW * 0.56));
      const labelStep = Math.max(1, Math.ceil(n / 10));

      return boxData.map((b, i) => {
        const cx = pad.left + i * slotW + slotW / 2;
        const yMin = yScale(b.min);
        const yQ1 = yScale(b.q1);
        const yMed = yScale(b.median);
        const yQ3 = yScale(b.q3);
        const yMax = yScale(b.max);
        const topBox = Math.min(yQ1, yQ3);
        const boxH = Math.max(2, Math.abs(yQ1 - yQ3));
        return (
          <g key={`${b.label}-${i}`}>
            <line x1={cx} x2={cx} y1={yMax} y2={yMin} stroke="#64748b" strokeWidth={1.5} />
            <line
              x1={cx - boxW * 0.35}
              x2={cx + boxW * 0.35}
              y1={yMax}
              y2={yMax}
              stroke="#64748b"
              strokeWidth={1.5}
            />
            <line
              x1={cx - boxW * 0.35}
              x2={cx + boxW * 0.35}
              y1={yMin}
              y2={yMin}
              stroke="#64748b"
              strokeWidth={1.5}
            />
            <rect
              x={cx - boxW / 2}
              y={topBox}
              width={boxW}
              height={boxH}
              rx={3}
              fill="#1d4ed8"
              fillOpacity={0.22}
              stroke="#1d4ed8"
              strokeWidth={1.5}
              style={{ cursor: onSelectCategory ? 'pointer' : 'default' }}
              onClick={() => onSelectCategory?.({ label: b.label, value: b.median })}
              onMouseEnter={() =>
                setHoverInfo({
                  text: `${b.label} med:${formatNum(b.median)} [${formatNum(b.min)}..${formatNum(b.max)}]`,
                  x: cx,
                  y: yMax,
                })
              }
              onMouseLeave={() => setHoverInfo(null)}
            />
            <line
              x1={cx - boxW / 2}
              x2={cx + boxW / 2}
              y1={yMed}
              y2={yMed}
              stroke="#0a1628"
              strokeWidth={2}
            />
            {i % labelStep === 0 ? (
              <text x={cx} y={height - 24} textAnchor="middle" fontSize="10" fill="#64748b">
                {b.label.length > 12 ? `${b.label.slice(0, 11)}…` : b.label}
              </text>
            ) : null}
          </g>
        );
      });
    }

    // Bar or Histogram
    const n = categoryData.length;
    const slotW = plotW / Math.max(1, n);
    const barW = chartType === 'histogram' ? Math.max(4, slotW - 2) : Math.max(6, slotW * 0.68);
    const baseZero = yScale(0);
    const labelStep = Math.max(1, Math.ceil(n / 10));

    return categoryData.map((d, i) => {
      const cx = pad.left + i * slotW + slotW / 2;
      const x = cx - barW / 2;
      const yVal = yScale(d.value);
      const yTop = Math.min(yVal, baseZero);
      const barH = Math.max(2, Math.abs(baseZero - yVal));
      const seriesIdx = d.series ? Math.max(0, seriesNames.indexOf(d.series)) : 0;
      const fill =
        chartType === 'histogram'
          ? '#059669'
          : (SERIES_PALETTE[seriesIdx % SERIES_PALETTE.length] ?? '#1d4ed8');
      return (
        <g key={`${d.label}-${d.series ?? ''}-${i}`}>
          <rect
            x={x}
            y={yTop}
            width={barW}
            height={barH}
            rx={chartType === 'histogram' ? 2 : 4}
            fill={fill}
            fillOpacity={0.88}
            style={{ cursor: onSelectCategory ? 'pointer' : 'default' }}
            onClick={() => onSelectCategory?.(d)}
            onMouseEnter={() =>
              setHoverInfo({
                text: `${d.label}${d.series ? ` (${d.series})` : ''}: ${formatNum(d.value)}`,
                x: cx,
                y: yTop,
              })
            }
            onMouseLeave={() => setHoverInfo(null)}
          />
          {i % labelStep === 0 ? (
            <text x={cx} y={height - 24} textAnchor="middle" fontSize="10" fill="#64748b">
              {d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label}
            </text>
          ) : null}
        </g>
      );
    });
  };

  return (
    <div className="wb-chart-box">
      <div className="wb-chart-toolbar">
        <div>
          <strong>{title}</strong>
          {onSelectCategory && chartType !== 'scatter' ? (
            <span className="wb-chart-hint">Click any bar/point to filter in Clean</span>
          ) : null}
        </div>
        <div className="wb-chart-actions">
          {onPinReport ? (
            <button
              type="button"
              className="wb-btn-mini"
              onClick={() => {
                const xml = serializeSvg();
                if (xml) onPinReport(title, xml);
              }}
            >
              Pin to HTML Report
            </button>
          ) : null}
          <button type="button" className="wb-btn-mini" onClick={handleExportSvg}>
            Export SVG
          </button>
          <button type="button" className="wb-btn-mini" onClick={handleExportPng}>
            Export PNG
          </button>
        </div>
      </div>

      {seriesNames.length > 0 ? (
        <div className="wb-chart-legend" aria-label="Series legend">
          {seriesNames.slice(0, 12).map((name, idx) => (
            <span key={name} className="wb-chart-legend-item">
              <span
                className="wb-chart-legend-dot"
                style={{ background: SERIES_PALETTE[idx % SERIES_PALETTE.length] }}
              />
              {name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="wb-chart-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="wb-chart-svg"
          role="img"
          aria-label={title}
        >
          <rect x={0} y={0} width={width} height={height} fill="#ffffff" rx={8} />
          {yTicks.map((tick, idx) => {
            const py = yScale(tick);
            return (
              <g key={idx}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={py}
                  y2={py}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                />
                <text x={pad.left - 8} y={py + 3} textAnchor="end" fontSize="10" fill="#64748b">
                  {formatNum(tick)}
                </text>
              </g>
            );
          })}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            stroke="#cbd5e1"
          />
          <line
            x1={pad.left}
            x2={pad.left}
            y1={pad.top}
            y2={height - pad.bottom}
            stroke="#cbd5e1"
          />
          {renderSeries()}
          <text
            x={pad.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#334155"
          >
            {xLabel}
          </text>
          <text
            x={16}
            y={pad.top + plotH / 2}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#334155"
            transform={`rotate(-90 16 ${pad.top + plotH / 2})`}
          >
            {yLabel}
          </text>
          {hoverInfo ? (
            <g pointerEvents="none">
              <rect
                x={Math.min(width - 230, Math.max(pad.left, hoverInfo.x - 105))}
                y={Math.max(4, hoverInfo.y - 30)}
                width={210}
                height={22}
                rx={5}
                fill="#0a1628"
              />
              <text
                x={Math.min(width - 125, Math.max(pad.left + 105, hoverInfo.x))}
                y={Math.max(19, hoverInfo.y - 15)}
                textAnchor="middle"
                fontSize="10.5"
                fill="#ffffff"
              >
                {hoverInfo.text.slice(0, 38)}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
