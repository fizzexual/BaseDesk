import { Link } from 'react-router';
import { usePortal } from './store';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { IconInbox, IconPlus } from '../icons';
import { btnPrimary } from './ui';

export function PortalTickets() {
  const contact = usePortal((s) => s.contact);
  const tickets = usePortal((s) => s.tickets);

  return (
    <section>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold">Your tickets</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {contact ? `Signed in as ${contact.email}` : ''}
          </p>
        </div>
        <Link to="/portal/new" className={btnPrimary}>
          <IconPlus size={15} />
          New ticket
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={IconInbox}
            title="No tickets yet"
            hint="When you open a ticket it will appear here with its latest status."
          />
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                to={`/portal/ticket/${t.id}`}
                className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-2"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium">{t.subject}</span>
                      <span className="shrink-0 text-[12px] text-text-3">#{t.number}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-text-3">{t.lastMessagePreview}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge status={t.status} />
                    <TimeAgo iso={t.lastMessageAt} className="text-[12px] text-text-3" />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
