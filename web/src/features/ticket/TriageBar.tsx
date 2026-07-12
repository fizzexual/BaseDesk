import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import type { CopilotTriage, Ticket, TicketPriority } from '../../data/types';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { IconCheck, IconSparkle, IconX } from '../../icons';
import { aiEnabled } from '../ai/engine';

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function TriageBar({ ticket }: { ticket: Ticket }) {
  const aiTriage = useApp((s) => s.aiTriage);
  const [suggestion, setSuggestion] = useState<CopilotTriage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!aiEnabled() || fetchedFor.current === ticket.id) return;
    fetchedFor.current = ticket.id;
    setSuggestion(null);
    setDismissed(false);
    let cancelled = false;
    aiTriage(ticket.id)
      .then((s) => {
        if (!cancelled) setSuggestion(s);
      })
      .catch(() => {
        /* leave the bar hidden on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, aiTriage]);

  if (!aiEnabled() || dismissed || suggestion === null) return null;
  if (suggestion.priority === null && suggestion.tags.length === 0) return null;

  const clauses: string[] = [];
  if (suggestion.priority !== null) clauses.push(`set priority to ${PRIORITY_LABELS[suggestion.priority]}`);
  if (suggestion.tags.length > 0) clauses.push(`add tags ${suggestion.tags.join(', ')}`);

  function apply() {
    if (suggestion === null) return;
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
