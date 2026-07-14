import { useState } from 'react';
import { useApp } from '../../data/store';
import { Tooltip } from '../../components/Tooltip';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import type { Ticket } from '../../data/types';
import { IconCheck, IconPlus, IconX } from '../../icons';

/**
 * A ticket's checklist — the sub-steps an agent works through to resolve it
 * (e.g. "verify identity", "issue refund", "confirm with customer"). Add,
 * tick off, and remove items; progress is shown as a bar + count.
 */
export function TicketChecklist({ ticket }: { ticket: Ticket }) {
  const tasks = useApp((s) => s.ticketTasks[ticket.id]) ?? [];
  const addTask = useApp((s) => s.addTask);
  const patchTask = useApp((s) => s.patchTask);
  const deleteTask = useApp((s) => s.deleteTask);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const doneCount = tasks.filter((t) => t.done).length;

  async function add() {
    const title = draft.trim();
    if (title === '' || adding) return;
    setAdding(true);
    try {
      await addTask(ticket.id, title);
      setDraft('');
    } catch {
      toast('Could not add the item');
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="border-t border-line p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
          <Tooltip title="Checklist" label="Track the sub-steps needed to resolve this ticket — tick each one off as you go.">
            <span>Checklist</span>
          </Tooltip>
        </h3>
        {tasks.length > 0 && (
          <span className="text-[12px] tabular-nums text-text-3">
            {doneCount}/{tasks.length}
          </span>
        )}
      </div>

      {tasks.length > 0 && (
        <>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-green transition-all"
              style={{ width: `${Math.round((doneCount / tasks.length) * 100)}%` }}
            />
          </div>
          <ul className="flex flex-col">
            {tasks.map((t) => (
              <li key={t.id} className="group flex items-start gap-2 py-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                  onClick={() => void patchTask(ticket.id, t.id, { done: !t.done }).catch(() => toast('Could not update the item'))}
                  className={cx(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                    t.done ? 'border-green bg-green text-white' : 'border-line-2 hover:border-text-3',
                  )}
                >
                  {t.done && <IconCheck size={11} />}
                </button>
                <span className={cx('min-w-0 flex-1 text-[13px] leading-snug', t.done && 'text-text-3 line-through')}>
                  {t.title}
                </span>
                <button
                  type="button"
                  aria-label={`Remove “${t.title}”`}
                  onClick={() => void deleteTask(ticket.id, t.id).catch(() => toast('Could not remove the item'))}
                  className="mt-0.5 shrink-0 rounded-sm p-0.5 text-text-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
                >
                  <IconX size={13} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <IconPlus size={14} className="shrink-0 text-text-3" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add an item…"
          aria-label="Add a checklist item"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-3"
        />
      </div>
    </section>
  );
}
