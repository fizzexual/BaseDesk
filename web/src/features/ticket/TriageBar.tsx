import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../data/store';
import type { CopilotTriage, Ticket, TicketPriority } from '../../data/types';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { IconCheck, IconSparkle, IconX } from '../../icons';
import { aiEnabled } from '../ai/engine';

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const BAR = 'mx-4 my-2 flex shrink-0 items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px]';

export function TriageBar({ ticket }: { ticket: Ticket }) {
  const aiTriage = useApp((s) => s.aiTriage);
  const autoTriage = useApp((s) => s.aiAutomation.autoTriage);
  const [suggestion, setSuggestion] = useState<CopilotTriage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  // Start fresh when switching tickets.
  useEffect(() => {
    setSuggestion(null);
    setDismissed(false);
    fetchedFor.current = null;
  }, [ticket.id]);

  const runTriage = useCallback(() => {
    if (fetchedFor.current === ticket.id) return;
    fetchedFor.current = ticket.id;
    setLoading(true);
    aiTriage(ticket.id)
      .then((s) => setSuggestion(s))
      .catch(() => {
        /* leave the bar hidden on failure */
      })
      .finally(() => setLoading(false));
  }, [ticket.id, aiTriage]);

  // Auto-suggest only when the admin has opted in; otherwise it's a manual button.
  useEffect(() => {
    if (aiEnabled() && autoTriage) runTriage();
  }, [autoTriage, runTriage]);

  if (!aiEnabled() || dismissed) return null;

  // Manual mode, nothing fetched yet: offer a button.
  if (suggestion === null) {
    if (autoTriage) return null; // auto mode fetches silently — nothing to show until it lands
    return (
      <div className={BAR}>
        <IconSparkle size={15} className="shrink-0 text-text-3" />
        <span className="min-w-0 text-text-3">Let AI suggest a priority and tags for this ticket.</span>
        <div className="flex-1" />
        <Button variant="subtle" size="sm" onClick={runTriage} disabled={loading}>
          {loading ? 'Reading…' : 'Suggest'}
        </Button>
      </div>
    );
  }
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
    <div className={BAR}>
      <Tooltip title="AI triage" label="Priority and tags AI suggested after reading this ticket — apply them or dismiss if they're off.">
        <IconSparkle size={15} className="shrink-0 text-text-2" />
      </Tooltip>
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
