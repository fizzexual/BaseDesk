import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import type { Ticket } from '../../data/types';
import { IconMerge, IconSearch } from '../../icons';

/**
 * Pick a target ticket to fold the source into. The source's messages move to
 * the target and the source is closed as a pointer — irreversible, so we say so.
 */
export function MergeDialog({ source, onClose }: { source: Ticket; onClose: () => void }) {
  const tickets = useApp((s) => s.tickets);
  const mergeTicket = useApp((s) => s.mergeTicket);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.values(tickets)
      .filter((t) => t.id !== source.id && t.mergedIntoId === null)
      .filter(
        (t) =>
          term === '' ||
          t.subject.toLowerCase().includes(term) ||
          String(t.number).includes(term.replace('#', '')),
      )
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .slice(0, 8);
  }, [tickets, q, source.id]);

  async function doMerge(into: Ticket) {
    if (busy) return;
    setBusy(true);
    try {
      await mergeTicket(source.id, into.id);
      toast(`Merged #${source.number} into #${into.number}`);
      onClose();
      navigate(`/ticket/${into.id}`);
    } catch {
      toast('Could not merge the ticket');
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Merge ticket #${source.number}`}>
      <p className="text-[13px] text-text-2">
        Fold this ticket into another one. Its messages and attachments move over and this ticket is closed as a
        pointer to the target. This can't be undone.
      </p>
      <div className="mt-4 flex h-9 items-center gap-2 rounded-sm border border-line bg-surface px-3">
        <IconSearch size={15} className="shrink-0 text-text-3" />
        <input
          autoFocus
          type="text"
          value={q}
          placeholder="Search by subject or #number"
          className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-text-3"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="mt-3 max-h-[280px] overflow-y-auto">
        {candidates.length === 0 ? (
          <li className="px-1 py-6 text-center text-[13px] text-text-3">No matching tickets.</li>
        ) : (
          candidates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
                onClick={() => void doMerge(t)}
              >
                <span className="shrink-0 text-[12px] text-text-3 tabular-nums">#{t.number}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{t.subject}</span>
                <span className="shrink-0 text-[12px] capitalize text-text-3">{t.status.replace('_', ' ')}</span>
                <IconMerge size={15} className="shrink-0 text-text-3" />
              </button>
            </li>
          ))
        )}
      </ul>
    </Dialog>
  );
}
