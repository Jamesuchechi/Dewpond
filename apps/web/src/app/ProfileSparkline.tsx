import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

interface ProfileSparklineProps {
  values: number[];
  label: string;
}

export function ProfileSparkline({ values, label }: ProfileSparklineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const seriesKey = JSON.stringify(values);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';

    const parsed = JSON.parse(seriesKey) as number[];
    const pts = parsed.length >= 2 ? parsed : [0, parsed[0] ?? 0];
    const x = pts.map((_, idx) => idx);

    const chart = new uPlot(
      {
        width: 132,
        height: 28,
        cursor: { show: false },
        legend: { show: false },
        padding: [2, 2, 2, 2],
        scales: {
          x: { time: false },
          y: { auto: true },
        },
        axes: [{ show: false }, { show: false }],
        series: [
          {},
          {
            stroke: '#1d4ed8',
            fill: 'rgba(29, 78, 216, 0.16)',
            width: 1.75,
            points: { show: false },
          },
        ],
      },
      [x, pts],
      host,
    );

    return () => {
      chart.destroy();
    };
  }, [seriesKey]);

  return (
    <div
      ref={hostRef}
      className="wb-uplot-spark"
      role="img"
      aria-label={`Distribution sparkline for ${label}`}
    />
  );
}
