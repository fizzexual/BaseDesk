import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconContacts, IconPlus, IconTicket } from '../../icons';
import { requestNewTicket } from '../palette/shortcuts';
import { TicketTable } from '../inbox/TicketTable';

export function ContactPage() {
  const params = useParams();
  const id = params.id ?? '';
  const navigate = useNavigate();
  const contact = useApp((s) => s.contacts[id]) as Contact | undefined;
  const tickets = useApp((s) => s.tickets);

  const theirTickets = useMemo(
    () =>
      Object.values(tickets)
        .filter((t) => t.requesterId === id)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [tickets, id],
  );

  if (contact === undefined) {
    return (
      <EmptyState
        icon={IconContacts}
        title="Contact not found"
        hint="This contact may have been removed."
      />
    );
  }

  const meta = [contact.email, contact.company, contact.location]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  function newTicket() {
    navigate('/view/all');
    window.setTimeout(requestNewTicket, 0);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-line p-5">
        <Avatar name={contact.name} hue={contact.avatarHue} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{contact.name}</div>
          <div className="truncate text-[13px] text-text-3">{meta}</div>
        </div>
        <div className="flex-1" />
        <Button variant="subtle" size="sm" onClick={newTicket}>
          <IconPlus size={15} className="shrink-0" />
          New ticket
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-1 pt-3 text-[13px] font-medium text-text-3">Tickets</div>
        {theirTickets.length > 0 ? (
          <TicketTable tickets={theirTickets} hideCustomer />
        ) : (
          <EmptyState
            icon={IconTicket}
            title="No tickets yet"
            hint="Tickets from this contact will show up here."
          />
        )}
      </div>
    </div>
  );
}
