import { useEffect, useState } from 'react';
import type { Announcement } from '../data/types';
import { portalApi } from './api';
import { IconX } from '../icons';

const LEVEL_COLOR: Record<Announcement['level'], string> = {
  info: 'var(--blue)',
  warning: 'var(--amber)',
  critical: 'var(--red)',
};
const DISMISS_KEY = 'bd-portal-ann-dismissed';

function readDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as string[]) : [];
  } catch {
    return [];
  }
}

/** Active broadcast announcements, shown as dismissible banners at the top of the portal. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [hidden, setHidden] = useState<string[]>(readDismissed);

  useEffect(() => {
    let cancelled = false;
    portalApi.announcements().then(
      (list) => !cancelled && setItems(list),
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = items.filter((a) => !hidden.includes(a.id));
  if (shown.length === 0) return null;

  function dismiss(id: string) {
    const next = [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="shrink-0">
      {shown.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2.5 border-b px-4 py-2 sm:px-6"
          style={{ borderColor: `color-mix(in oklab, ${LEVEL_COLOR[a.level]} 30%, var(--line))`, background: `color-mix(in oklab, ${LEVEL_COLOR[a.level]} 10%, transparent)` }}
        >
          <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[a.level] }} />
          <p className="min-w-0 flex-1 text-[13px] text-text">{a.body}</p>
          <button type="button" onClick={() => dismiss(a.id)} aria-label="Dismiss announcement" className="shrink-0 rounded-sm p-0.5 text-text-3 transition-colors hover:text-text">
            <IconX size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
