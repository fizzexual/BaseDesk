import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconContacts, IconPlus, IconSearch } from '../../icons';
import { NewContactDialog } from './NewContactDialog';

const GRID = 'grid-cols-[minmax(200px,1.4fr)_minmax(180px,1.4fr)_minmax(120px,1fr)_70px_90px]';

export function ContactsPage() {
  const navigate = useNavigate();
  const contacts = useApp((s) => s.contacts);
  const tickets = useApp((s) => s.tickets);

  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const onNewContact = () => setDialogOpen(true);
    window.addEventListener('basedesk:new-contact', onNewContact);
    return () => window.removeEventListener('basedesk:new-contact', onNewContact);
  }, []);

  const contactList = useMemo(
    () => Object.values(contacts).sort((a, b) => a.name.localeCompare(b.name)),
    [contacts],
  );

  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of Object.values(tickets)) {
      counts.set(t.requesterId, (counts.get(t.requesterId) ?? 0) + 1);
    }
    return counts;
  }, [tickets]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return contactList;
    return contactList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.company !== null && c.company.toLowerCase().includes(q)),
    );
  }, [contactList, query]);

  const total = contactList.length;
  const countLabel =
    visible.length === total
      ? `${total.toLocaleString('en-US')} ${total === 1 ? 'contact' : 'contacts'}`
      : `${visible.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} contacts`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">Contacts</h1>
        <span className="tabular-nums text-[13px] text-text-3">{countLabel}</span>
        <div className="flex-1" />
        <div className="relative">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
          />
          <input
            value={query}
            aria-label="Search contacts"
            placeholder="Search contacts"
            className="h-8 w-56 rounded-md border border-line bg-bg pl-8 pr-2.5 text-[13px] transition-colors focus:border-line-2"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query !== '') setQuery('');
                else e.currentTarget.blur();
              }
            }}
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
          <IconPlus size={15} className="shrink-0" />
          New contact
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length > 0 ? (
          <div>
            <div
              className={cx(
                'sticky top-0 z-10 grid h-9 items-center gap-4 border-b border-line bg-surface px-4 text-[13px] text-text-3',
                GRID,
              )}
            >
              <div>Name</div>
              <div>Email</div>
              <div>Company</div>
              <div>
                <Tooltip title="Tickets" label="How many tickets this contact has filed, open or closed.">
                  <span>Tickets</span>
                </Tooltip>
              </div>
              <div>Since</div>
            </div>
            {visible.map((c: Contact) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-label={`Contact: ${c.name}`}
                className={cx(
                  'grid h-14 cursor-pointer items-center gap-4 border-b border-line px-4 last:border-0 hover:bg-surface-2',
                  GRID,
                )}
                onClick={() => navigate(`/contacts/${c.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/contacts/${c.id}`);
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.name} hue={c.avatarHue} size={28} />
                  <span className="truncate text-[14px] font-medium">{c.name}</span>
                </div>
                <div className="truncate text-[13px] text-text-2">{c.email}</div>
                <div className="truncate text-[13px] text-text-2">{c.company ?? '—'}</div>
                <div className="tabular-nums text-[13px] text-text-2">
                  {(ticketCounts.get(c.id) ?? 0).toLocaleString('en-US')}
                </div>
                <TimeAgo iso={c.createdAt} />
              </div>
            ))}
          </div>
        ) : total > 0 ? (
          <EmptyState icon={IconSearch} title="No matching contacts" hint="Try a different search." />
        ) : (
          <EmptyState
            icon={IconContacts}
            title="No contacts yet"
            hint="People you help will show up here."
          />
        )}
      </div>

      <NewContactDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
