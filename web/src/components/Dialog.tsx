import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const current = document.activeElement;
    if (e.shiftKey) {
      if (current === first || current === panel) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto" onKeyDown={trapTab}>
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ background: 'rgb(0 0 0 / 0.32)' }}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="relative mx-auto mb-16 mt-[15vh] rounded-lg border border-line bg-surface p-5 shadow-2 outline-none"
        style={{ width, maxWidth: 'calc(100vw - 32px)' }}
      >
        {title ? (
          <h2 id={titleId} className="mb-4 text-[15px] font-semibold">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
