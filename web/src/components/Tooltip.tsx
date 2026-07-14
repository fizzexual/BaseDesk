import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './util';

type Side = 'top' | 'bottom' | 'left' | 'right';

const GAP = 6;
const MARGIN = 8;

/** Place the bubble beside the trigger for the requested side, flipping and clamping to stay on-screen. */
function computePosition(t: DOMRect, tip: DOMRect, side: Side): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === 'left' || side === 'right') {
    let left = side === 'left' ? t.left - tip.width - GAP : t.right + GAP;
    if (side === 'right' && left + tip.width > vw - MARGIN) left = t.left - tip.width - GAP;
    if (side === 'left' && left < MARGIN) left = t.right + GAP;
    const top = Math.max(MARGIN, Math.min(t.top + t.height / 2 - tip.height / 2, vh - tip.height - MARGIN));
    return { top, left };
  }
  const left = Math.max(MARGIN, Math.min(t.left + t.width / 2 - tip.width / 2, vw - tip.width - MARGIN));
  let top = side === 'top' ? t.top - tip.height - GAP : t.bottom + GAP;
  if (side === 'top' && top < MARGIN) top = t.bottom + GAP; // flip down
  if (side === 'bottom' && top + tip.height > vh - MARGIN) top = t.top - tip.height - GAP; // flip up
  return { top, left };
}

/**
 * Hover/focus tooltip rendered in a portal (position: fixed) so it is never clipped
 * by an ancestor's overflow — badges live inside fixed-height headers and scrolling
 * lists that would otherwise cut the bubble off. Two shapes:
 * - Plain: a short accent pill (pass just `label`).
 * - Rich: a titled explainer card (pass `title` + a longer `label`).
 */
export function Tooltip({
  label,
  title,
  children,
  side = 'top',
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
  side?: Side;
}) {
  const rich = title !== undefined;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function show() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 300);
  }
  function hide() {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }

  // Measure the trigger + bubble once mounted, then place it (opacity stays 0 until then).
  useLayoutEffect(() => {
    if (!open || triggerRef.current === null || tipRef.current === null) return;
    setPos(computePosition(triggerRef.current.getBoundingClientRect(), tipRef.current.getBoundingClientRect(), side));
  }, [open, side]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cx(
              'pointer-events-none fixed z-[100] shadow-2',
              // Rendered off-screen + hidden for the first measuring pass, then shown in place.
              pos === null ? 'invisible' : 'visible',
              rich
                ? 'max-w-[248px] whitespace-normal rounded-md border border-line bg-surface px-2.5 py-2 text-left'
                : 'whitespace-nowrap rounded-sm bg-accent px-2 py-1 text-[12px] font-medium text-accent-fg',
            )}
          >
            {rich ? (
              <>
                <span className="block text-[12px] font-semibold text-text">{title}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-text-2">{label}</span>
              </>
            ) : (
              label
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
