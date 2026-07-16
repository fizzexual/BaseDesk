import { useEffect, useState } from 'react';
import type { OutsideHours } from '../../data/types';
import { formatDuration } from '../../data/supportTime';
import { IconClock } from '../../icons';

/** Renders the automatic "we're outside working hours" embed with a live
 *  countdown to reopening, shown in the viewer's own local time. Shared by the
 *  agent conversation and the customer portal. */
export function OutsideHoursCard({ e }: { e: OutsideHours }) {
  const openMs = e.nextOpenAt !== null ? Date.parse(e.nextOpenAt) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const remaining = openMs !== null ? openMs - nowMs : null;
  const reopened = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (openMs === null || reopened) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [openMs, reopened]);

  const openLocal =
    openMs !== null
      ? new Date(openMs).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : null;

  return (
    <div className="w-full max-w-[32rem] rounded-xl border border-line bg-surface-2 p-3.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
        <IconClock size={15} className="shrink-0 text-amber" />
        Outside working hours
      </div>
      <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-text-2">{e.message}</p>
      {remaining !== null && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface px-3 py-2 text-[13px]">
          {reopened ? (
            <span className="font-medium" style={{ color: 'var(--green)' }}>We’re back online — thanks for your patience.</span>
          ) : (
            <>
              <span className="text-text-3">We reopen in</span>
              <span className="font-semibold tabular-nums text-text">{formatDuration(remaining)}</span>
              {openLocal !== null && <span className="text-text-3">· {openLocal} your time</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
