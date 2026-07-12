import { useMemo, useState } from 'react';
import { useApp } from '../../data/store';
import type { Message, Ticket, TicketPriority } from '../../data/types';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { IconCheck, IconSparkle, IconX } from '../../icons';
import { aiEnabled, suggestTriage } from '../ai/engine';

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function TriageBar({ ticket }: { ticket: Ticket }) {
  const messages = useApp((s) => s.messages[ticket.id]) as Message[] | undefined;
  const [dismissed, setDismissed] = useState(false);

  const suggestion = useMemo(
    () =>
      suggestTriage({
        subject: ticket.subject,
        bodyText: (messages ?? []).map((m) => m.body).join(' '),
        currentPriority: ticket.priority,
        currentTags: ticket.tags,
      }),
    [ticket.subject, ticket.priority, ticket.tags, messages],
  );

  if (!aiEnabled() || dismissed) return null;
  if (suggestion.priority === null && suggestion.tags.length === 0) return null;

  const clauses: string[] = [];
  if (suggestion.priority !== null) {
    clauses.push(`set priority to ${PRIORITY_LABELS[suggestion.priority]}`);
  }
  if (suggestion.tags.length > 0) {
    clauses.push(`add tags ${suggestion.tags.join(', ')}`);
  }

  function apply() {
    useApp
      .getState()
      .patchTicket(ticket.id, {
        priority: suggestion.priority ?? ticket.priority,
        tags: Array.from(new Set([...ticket.tags, ...suggestion.tags])),
      })
      .catch(() => toast('Could not apply suggestion'));
    setDismissed(true);
  }

  return (
    <div className="mx-4 my-2 flex shrink-0 items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
      <IconSparkle size={15} className="shrink-0 text-text-2" />
      <span className="min-w-0 text-text-2">Suggested: {clauses.join(' · ')}</span>
      <div className="flex-1" />
      <Button variant="subtle" size="sm" onClick={apply}>
        <IconCheck size={14} />
        Apply
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        <IconX size={14} />
        Dismiss
      </Button>
    </div>
  );
}
