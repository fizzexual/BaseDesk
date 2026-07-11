import { useMemo } from 'react';
import { useApp } from './store';
import type { Counts, Ticket, ViewId } from './types';

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
