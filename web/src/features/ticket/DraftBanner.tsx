import { useState } from 'react';
import { useApp } from '../../data/store';
import type { Ticket } from '../../data/types';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { IconSparkle } from '../../icons';
import { TokenCost } from '../ai/TokenCost';

/**
 * Surfaces a pending AI draft for this ticket right above the composer, so an
 * agent can approve, edit, or dismiss it without a trip to the Drafts queue.
 */
export function DraftBanner({ ticket }: { ticket: Ticket }) {
  const aiActions = useApp((s) => s.aiActions);
  const aiAgents = useApp((s) => s.aiAgents);
  const approveAction = useApp((s) => s.approveAction);
  const dismissAction = useApp((s) => s.dismissAction);
  const setComposerPrefill = useApp((s) => s.setComposerPrefill);
  const [busy, setBusy] = useState(false);

  const draft = Object.values(aiActions).find(
    (a) => a.ticketId === ticket.id && a.kind === 'draft' && a.status === 'pending',
  );
  // Nothing to show — or the ticket is closed and locked for writing.
  if (draft === undefined || ticket.status === 'closed') return null;
  const d = draft; // narrowed alias so the async handlers below keep the type

  const agent = aiAgents[d.agentId];

  async function approve() {
    if (busy) return;
    setBusy(true);
    try {
      await approveAction(d.id);
      toast('Reply sent');
    } catch {
      toast('Could not send the reply');
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await dismissAction(d.id);
      toast('Draft dismissed');
    } catch {
      toast('Could not dismiss the draft');
      setBusy(false);
    }
  }

  function edit() {
    setComposerPrefill(d.draftBody ?? '');
    void dismissAction(d.id).catch(() => {});
    toast('Draft moved to the composer');
  }

  return (
    <div className="mx-4 mt-2 shrink-0 rounded-md border border-line bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-text-2">
        <IconSparkle size={14} className="shrink-0" />
        <span>Suggested reply</span>
        {agent && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-text-3">{agent.name}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <TokenCost promptTokens={draft.promptTokens} completionTokens={draft.completionTokens} />
      </div>
      <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-md border border-line bg-surface p-2.5 text-[13px] leading-relaxed text-text-2">
        {draft.draftBody}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void approve()}>
          Approve &amp; send
        </Button>
        <Button variant="subtle" size="sm" disabled={busy} onClick={edit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
