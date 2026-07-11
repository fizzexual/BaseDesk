import { useEffect, useMemo, useState } from 'react';
import { useApp } from './store';
import { repo } from './index';
import type { AccountHealth, Counts, Deal, RevenueStats, Ticket, ViewId } from './types';

/**
 * `counts()` / `ticketsForView()` build fresh objects, so calling them inside
 * a zustand selector loops forever. These hooks subscribe to the underlying
 * slices and memoize the derived values instead.
 */
export function useCounts(): Counts {
  const tickets = useApp((s) => s.tickets);
  const currentAgentId = useApp((s) => s.currentAgentId);
  return useMemo(
    () => useApp.getState().counts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, currentAgentId],
  );
}

export function useTicketsForView(view: ViewId): Ticket[] {
  const tickets = useApp((s) => s.tickets);
  const currentAgentId = useApp((s) => s.currentAgentId);
  return useMemo(
    () => useApp.getState().ticketsForView(view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, currentAgentId, view],
  );
}

export function useDealsForContact(contactId: string): Deal[] {
  const deals = useApp((s) => s.deals);
  return useMemo(
    () => useApp.getState().dealsForContact(contactId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, contactId],
  );
}

export function useDealsForTicket(ticketId: string): Deal[] {
  const deals = useApp((s) => s.deals);
  return useMemo(
    () => useApp.getState().dealsForTicket(ticketId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, ticketId],
  );
}

export function useAccounts(): AccountHealth[] {
  const deals = useApp((s) => s.deals);
  const tickets = useApp((s) => s.tickets);
  const contacts = useApp((s) => s.contacts);
  return useMemo(
    () => useApp.getState().accounts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, tickets, contacts],
  );
}

/**
 * Revenue stats come from the repository (server or local). Re-fetched whenever
 * the deal set changes so the dashboard reflects logged/won deals immediately.
 */
export function useRevenueStats(): { revenue: RevenueStats | null; loading: boolean } {
  const deals = useApp((s) => s.deals);
  const [revenue, setRevenue] = useState<RevenueStats | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    repo
      .getStats()
      .then((stats) => {
        if (live) {
          setRevenue(stats.revenue);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [deals]);
  return { revenue, loading };
}
