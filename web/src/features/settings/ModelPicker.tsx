import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../components/util';
import { formatContext, formatPrice, type ModelInfo } from '../../data/model-catalog';
import { IconCheck, IconChevronDown } from '../../icons';

function ReasoningBadge() {
  return (
    <span className="inline-flex h-[17px] shrink-0 items-center rounded-full bg-blue-bg px-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue">
      Reasoning
    </span>
  );
}

function PriceTag({ model }: { model: ModelInfo }) {
  if (model.inputPer1M === 0 && model.outputPer1M === 0) {
    return <span className="shrink-0 text-[12px] font-medium text-green">Free</span>;
  }
  return (
    <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-text-2">
      {formatPrice(model.inputPer1M)} in · {formatPrice(model.outputPer1M)} out
    </span>
  );
}

/** A rich model dropdown: each row shows price in/out per 1M, a reasoning badge,
 *  and the context window, with a free-text escape hatch for any custom id. */
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string, info: ModelInfo | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = models.find((m) => m.id === value);

  // Anchor the (portaled) list to the trigger in viewport space so it escapes
  // the scrollable settings panel; flip up when it would overflow the bottom.
  const reposition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const gap = 4;
    const mh = menuRef.current?.offsetHeight ?? 0;
    let top = r.bottom + gap;
    if (mh && top + mh > window.innerHeight - 8) {
      const above = r.top - gap - mh;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - mh);
    }
    setPos({ top, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(m: ModelInfo) {
    onChange(m.id, m);
    setOpen(false);
  }

  function commitCustom() {
    const id = custom.trim();
    if (id === '') return;
    onChange(id, models.find((m) => m.id === id));
    setCustom('');
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-left text-[14px] hover:border-line-2"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <span className="font-mono text-[13px]">{selected.id}</span>
          ) : value.trim() !== '' ? (
            <span className="font-mono text-[13px]">{value}</span>
          ) : (
            <span className="text-text-3">Choose a model</span>
          )}
        </span>
        {selected?.reasoning && <ReasoningBadge />}
        {selected && <PriceTag model={selected} />}
        {!selected && value.trim() !== '' && <span className="shrink-0 text-[11px] text-text-3">custom</span>}
        <IconChevronDown size={14} className="shrink-0 text-text-3" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos?.width,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-[100] max-h-[min(70vh,340px)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-2"
          >
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === value}
              onClick={() => pick(m)}
              className={cx(
                'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                m.id === value && 'bg-surface-2',
              )}
            >
              <IconCheck size={14} className={cx('mt-0.5 shrink-0', m.id === value ? 'text-text' : 'text-transparent')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{m.label}</span>
                  {m.reasoning && <ReasoningBadge />}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-text-3">{m.id}</span>
                {m.note && <span className="mt-0.5 block truncate text-[12px] text-text-3">{m.note}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <PriceTag model={m} />
                <span className="text-[11px] tabular-nums text-text-3">{formatContext(m.contextK)} ctx</span>
              </span>
            </button>
          ))}

          <div className="mt-1 border-t border-line px-2 pb-1 pt-2">
            <span className="text-[11px] font-medium text-text-3">Custom model id</span>
            <div className="mt-1 flex gap-1.5">
              <input
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCustom();
                  }
                }}
                placeholder="e.g. deepseek-chat"
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[12px] outline-none focus:border-line-2"
              />
              <button
                type="button"
                onClick={commitCustom}
                className="h-8 shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg hover:opacity-90"
              >
                Use
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
