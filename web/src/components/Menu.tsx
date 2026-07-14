import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from '../icons';
import { cx } from './util';

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      danger?: boolean;
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { separator: true };

function isSeparator(item: MenuItem): item is { separator: true } {
  return 'separator' in item;
}

export function Menu({
  trigger,
  items,
  align = 'start',
  triggerClassName,
  triggerLabel,
  header,
}: {
  trigger: ReactNode | ((open: boolean) => ReactNode);
  items: MenuItem[];
  align?: 'start' | 'end';
  /** Extra classes for the trigger button (it is unstyled by default). */
  triggerClassName?: string;
  /** Accessible name for icon-only triggers. */
  triggerLabel?: string;
  /** Optional non-interactive block rendered above the items (e.g. an account header). */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Fixed-viewport coordinates for the portaled menu; null until first measured.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = items
    .map((item, i) => (!isSeparator(item) && !item.disabled ? i : -1))
    .filter((i) => i >= 0);

  function openMenu() {
    setOpen(true);
    setActive(enabledIndexes.length > 0 ? enabledIndexes[0]! : -1);
  }

  function closeMenu(refocusTrigger: boolean) {
    setOpen(false);
    setActive(-1);
    setPos(null);
    if (refocusTrigger) triggerRef.current?.focus();
  }

  function move(dir: 1 | -1) {
    if (enabledIndexes.length === 0) return;
    const pos = enabledIndexes.indexOf(active);
    const next =
      pos < 0
        ? dir === 1
          ? 0
          : enabledIndexes.length - 1
        : (pos + dir + enabledIndexes.length) % enabledIndexes.length;
    setActive(enabledIndexes[next]!);
  }

  // Anchor the menu to the trigger in viewport space; flip up / clamp to stay
  // on screen. Runs after render (menu measured) and on scroll/resize.
  const reposition = useCallback(() => {
    const t = triggerRef.current;
    const m = menuRef.current;
    if (!t || !m) return;
    const r = t.getBoundingClientRect();
    const gap = 4;
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let top = r.bottom + gap;
    if (top + mh > window.innerHeight - 8) {
      const above = r.top - gap - mh;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - mh);
    }
    let left = align === 'end' ? r.right - mw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    setPos({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition, items.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target instanceof Node ? e.target : null;
      if (target && (rootRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
      setActive(-1);
      setPos(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (enabledIndexes.length > 0) setActive(enabledIndexes[0]!);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (enabledIndexes.length > 0) setActive(enabledIndexes[enabledIndexes.length - 1]!);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={cx('inline-flex items-center', triggerClassName)}
        onClick={() => (open ? closeMenu(false) : openMenu())}
      >
        {typeof trigger === 'function' ? trigger(open) : trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-[100] max-h-[min(70vh,420px)] min-w-44 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-2"
          >
            {header != null && <div className="mb-1 border-b border-line px-2.5 pb-2 pt-1.5">{header}</div>}
            {items.map((item, i) =>
              isSeparator(item) ? (
                <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={`${item.label}-${i}`}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  className={cx(
                    'flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] outline-none',
                    item.danger ? 'text-red hover:bg-red-bg' : 'text-text hover:bg-surface-2',
                    active === i && (item.danger ? 'bg-red-bg' : 'bg-surface-2'),
                    item.disabled && 'cursor-default opacity-50',
                  )}
                  onMouseEnter={() => {
                    if (!item.disabled) setActive(i);
                  }}
                  onClick={() => {
                    if (item.disabled) return;
                    closeMenu(true);
                    item.onSelect();
                  }}
                >
                  {item.icon != null && (
                    <span
                      className={cx(
                        'inline-flex w-4 shrink-0 items-center justify-center',
                        !item.danger && 'text-text-2',
                      )}
                    >
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
        )}
    </div>
  );
}
