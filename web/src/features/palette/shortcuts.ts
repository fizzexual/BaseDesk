import { useEffect, useRef } from 'react';

export type ShortcutScope = 'global' | 'inbox' | 'ticket';

/**
 * Keys are normalized combos:
 *  - single keys: 'j', 'k', 'e', 'u', 'o', 's', 'r', 'n', '1'..'4', 'enter', 'escape', '?'
 *  - modifier combos: 'mod+k', 'mod+enter' (mod = Ctrl or ⌘)
 *  - two-key sequences: 'g i', 'g c', 'g r' (800ms window)
 * Inside editable targets only 'escape' and 'mod+…' combos fire.
 */
export type ShortcutHandlers = Record<string, (e: KeyboardEvent) => void>;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function normalize(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) return `mod+${key}`;
  if (key === ' ') return 'space';
  return key === 'esc' ? 'escape' : key;
}

export function useShortcuts(_scope: ShortcutScope, handlers: ShortcutHandlers, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    let pendingPrefix: string | null = null;
    let pendingAt = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat) return;
      const combo = normalize(e);
      const editable = isEditable(e.target);
      if (editable && combo !== 'escape' && !combo.startsWith('mod+')) return;
      if (e.altKey) return;

      const current = handlersRef.current;

      // Two-key sequences ('g i' …) — only outside editables.
      if (!editable && pendingPrefix !== null && performance.now() - pendingAt < 800) {
        const seq = `${pendingPrefix} ${combo}`;
        pendingPrefix = null;
        const seqHandler = current[seq];
        if (seqHandler) {
          e.preventDefault();
          seqHandler(e);
          return;
        }
      }
      if (!editable && combo === 'g' && Object.keys(current).some((k) => k.startsWith('g '))) {
        pendingPrefix = 'g';
        pendingAt = performance.now();
        return;
      }

      const handler = current[combo];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';

export function openPalette() {
  window.dispatchEvent(new CustomEvent('basedesk:open-palette'));
}
export function openHelp() {
  window.dispatchEvent(new CustomEvent('basedesk:open-help'));
}
export function requestNewTicket() {
  window.dispatchEvent(new CustomEvent('basedesk:new-ticket'));
}
