import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
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
}: {
  trigger: ReactNode | ((open: boolean) => ReactNode);
  items: MenuItem[];
  align?: 'start' | 'end';
  /** Extra classes for the trigger button (it is unstyled by default). */
  triggerClassName?: string;
  /** Accessible name for icon-only triggers. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setActive(-1);
      }
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
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute top-full z-50 mt-1 min-w-44 rounded-md border border-line bg-surface p-1 shadow-2',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
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
        </div>
      )}
    </div>
  );
}
