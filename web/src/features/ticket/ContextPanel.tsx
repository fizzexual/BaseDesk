import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';

function formatLocalTime(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return null;
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-[12px] font-medium text-text-3">{label}</span>
      <span className="min-w-0 truncate text-[13px] text-text-2">{value}</span>
    </div>
  );
}

export function ContextPanel({ ticket }: { ticket: Ticket }) {
  const contact = useApp((s) => s.contacts[ticket.requesterId]) as Contact | undefined;
  const tickets = useApp((s) => s.tickets);

  // Re-render each minute so the contact's local time stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const recent = useMemo(
    () =>
      Object.values(tickets)
        .filter((t) => t.requesterId === ticket.requesterId && t.id !== ticket.id)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
        .slice(0, 3),
    [tickets, ticket.requesterId, ticket.id],
  );

  if (!contact) {
    return <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line" />;
  }

  const localTime = contact.timezone !== null ? formatLocalTime(contact.timezone) : null;

  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line">
      <section className="p-4">
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} hue={contact.avatarHue} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{contact.name}</div>
            <div className="truncate text-[13px] text-text-3">{contact.email}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {contact.company !== null && <DetailRow label="Company" value={contact.company} />}
          {contact.location !== null && <DetailRow label="Location" value={contact.location} />}
          {localTime !== null && <DetailRow label="Local time" value={localTime} />}
        </div>
      </section>
      <section className="border-t border-line p-4">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
          Recent tickets
        </h3>
        {recent.length === 0 ? (
          <p className="text-[13px] text-text-3">No other tickets from this contact.</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/ticket/${t.id}`}
                  className="-mx-2 flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.subject}</span>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="border-t border-line p-4">
        <Link
          to={`/contacts/${contact.id}`}
          className="text-[13px] font-medium text-text-2 transition-colors hover:text-text"
        >
          View profile
        </Link>
      </section>
    </aside>
  );
}
