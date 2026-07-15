import { useState } from 'react';
import { useApp } from '../../data/store';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import type { ApprovalStatus, Ticket } from '../../data/types';
import { IconCheck, IconPlus, IconX } from '../../icons';

const STATUS_STYLE: Record<ApprovalStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-amber-bg text-amber' },
  approved: { label: 'Approved', cls: 'bg-green-bg text-green' },
  rejected: { label: 'Rejected', cls: 'bg-red-bg text-red' },
};

function StatusPill({ status }: { status: ApprovalStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={cx('shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium', s.cls)}>{s.label}</span>;
}

/** Request sign-off on a ticket action, then approve or reject it. */
export function TicketApprovals({ ticket }: { ticket: Ticket }) {
  const approvals = useApp((s) => s.ticketApprovals[ticket.id]) ?? [];
  const agents = useApp((s) => s.agents);
  const requestApproval = useApp((s) => s.requestApproval);
  const decideApproval = useApp((s) => s.decideApproval);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState('');
  const [approverId, setApproverId] = useState('');
  const [busy, setBusy] = useState(false);

  const agentList = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));

  async function submit() {
    if (reason.trim() === '' || busy) return;
    setBusy(true);
    try {
      await requestApproval(ticket.id, reason.trim(), approverId === '' ? null : approverId);
      setReason('');
      setApproverId('');
      setAdding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not request approval');
    } finally {
      setBusy(false);
    }
  }

  function decide(id: string, decision: 'approved' | 'rejected') {
    void decideApproval(ticket.id, id, decision, null).catch(() => toast('Could not record the decision'));
  }

  return (
    <section className="border-t border-line p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
          <Tooltip title="Approvals" label="Request sign-off before acting on a ticket — like issuing a refund — and record who approved or rejected it.">
            <span>Approvals</span>
          </Tooltip>
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className={cx(
            'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium transition-colors',
            adding ? 'text-accent hover:bg-surface-2' : 'text-text-2 hover:bg-surface-2 hover:text-text',
          )}
        >
          <IconPlus size={13} />
          Request
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded-md border border-line bg-surface-2/40 p-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What needs approval? e.g. Refund $200 for order #4821"
            rows={2}
            autoFocus
            className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[12px] outline-none placeholder:text-text-3 focus:border-line-2"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              aria-label="Approver"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 text-[12px] outline-none focus:border-line-2"
            >
              <option value="">Anyone can approve</option>
              {agentList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={reason.trim() === '' || busy}
              onClick={() => void submit()}
              className="h-8 shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Request
            </button>
          </div>
        </div>
      )}

      {approvals.length === 0 ? (
        <p className="text-[13px] text-text-3">No approvals requested.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {approvals.map((a) => (
            <li key={a.id} className="rounded-md border border-line p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-[13px] text-text">{a.reason}</p>
                <StatusPill status={a.status} />
              </div>
              <div className="mt-1 text-[12px] text-text-3">
                Requested by {a.requestedByName ?? 'someone'}
                {a.approverName !== null && <> · for {a.approverName}</>}
              </div>
              {a.status === 'pending' ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => decide(a.id, 'approved')}
                    className="inline-flex items-center gap-1 rounded-md bg-green-bg px-2 py-1 text-[12px] font-medium text-green transition-opacity hover:opacity-80"
                  >
                    <IconCheck size={13} />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(a.id, 'rejected')}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[12px] font-medium text-text-2 transition-colors hover:bg-red-bg hover:text-red"
                  >
                    <IconX size={13} />
                    Reject
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-[12px] text-text-3">
                  {a.status === 'approved' ? 'Approved' : 'Rejected'} by {a.decidedByName ?? 'someone'}
                  {a.decisionNote !== null && <> · “{a.decisionNote}”</>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
