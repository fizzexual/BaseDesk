import type { TicketPriority, TicketSla, TicketStatus } from '../data/types';

export interface Explainer {
  title: string;
  desc: string;
}

/** What each ticket status means, in plain language for an agent glancing at a badge. */
export const STATUS_INFO: Record<TicketStatus, Explainer> = {
  open: { title: 'Open', desc: 'New or reopened and not yet resolved — it still needs a reply or action from the team.' },
  pending: { title: 'Pending', desc: 'The team has replied and is waiting on the customer. The ball is in their court.' },
  on_hold: { title: 'On hold', desc: 'Paused by the team — usually blocked on a third party or a scheduled fix.' },
  solved: { title: 'Solved', desc: 'Marked resolved. It closes automatically after a while unless the customer writes back.' },
  closed: { title: 'Closed', desc: 'Finished and archived. A new customer reply reopens it.' },
};

/** Whether the team or the customer owes the next message. */
export const REPLY_INFO: Record<'awaiting' | 'replied', Explainer> = {
  awaiting: { title: 'Awaiting reply', desc: 'The customer sent the last message, so your team owes a response.' },
  replied: { title: 'Replied', desc: 'The team has answered since the customer last wrote — the ball is in their court.' },
};

/** Optional per-priority explainer (Urgent/High/Medium/Low). */
export const PRIORITY_INFO: Record<TicketPriority, Explainer> = {
  urgent: { title: 'Urgent', desc: 'Highest priority — handle before anything else; tightest SLA targets apply.' },
  high: { title: 'High', desc: 'Important — pick up soon, ahead of medium and low tickets.' },
  medium: { title: 'Medium', desc: 'Normal priority — the default for most tickets.' },
  low: { title: 'Low', desc: 'Can wait — work it once higher-priority tickets are handled.' },
};

/**
 * Explain an SLA badge. `label` already reads like "Resolve in 6m" / "Reply overdue";
 * the description says which clock it is and what the colour means.
 */
export function slaExplainer(sla: TicketSla): Explainer {
  const clock = sla.clock === 'resolution' ? 'resolution' : 'first-response';
  const title =
    sla.clock === 'resolution' ? 'Resolution SLA' : sla.clock === 'first_response' ? 'First-response SLA' : 'SLA';
  const desc = ((): string => {
    switch (sla.state) {
      case 'breached':
        return `Past its ${clock} target — “${sla.label}”. This ticket has missed the time you promised.`;
      case 'due_soon':
        return `The ${clock} timer is almost up — “${sla.label}”. Act before it runs out to stay on target.`;
      case 'on_track':
        return `Within the ${clock} target — “${sla.label}”. Plenty of time left.`;
      case 'met':
        return `You hit the ${clock} target on this ticket. Nothing more is owed on the clock.`;
      case 'paused':
        return `The ${clock} clock is paused — for example while the ticket waits on the customer or is on hold.`;
    }
  })();
  return { title, desc };
}
