import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import type { Message, Ticket } from '../../data/types';
import { cx } from '../../components/util';

/**
 * Split a ticket that holds two separate issues: pick the messages that belong
 * in a new ticket. They move out of this one, which stays linked to the split-off
 * ticket. At least one message must stay behind.
 */
export function SplitDialog({ source, onClose }: { source: Ticket; onClose: () => void }) {
  const messages = useApp((s) => s.messages[source.id]);
  const agents = useApp((s) => s.agents);
  const contacts = useApp((s) => s.contacts);
  const splitTicket = useApp((s) => s.splitTicket);
  const navigate = useNavigate();

  const thread = useMemo(() => (messages ?? []).filter((m) => !m.deletedAt), [messages]);
  const [subject, setSubject] = useState(source.subject);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const authorName = (m: Message): string =>
    m.authorKind === 'agent'
      ? agents[m.authorId ?? '']?.name ?? 'Agent'
      : contacts[m.authorId ?? '']?.name ?? 'Customer';

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const count = selected.size;
  const leavesAtLeastOne = count < thread.length;
  const valid = count > 0 && leavesAtLeastOne && subject.trim() !== '';

  async function doSplit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const newId = await splitTicket(source.id, subject.trim(), [...selected]);
      toast(`Split ${count} message${count === 1 ? '' : 's'} into a new ticket`);
      onClose();
      navigate(`/ticket/${newId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not split the ticket');
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Split ticket #${source.number}`} width={560}>
      <p className="text-[13px] text-text-2">
        Move the selected messages into a new ticket. This ticket keeps the rest and stays linked to the new one.
      </p>

      <label className="mt-4 block">
        <span className="mb-1 block text-[12px] font-medium text-text-3">New ticket subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject for the split-off ticket"
          className="h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[14px] outline-none placeholder:text-text-3 focus:border-line-2"
        />
      </label>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-text-3">Messages to move</span>
          <span className="text-[12px] tabular-nums text-text-3">
            {count} of {thread.length} selected
          </span>
        </div>
        <ul className="max-h-[300px] divide-y divide-line overflow-y-auto rounded-md border border-line">
          {thread.length === 0 ? (
            <li className="px-3 py-6 text-center text-[13px] text-text-3">This ticket has no messages to split.</li>
          ) : (
            thread.map((m) => {
              const on = selected.has(m.id);
              return (
                <li key={m.id}>
                  <label
                    className={cx(
                      'flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors',
                      on ? 'bg-accent/8' : 'hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(m.id)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-text">{authorName(m)}</span>
                        {m.kind === 'note' && (
                          <span className="rounded-sm bg-amber-bg px-1 py-px text-[10px] font-medium uppercase tracking-wide text-amber">
                            Note
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-text-3">{m.body.replace(/\s+/g, ' ').trim() || '(no text)'}</span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-3">
          {count > 0 && !leavesAtLeastOne ? 'Leave at least one message in this ticket.' : 'The two tickets will be linked as related.'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!valid || busy} onClick={() => void doSplit()}>
            Split into new ticket
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
