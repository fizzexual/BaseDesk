import { useEffect, useState, useSyncExternalStore } from 'react';
import { cx } from './util';

interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
  leaving: boolean;
}

const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 160;
const MAX_STACK = 3;

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

function startExit(id: number) {
  const item = toasts.find((t) => t.id === id);
  if (!item || item.leaving) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, EXIT_MS);
}

export function toast(message: string, opts?: { undo?: () => void }) {
  const id = nextId++;
  toasts = [...toasts, { id, message, undo: opts?.undo, leaving: false }];
  const active = toasts.filter((t) => !t.leaving);
  if (active.length > MAX_STACK) {
    for (const extra of active.slice(0, active.length - MAX_STACK)) startExit(extra.id);
  }
  notify();
  setTimeout(() => startExit(id), AUTO_DISMISS_MS);
}

function ToastPill({ item }: { item: ToastItem }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const visible = entered && !item.leaving;

  return (
    <div
      className={cx(
        'pointer-events-auto flex h-10 items-center gap-3 rounded-full bg-accent pl-4 pr-2 text-[13px] text-accent-fg shadow-2 transition-all duration-150',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span>{item.message}</span>
      {item.undo && (
        <button
          type="button"
          className="h-7 rounded-full px-2 font-medium underline underline-offset-2"
          onClick={() => {
            item.undo?.();
            startExit(item.id);
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {items.map((item) => (
        <ToastPill key={item.id} item={item} />
      ))}
    </div>
  );
}
