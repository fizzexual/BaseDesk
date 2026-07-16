import { useApp } from '../../data/store';
import { toast } from '../../components/Toast';
import { IconClock, IconX } from '../../icons';

/** Shows a ticket's pending scheduled sends, each cancellable, above the composer. */
export function ScheduledList({ ticketId }: { ticketId: string }) {
  const items = useApp((s) => s.scheduled[ticketId]) ?? [];
  const cancel = useApp((s) => s.cancelScheduled);
  if (items.length === 0) return null;
  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-1.5">
      {items.map((s) => (
        <div key={s.id} className="flex items-center gap-2 py-1 text-[13px]">
          <IconClock size={14} className="shrink-0 text-amber" />
          <span className="shrink-0 text-text-2">
            {s.kind === 'note' ? 'Note' : 'Reply'} scheduled{' '}
            <span className="font-medium text-text">
              {new Date(s.sendAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate text-text-3">— {s.body}</span>
          <button
            type="button"
            aria-label="Cancel scheduled send"
            className="shrink-0 rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
            onClick={() =>
              cancel(ticketId, s.id)
                .then(() => toast('Scheduled send cancelled'))
                .catch(() => toast('Could not cancel'))
            }
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
