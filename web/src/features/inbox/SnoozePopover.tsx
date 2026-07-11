import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconSnooze } from '../../icons';

interface SnoozePreset {
  label: string;
  detail: string;
  toastLabel: string;
  date: Date;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const later = new Date(now.getTime() + 4 * 3_600_000);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    {
      label: 'Later today',
      detail: formatClock(later),
      toastLabel: `later today (${formatClock(later)})`,
      date: later,
    },
    { label: 'Tomorrow', detail: '09:00', toastLabel: 'tomorrow 09:00', date: tomorrow },
    { label: 'Next Monday', detail: '09:00', toastLabel: 'Monday 09:00', date: monday },
  ];
}

const WIDTH = 240;

/** Fixed-position snooze preset picker anchored near a ticket row. */
export function SnoozePopover({
  anchor,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  onPick: (date: Date, toastLabel: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const presets = useMemo(() => snoozePresets(), []);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    function onPointerDown(e: PointerEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        onCloseRef.current();
      }
    }
    function onScroll() {
      onCloseRef.current();
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []);
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'ArrowDown'
          ? (idx + 1) % buttons.length
          : idx < 0
            ? buttons.length - 1
            : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
      return;
    }
    // Keep Enter from reaching the inbox shortcut layer; the focused
    // button's native activation still fires.
    if (e.key === 'Enter') e.stopPropagation();
  }

  const left = Math.max(16, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 16));
  const top = Math.min(anchor.bottom - 6, window.innerHeight - 176);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Snooze until"
      onKeyDown={onKeyDown}
      className="fixed z-50 rounded-md border border-line bg-surface p-1 shadow-2"
      style={{ top, left, width: WIDTH }}
    >
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-text-3">
        <IconSnooze size={13} className="shrink-0" />
        Snooze until
      </div>
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] outline-none hover:bg-surface-2 focus:bg-surface-2"
          onClick={() => onPick(p.date, p.toastLabel)}
        >
          <span className="min-w-0 flex-1 truncate">{p.label}</span>
          <span className="tabular-nums shrink-0 text-[12px] text-text-3">{p.detail}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
