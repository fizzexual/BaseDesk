import type { ReactNode } from 'react';

export interface HBarRow {
  key: string;
  /** Plain text or a richer node (e.g. avatar + name). */
  label: ReactNode;
  count: number;
  /** CSS color expression, e.g. 'var(--blue)'. */
  color: string;
}

const nf = new Intl.NumberFormat('en-US');

export function HBars({ rows, labelWidth = 'w-20' }: { rows: HBarRow[]; labelWidth?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className={`shrink-0 truncate text-[13px] text-text-2 ${labelWidth}`}>{r.label}</div>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(r.count / max) * 100}%`, background: r.color }}
            />
          </div>
          <div className="w-10 shrink-0 text-right text-[13px] font-medium tabular-nums text-text">
            {nf.format(r.count)}
          </div>
        </div>
      ))}
    </div>
  );
}
