import type { Agent, TicketEvent } from '../../data/types';

// How a link reads from the acting ticket's point of view.
const LINK_VERB: Record<string, string> = {
  related: 'related',
  blocks: 'blocking',
  blocked_by: 'blocked by',
  duplicate_of: 'a duplicate of',
  duplicated_by: 'a duplicate of',
};

/**
 * A human sentence for an activity event — the predicate only, without the actor
 * prefix (the caller renders "{actor} {sentence}"). Shared by the ticket timeline
 * and the global audit log so both phrase events identically.
 */
export function describeTicketEvent(e: TicketEvent, agents: Record<string, Agent>): string {
  const d = e.detail;
  const agentName = (id: unknown): string => (typeof id === 'string' && id !== '' ? agents[id]?.name ?? 'someone' : 'no one');
  switch (e.kind) {
    case 'created':
      return 'created this ticket';
    case 'status':
      return `changed status to ${String(d.to).replace('_', ' ')}`;
    case 'priority':
      return `set priority to ${String(d.to)}`;
    case 'assignee':
      if (d.to === null || d.to === undefined) return 'unassigned the ticket';
      return d.auto === true ? `auto-assigned to ${agentName(d.to)}` : `assigned to ${agentName(d.to)}`;
    case 'tags': {
      const parts: string[] = [];
      if (Array.isArray(d.added) && d.added.length > 0) parts.push(`added ${d.added.map((t) => `#${t}`).join(' ')}`);
      if (Array.isArray(d.removed) && d.removed.length > 0) parts.push(`removed ${d.removed.map((t) => `#${t}`).join(' ')}`);
      return parts.length > 0 ? parts.join(', ') : 'updated tags';
    }
    case 'merged':
      return `merged this into #${String(d.targetNumber)}`;
    case 'link':
      return `linked #${String(d.targetNumber)} as ${LINK_VERB[String(d.linkType)] ?? 'related'}`;
    case 'split': {
      const n = typeof d.count === 'number' ? d.count : 0;
      return n > 0
        ? `split ${n} message${n === 1 ? '' : 's'} into #${String(d.targetNumber)}`
        : `split off #${String(d.targetNumber)}`;
    }
    case 'approval': {
      const state = String(d.state);
      if (state === 'approved') return 'approved a request';
      if (state === 'rejected') return 'rejected a request';
      const reason = typeof d.reason === 'string' ? d.reason : '';
      const short = reason.length > 48 ? `${reason.slice(0, 48)}…` : reason;
      return reason !== '' ? `requested approval: “${short}”` : 'requested approval';
    }
    default:
      return 'updated the ticket';
  }
}
