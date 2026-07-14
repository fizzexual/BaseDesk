import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useApp } from '../data/store';

const POLL_MS = 6000;

/**
 * Live sync for the agent app. While the tab is visible, polls for new/updated
 * tickets, fresh notifications, and — when a ticket is open — its latest messages,
 * so agents receive customer replies and new tickets without refreshing the page.
 * Pauses while the tab is hidden and catches up as soon as it's visible again.
 */
export function useLiveSync() {
  const { pathname } = useLocation();
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = /^\/ticket\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const pollingRef = useRef(false); // guards against overlapping polls

  useEffect(() => {
    async function poll() {
      if (pollingRef.current || document.visibilityState === 'hidden') return;
      if (!useApp.getState().ready) return;
      pollingRef.current = true;
      try {
        await Promise.all([useApp.getState().refreshTickets(), useApp.getState().refreshNotifications()]);
        const openId = openIdRef.current;
        if (openId !== null) await useApp.getState().refreshOpenMessages(openId);
      } catch {
        // Transient failure — keep what we have and retry next tick.
      } finally {
        pollingRef.current = false;
      }
    }

    const interval = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
