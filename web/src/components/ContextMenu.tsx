import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { IconCheck } from '../icons';
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

// ---------------------------------------------------------------------------
// Global context-menu system: a single host + a `useContextMenu()` opener so any
// component can raise a custom right-click menu, plus a document-level default
// menu so *every* page has one (native menu is preserved inside text fields).
// ---------------------------------------------------------------------------

export type CtxItem =
  | { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { separator: true };

const isSep = (i: CtxItem): i is { separator: true } => 'separator' in i;

type CtxState = {
  open: boolean;
  x: number;
  y: number;
  items: CtxItem[];
  show: (x: number, y: number, items: CtxItem[]) => void;
  close: () => void;
};

const useCtx = create<CtxState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}));

/** Returns an `onContextMenu` handler that opens the custom menu with `items`. */
export function useContextMenu() {
  const show = useCtx((s) => s.show);
  return (e: ReactMouseEvent, items: CtxItem[]) => {
    if (items.length === 0) return; // nothing to show — let the native menu appear
    e.preventDefault();
    e.stopPropagation();
    show(e.clientX, e.clientY, items);
  };
}

const NATIVE_MENU_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-native-menu]';

/** Mounted once per app root: renders the active menu and installs the default one. */
export function ContextMenuHost() {
  const { open, x, y, items, show, close } = useCtx();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(-1);

  const enabled = items.map((it, i) => (!isSep(it) && !it.disabled ? i : -1)).filter((i) => i >= 0);

  // A branded default menu on any content the app didn't wire itself. We skip
  // form fields (so paste/select still work) and anything already handled.
  useEffect(() => {
    function onNative(e: MouseEvent) {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && target.closest(NATIVE_MENU_SELECTOR)) return;
      const selection = window.getSelection()?.toString().trim() ?? '';
      const link = target?.closest('a') as HTMLAnchorElement | null;
      const menu: CtxItem[] = [];
      if (selection !== '') {
        menu.push({ label: 'Copy', onSelect: () => void navigator.clipboard?.writeText(selection).catch(() => {}) });
      }
      if (link && link.href) {
        menu.push({ label: 'Copy link', onSelect: () => void navigator.clipboard?.writeText(link.href).catch(() => {}) });
        menu.push({ label: 'Open in new tab', onSelect: () => window.open(link.href, '_blank', 'noopener') });
      }
      if (menu.length > 0) menu.push({ separator: true });
      menu.push({ label: 'Back', disabled: window.history.length <= 1, onSelect: () => window.history.back() });
      menu.push({ label: 'Reload', onSelect: () => window.location.reload() });
      e.preventDefault();
      show(e.clientX, e.clientY, menu);
    }
    document.addEventListener('contextmenu', onNative);
    return () => document.removeEventListener('contextmenu', onNative);
  }, [show]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      setActive(-1);
      return;
    }
    const m = ref.current;
    if (!m) return;
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    const left = x + mw > window.innerWidth - 8 ? Math.max(8, window.innerWidth - mw - 8) : x;
    const top = y + mh > window.innerHeight - 8 ? Math.max(8, window.innerHeight - mh - 8) : y;
    setPos({ top, left });
  }, [open, x, y, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (enabled.length === 0) return;
        const cur = enabled.indexOf(active);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = cur < 0 ? (dir === 1 ? 0 : enabled.length - 1) : (cur + dir + enabled.length) % enabled.length;
        setActive(enabled[next]!);
      } else if (e.key === 'Enter' && active >= 0) {
        const it = items[active];
        if (it && !isSep(it) && !it.disabled) {
          close();
          it.onSelect();
        }
      }
    };
    const onScroll = () => close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close, active, enabled, items]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: pos?.top ?? y, left: pos?.left ?? x, visibility: pos ? 'visible' : 'hidden' }}
      className="z-[200] max-h-[min(70vh,420px)] min-w-48 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2"
    >
      {items.map((item, i) =>
        isSep(item) ? (
          <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cx(
              'flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] outline-none',
              item.danger ? 'text-red hover:bg-red-bg' : 'text-text hover:bg-surface-2',
              active === i && (item.danger ? 'bg-red-bg' : 'bg-surface-2'),
              item.disabled && 'cursor-default opacity-50',
            )}
            onMouseEnter={() => !item.disabled && setActive(i)}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
          >
            {item.icon != null && (
              <span className={cx('inline-flex w-4 shrink-0 items-center justify-center', !item.danger && 'text-text-2')}>
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.checked && <IconCheck size={14} className="shrink-0" />}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
