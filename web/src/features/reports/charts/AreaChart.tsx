import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface AreaPoint {
  date: string; // YYYY-MM-DD
  count: number;
}
export interface AreaSeries {
  name: string;
  /** CSS color expression, e.g. 'var(--blue)'. */
  color: string;
  points: AreaPoint[];
}

const M = { top: 10, right: 12, bottom: 24, left: 34 };
const nf = new Intl.NumberFormat('en-US');

const r2 = (v: number) => Math.round(v * 100) / 100;

function fmtDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Fritsch–Carlson monotone cubic path — smooth but never overshoots the data. */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return '';
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${r2(xs[0])},${r2(ys[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    d += `C${r2(xs[i] + h)},${r2(ys[i] + m[i] * h)} ${r2(xs[i + 1] - h)},${r2(ys[i + 1] - m[i + 1] * h)} ${r2(xs[i + 1])},${r2(ys[i + 1])}`;
  }
  return d;
}

export function AreaChart({
  series,
  height = 220,
  formatValue = (v: number) => nf.format(v),
  dashFrom,
}: {
  series: AreaSeries[];
  height?: number;
  /** Formats y-axis labels and tooltip values. Defaults to plain integers. */
  formatValue?: (v: number) => string;
  /** Draw the line dashed from this index onward (a forecast tail), with a divider. */
  dashFrom?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = series[0]?.points.length ?? 0;
  const ready = width > 0 && n >= 2;

  const plotW = Math.max(1, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const dataMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const step = Math.ceil(dataMax / 3);
  const yMax = step * 3;
  const x = (i: number) => r2(M.left + (plotW * i) / Math.max(1, n - 1));
  const y = (v: number) => r2(M.top + plotH * (1 - v / yMax));

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left - M.left) / plotW;
    setHover(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  }

  const flip = hover !== null && x(hover) > width - 130;

  return (
    <div ref={wrapRef} className="relative min-w-0" style={{ height }}>
      {ready ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={series.map((s) => `${s.name}: ${s.points.map((p) => p.count).join(', ')}`).join('. ')}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* gridlines + y labels (solid hairlines, recessive) */}
          {[1, 2, 3].map((k) => (
            <g key={k}>
              <line
                x1={M.left}
                x2={width - M.right}
                y1={y(k * step)}
                y2={y(k * step)}
                stroke="var(--line)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={M.left - 8}
                y={y(k * step)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--text-3)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatValue(k * step)}
              </text>
            </g>
          ))}
          {/* baseline */}
          <line
            x1={M.left}
            x2={width - M.right}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--line)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          {/* x labels — every 2nd day, ending on the latest */}
          {series[0].points.map((p, i) =>
            (n - 1 - i) % 2 === 0 && i > 0 ? (
              <text
                key={p.date}
                x={i === n - 1 ? width - 1 : x(i)}
                y={height - 6}
                textAnchor={i === n - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--text-3)"
              >
                {fmtDay(p.date)}
              </text>
            ) : null,
          )}
          {/* forecast divider — where actual data ends and the projection begins */}
          {dashFrom !== undefined && dashFrom > 0 && dashFrom < n - 1 ? (
            <line
              x1={x(dashFrom)}
              x2={x(dashFrom)}
              y1={M.top}
              y2={height - M.bottom}
              stroke="var(--line-2)"
              strokeWidth={1}
              strokeDasharray="2 3"
              shapeRendering="crispEdges"
            />
          ) : null}
          {/* areas + lines (solid history, dashed forecast tail when dashFrom is set) */}
          {series.map((s) => {
            const xs = s.points.map((_, i) => x(i));
            const ys = s.points.map((p) => y(p.count));
            const split = dashFrom !== undefined && dashFrom > 0 && dashFrom < n - 1;
            if (!split) {
              const line = monotonePath(xs, ys);
              const area = `${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
              return (
                <g key={s.name}>
                  <path d={area} fill={s.color} fillOpacity={0.08} stroke="none" />
                  <path d={line} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              );
            }
            const solidLine = monotonePath(xs.slice(0, dashFrom + 1), ys.slice(0, dashFrom + 1));
            const dashLine = monotonePath(xs.slice(dashFrom), ys.slice(dashFrom));
            const solidArea = `${solidLine}L${x(dashFrom)},${y(0)}L${x(0)},${y(0)}Z`;
            return (
              <g key={s.name}>
                <path d={solidArea} fill={s.color} fillOpacity={0.08} stroke="none" />
                <path d={solidLine} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d={dashLine}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.75}
                />
              </g>
            );
          })}
          {/* hover: hairline snapped to nearest day + a ringed dot per series */}
          {hover !== null ? (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={M.top}
                y2={height - M.bottom}
                stroke="var(--line-2)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {series.map((s) => (
                <circle
                  key={s.name}
                  cx={x(hover)}
                  cy={y(s.points[hover]?.count ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
        </svg>
      ) : null}
      {ready && hover !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-sm border border-line bg-surface px-2.5 py-2 shadow-2"
          style={flip ? { left: x(hover) - 10, transform: 'translateX(-100%)' } : { left: x(hover) + 10 }}
        >
          <div className="text-[12px] text-text-3">{fmtDay(series[0].points[hover].date)}</div>
          <div className="mt-1 flex flex-col gap-1">
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span aria-hidden className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="text-[13px] font-semibold tabular-nums text-text">
                  {formatValue(s.points[hover]?.count ?? 0)}
                </span>
                <span className="text-[12px] text-text-3">{s.name.toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
