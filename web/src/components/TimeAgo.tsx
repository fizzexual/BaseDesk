import { useEffect, useState } from 'react';
import { cx } from './util';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  if (diffSec < 7 * 86400) return date.toLocaleDateString('en-US', { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const date = new Date(iso);
  return (
    <time
      dateTime={iso}
      title={date.toLocaleString()}
      className={cx('tabular-nums whitespace-nowrap text-[13px] text-text-3', className)}
    >
      {formatTimeAgo(iso)}
    </time>
  );
}
