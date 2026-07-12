import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import { useDealsForContact } from '../../data/hooks';
import { formatMoney } from '../../data/money';
import type { Contact, Deal, DealStage, Ticket } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { StatusBadge } from '../../components/StatusBadge';
import { DealStageBadge, DealTypeBadge } from '../../components/DealBadges';
import { Menu, type MenuItem } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { IconChevronDown, IconPlus, IconSparkle } from '../../icons';
import { DealDialog } from '../revenue/DealDialog';
import { TicketCustomFields } from './TicketCustomFields';
import { aiEnabled } from '../ai/engine';

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

const STAGES: DealStage[] = ['open', 'won', 'lost'];

function DealRow({ deal, onEdit }: { deal: Deal; onEdit: () => void }) {
  const updateDeal = useApp((s) => s.updateDeal);
  const stageItems: MenuItem[] = STAGES.map((stage) => ({
    label: stage === 'open' ? 'Open' : stage === 'won' ? 'Won' : 'Lost',
    checked: deal.stage === stage,
    onSelect: () => {
      updateDeal(deal.id, { stage }).catch(() => toast('Could not update the deal'));
    },
  }));
  return (
    <div className="flex items-center gap-2 py-1.5">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <div className="flex items-center gap-1.5">
          <DealTypeBadge type={deal.type} />
          <span className="truncate text-[13px] font-medium">{deal.title}</span>
        </div>
        <div className="mt-0.5 text-[13px] tabular-nums text-text-2">{formatMoney(deal.value)}</div>
      </button>
      <Menu
        align="end"
        triggerLabel="Change stage"
        trigger={
          <span className="inline-flex items-center gap-1">
            <DealStageBadge stage={deal.stage} />
            <IconChevronDown size={13} className="text-text-3" />
          </span>
        }
        items={stageItems}
      />
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
    <RevenueAwarePanel ticket={ticket} contact={contact} localTime={localTime} recent={recent} />
  );
}

function RevenueAwarePanel({
  ticket,
  contact,
  localTime,
  recent,
}: {
  ticket: Ticket;
  contact: Contact;
  localTime: string | null;
  recent: Ticket[];
}) {
  const deals = useDealsForContact(ticket.requesterId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>(undefined);
  const aiSummarize = useApp((s) => s.aiSummarize);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  async function summarize() {
    if (summarizing) return;
    setSummarizing(true);
    try {
      const { summary: text } = await aiSummarize(ticket.id);
      setSummary(text);
    } catch {
      setSummary('Could not summarise this thread.');
    } finally {
      setSummarizing(false);
    }
  }

  function openNew() {
    setEditing(undefined);
    setDialogOpen(true);
  }
  function openEdit(deal: Deal) {
    setEditing(deal);
    setDialogOpen(true);
  }

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
      <TicketCustomFields ticket={ticket} />
      {aiEnabled() && (
        <section className="border-t border-line p-4">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
            Summary
          </h3>
          <button
            type="button"
            disabled={summarizing}
            className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-60"
            onClick={() => void summarize()}
          >
            <IconSparkle size={14} />
            {summarizing ? 'Summarizing…' : 'Summarize thread'}
          </button>
          {summary !== null && <p className="mt-2 text-[13px] text-text-2">{summary}</p>}
        </section>
      )}
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
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">Revenue</h3>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            onClick={openNew}
          >
            <IconPlus size={13} />
            Log opportunity
          </button>
        </div>
        {deals.length === 0 ? (
          <p className="text-[13px] text-text-3">No opportunities yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {deals.map((deal) => (
              <DealRow key={deal.id} deal={deal} onEdit={() => openEdit(deal)} />
            ))}
          </div>
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
      <DealDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        deal={editing}
        presetContactId={ticket.requesterId}
        presetTicketId={ticket.id}
      />
    </aside>
  );
}
