import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  /** CSS color expression, e.g. 'var(--red)'. */
  color: string;
}

const R = 56;
const STROKE = 22;
const SIZE = 140;
const C = SIZE / 2;
const CIRC = 2 * Math.PI * R;
const nf = new Intl.NumberFormat('en-US');

export function Donut({ segments }: { segments: DonutSegment[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ seg: DonutSegment; x: number; y: number } | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = total > 0 ? segments.filter((s) => s.value > 0) : [];
  // 2px surface gap between arcs, expressed in pathLength units (100 = full circle).
  const gap = visible.length > 1 ? (2 / CIRC) * 100 : 0;

  let cursor = 0;
  const arcs = visible.map((seg) => {
    const frac = (seg.value / total) * 100;
    const arc = { seg, len: Math.max(frac - gap, 0.4), offset: cursor + gap / 2 };
    cursor += frac;
    return arc;
  });

  function onMove(seg: DonutSegment) {
    return (e: ReactPointerEvent<SVGCircleElement>) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({ seg, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
  }

  return (
    <div ref={wrapRef} className="relative flex min-w-0 items-center gap-6">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Priority mix: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
        className="shrink-0"
      >
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
        <g transform={`rotate(-90 ${C} ${C})`}>
          {arcs.map(({ seg, len, offset }) => (
            <circle
              key={seg.key}
              cx={C}
              cy={C}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE}
              pathLength={100}
              strokeDasharray={`${len} ${100 - len}`}
              strokeDashoffset={-offset}
              className={
                hover !== null && hover.seg.key !== seg.key
                  ? 'opacity-50 transition-opacity'
                  : 'transition-opacity'
              }
              onPointerMove={onMove(seg)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </g>
        <text
          x={C}
          y={C}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={20}
          fontWeight={600}
          fill="var(--text)"
        >
          {nf.format(total)}
        </text>
      </svg>
      <ul className="flex min-w-0 flex-col gap-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="w-16 text-[13px] text-text-2">{s.label}</span>
            <span className="text-[13px] font-medium tabular-nums text-text">{nf.format(s.value)}</span>
          </li>
        ))}
      </ul>
      {hover !== null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-sm border border-line bg-surface px-2.5 py-1.5 shadow-2"
          style={{
            left: hover.x + 12,
            top: hover.y,
            transform: hover.y < 56 ? 'translateY(8px)' : 'translateY(calc(-100% - 8px))',
          }}
        >
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[13px] font-semibold tabular-nums text-text">{nf.format(hover.seg.value)}</span>
            <span className="text-[12px] text-text-3">
              {hover.seg.label.toLowerCase()} · {total > 0 ? Math.round((hover.seg.value / total) * 100) : 0}%
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
