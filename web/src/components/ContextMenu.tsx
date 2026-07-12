import { useEffect, type ReactNode } from 'react';
import { cx } from './util';

export type ContextMenuItem =
  | { separator: true }
  | { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void };

/**
 * A right-click menu anchored at a viewport point. Render it conditionally with
 * a coordinate and a list of items; it closes on outside-click, Escape, or after
 * an item runs. Clamped so it never spills past the viewport edge.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const estHeight = items.reduce((h, it) => h + ('separator' in it ? 9 : 30), 8);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, Math.max(8, window.innerHeight - estHeight - 8));

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        className="fixed z-50 min-w-[188px] rounded-md border border-line bg-surface py-1 shadow-1"
        style={{ left, top }}
      >
        {items.map((item, i) =>
          'separator' in item ? (
            <div key={i} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cx(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50',
                item.danger ? 'text-red hover:bg-red-bg' : 'text-text-2 hover:bg-surface-2 hover:text-text',
              )}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ),
        )}
      </div>
    </>
  );
}
