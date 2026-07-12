import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { IconNote, IconSparkle } from '../../icons';

export function DraftsPage() {
  const aiActions = useApp((s) => s.aiActions);
  const tickets = useApp((s) => s.tickets);
  const contacts = useApp((s) => s.contacts);
  const aiAgents = useApp((s) => s.aiAgents);
  const approveAction = useApp((s) => s.approveAction);
  const dismissAction = useApp((s) => s.dismissAction);

  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set());

  const drafts = useMemo(
    () =>
      Object.values(aiActions)
        .filter((a) => a.kind === 'draft' && a.status === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [aiActions],
  );

  function clearWorking(id: string) {
    setWorking((w) => {
      const next = new Set(w);
      next.delete(id);
      return next;
    });
  }

  async function approve(id: string) {
    if (working.has(id)) return;
    setWorking((w) => new Set(w).add(id));
    try {
      await approveAction(id);
      toast('Reply sent');
    } catch {
      toast('Could not send the reply');
      clearWorking(id);
    }
  }

  async function dismiss(id: string) {
    if (working.has(id)) return;
    setWorking((w) => new Set(w).add(id));
    try {
      await dismissAction(id);
      toast('Draft dismissed');
    } catch {
      toast('Could not dismiss the draft');
      clearWorking(id);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">Drafts</h1>
        {drafts.length > 0 && (
          <span className="text-[13px] text-text-3 tabular-nums">{drafts.length}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {drafts.length === 0 ? (
          <EmptyState
            icon={IconNote}
            title="No drafts waiting"
            hint="AI drafts awaiting approval will appear here."
          />
        ) : (
          drafts.map((action) => {
            const ticket = tickets[action.ticketId];
            if (!ticket) return null;
            const requester = contacts[ticket.requesterId];
            const agent = aiAgents[action.agentId];
            return (
              <div key={action.id} className="border-b border-line p-4">
                <div className="flex items-center gap-2.5">
                  <Avatar name={requester?.name ?? 'Unknown'} hue={requester?.avatarHue ?? 0} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
                      <span className="shrink-0 font-medium">{requester?.name ?? 'Unknown'}</span>
                      <span className="shrink-0 text-text-3">on</span>
                      <Link
                        to={`/ticket/${ticket.id}`}
                        className="min-w-0 truncate font-medium text-text hover:underline"
                      >
                        {ticket.subject}
                      </Link>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-text-3">
                      <IconSparkle size={13} className="shrink-0" />
                      <span className="truncate">{agent?.name ?? 'Agent'}</span>
                      <span aria-hidden="true">·</span>
                      <TimeAgo iso={action.createdAt} />
                    </div>
                  </div>
                </div>

                <div className="mt-3 whitespace-pre-line rounded-md border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-text-2">
                  {action.draftBody}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={working.has(action.id)}
                    onClick={() => void approve(action.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working.has(action.id)}
                    onClick={() => void dismiss(action.id)}
                  >
                    Dismiss
                  </Button>
                  <span className="text-[12px] text-text-3">
                    Approving sends this reply.{' '}
                    <Link to={`/ticket/${ticket.id}`} className="font-medium hover:underline">
                      Open the ticket
                    </Link>{' '}
                    to edit first.
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
