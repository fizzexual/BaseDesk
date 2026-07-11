import { create } from 'zustand';
import type {
  AccountHealth, Agent, CannedReply, Contact, Counts, Deal, DealCreate, DealPatch,
  Message, Ticket, TicketPatch, TicketPriority, ViewId,
} from './types';
import type { Repository } from './repository';
import { repo } from './index';
import { applyTheme, readThemePref } from '../app/theme';

export interface AppState {
  ready: boolean;
  tickets: Record<string, Ticket>; contacts: Record<string, Contact>;
  agents: Record<string, Agent>; canned: CannedReply[];
  deals: Record<string, Deal>;
  messages: Record<string, Message[]>; // keyed by ticketId, loaded lazily
  currentAgentId: string;
  theme: 'light' | 'dark' | 'system';
  init(): Promise<void>;
  ticketsForView(view: ViewId): Ticket[];      // sorted lastMessageAt desc
  counts(): Counts;
  loadMessages(ticketId: string): Promise<void>;
  patchTicket(id: string, patch: TicketPatch): Promise<void>;   // optimistic + rollback on error
  sendMessage(ticketId: string, kind: 'reply' | 'note', body: string): Promise<void>;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<string>; // returns id
  createContact(input: { name: string; email: string; company?: string }): Promise<string>;
  saveCanned(c: CannedReply): Promise<void>; deleteCanned(id: string): Promise<void>;
  createDeal(input: DealCreate): Promise<string>;               // returns id
  updateDeal(id: string, patch: DealPatch): Promise<void>;      // optimistic + rollback
  deleteDeal(id: string): Promise<void>;                        // optimistic + rollback
  dealsForTicket(ticketId: string): Deal[];                     // updatedAt desc
  dealsForContact(contactId: string): Deal[];                   // updatedAt desc
  accounts(): AccountHealth[];                                  // grouped by company
  setTheme(t: 'light' | 'dark' | 'system'): void;
  searchLocal(q: string): Ticket[];  // subject/preview/requester name+email/tags, max 20
}

function isSnoozed(t: Ticket, now: string): boolean {
  return t.snoozedUntil !== null && t.snoozedUntil > now;
}

function matchesView(t: Ticket, view: ViewId, currentAgentId: string, now: string): boolean {
  switch (view) {
    case 'archive':
    case 'spam':
    case 'trash':
      return t.bucket === view;
    case 'snoozed':
      return t.bucket === 'inbox' && isSnoozed(t, now);
    default:
      break;
  }
  if (t.bucket !== 'inbox' || isSnoozed(t, now)) return false;
  switch (view) {
    case 'all':
      return t.status !== 'closed';
    case 'unassigned':
      return t.assigneeId === null && (t.status === 'open' || t.status === 'pending');
    case 'mine':
      return (
        t.assigneeId === currentAgentId &&
        (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold')
      );
    default:
      return t.status === view;
  }
}

/** First 90 chars of the body with all whitespace collapsed to single spaces. */
function previewOf(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function initialTheme(): 'light' | 'dark' | 'system' {
  // Node exposes an experimental localStorage global that throws when no
  // backing file is configured; fall back to 'system' outside the browser.
  try {
    return readThemePref();
  } catch {
    return 'system';
  }
}

const byRecency = (a: Ticket, b: Ticket) => b.lastMessageAt.localeCompare(a.lastMessageAt);

export function createAppStore(repository: Repository) {
  let tempCounter = 0;
  return create<AppState>()((set, get) => ({
    ready: false,
    tickets: {},
    contacts: {},
    agents: {},
    canned: [],
    deals: {},
    messages: {},
    currentAgentId: '',
    theme: initialTheme(),

    async init() {
      const data = await repository.bootstrap();
      set({
        ready: true,
        tickets: Object.fromEntries(data.tickets.map((t) => [t.id, t])),
        contacts: Object.fromEntries(data.contacts.map((c) => [c.id, c])),
        agents: Object.fromEntries(data.agents.map((a) => [a.id, a])),
        canned: data.canned,
        deals: Object.fromEntries(data.deals.map((d) => [d.id, d])),
        currentAgentId: data.currentAgentId,
      });
    },

    ticketsForView(view) {
      const now = new Date().toISOString();
      const { tickets, currentAgentId } = get();
      return Object.values(tickets)
        .filter((t) => matchesView(t, view, currentAgentId, now))
        .sort(byRecency);
    },

    counts() {
      const now = new Date().toISOString();
      const { tickets, currentAgentId } = get();
      const c: Counts = {
        all: 0, unassigned: 0, mine: 0, snoozed: 0,
        open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0,
        archive: 0, spam: 0, trash: 0,
      };
      for (const t of Object.values(tickets)) {
        if (t.bucket === 'archive') c.archive += 1;
        if (t.bucket === 'spam') c.spam += 1;
        if (t.bucket === 'trash') c.trash += 1;
        if (t.bucket !== 'inbox') continue;
        if (isSnoozed(t, now)) {
          c.snoozed += 1;
          continue;
        }
        c[t.status] += 1;
        if (t.status !== 'closed') {
          c.all += 1;
          if (t.assigneeId === null && (t.status === 'open' || t.status === 'pending')) c.unassigned += 1;
          if (
            t.assigneeId === currentAgentId &&
            (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold')
          ) {
            c.mine += 1;
          }
        }
      }
      return c;
    },

    async loadMessages(ticketId) {
      const msgs = await repository.getMessages(ticketId);
      set((s) => ({ messages: { ...s.messages, [ticketId]: msgs } }));
    },

    async patchTicket(id, patch) {
      const prev = get().tickets[id] as Ticket | undefined;
      if (!prev) throw new Error('Ticket not found');
      const optimistic: Ticket = { ...prev, updatedAt: new Date().toISOString() };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (optimistic as unknown as Record<string, unknown>)[key] = value;
      }
      set((s) => ({ tickets: { ...s.tickets, [id]: optimistic } }));
      try {
        const ticket = await repository.updateTicket(id, patch);
        set((s) => ({ tickets: { ...s.tickets, [id]: ticket } }));
      } catch (err) {
        set((s) => ({ tickets: { ...s.tickets, [id]: prev } }));
        throw err;
      }
    },

    async sendMessage(ticketId, kind, body) {
      const { tickets, messages, currentAgentId } = get();
      const prevTicket = tickets[ticketId] as Ticket | undefined;
      if (!prevTicket) throw new Error('Ticket not found');
      const prevMessages = messages[ticketId] ?? [];
      const now = new Date().toISOString();
      tempCounter += 1;
      const temp: Message = {
        id: `tmp_${tempCounter}`,
        ticketId,
        authorKind: 'agent',
        authorId: currentAgentId,
        kind,
        body,
        at: now,
      };
      const optimistic: Ticket = { ...prevTicket, updatedAt: now, lastMessageAt: now };
      if (kind === 'reply') {
        optimistic.lastMessagePreview = previewOf(body);
        if (optimistic.status === 'open') optimistic.status = 'pending';
      }
      set((s) => ({
        tickets: { ...s.tickets, [ticketId]: optimistic },
        messages: { ...s.messages, [ticketId]: [...prevMessages, temp] },
      }));
      try {
        const { message, ticket } = await repository.addMessage(ticketId, { kind, body });
        set((s) => ({
          tickets: { ...s.tickets, [ticketId]: ticket },
          messages: {
            ...s.messages,
            [ticketId]: (s.messages[ticketId] ?? []).map((m) => (m.id === temp.id ? message : m)),
          },
        }));
      } catch (err) {
        set((s) => ({
          tickets: { ...s.tickets, [ticketId]: prevTicket },
          messages: { ...s.messages, [ticketId]: prevMessages },
        }));
        throw err;
      }
    },

    async createTicket(input) {
      const { ticket, message } = await repository.createTicket(input);
      set((s) => ({
        tickets: { ...s.tickets, [ticket.id]: ticket },
        messages: { ...s.messages, [ticket.id]: [message] },
      }));
      return ticket.id;
    },

    async createContact(input) {
      const contact = await repository.createContact(input);
      set((s) => ({ contacts: { ...s.contacts, [contact.id]: contact } }));
      return contact.id;
    },

    async saveCanned(c) {
      const saved = await repository.saveCanned(c);
      set((s) => ({
        canned: s.canned.some((x) => x.id === saved.id)
          ? s.canned.map((x) => (x.id === saved.id ? saved : x))
          : [...s.canned, saved],
      }));
    },

    async deleteCanned(id) {
      await repository.deleteCanned(id);
      set((s) => ({ canned: s.canned.filter((c) => c.id !== id) }));
    },

    async createDeal(input) {
      const deal = await repository.createDeal(input);
      set((s) => ({ deals: { ...s.deals, [deal.id]: deal } }));
      return deal.id;
    },

    async updateDeal(id, patch) {
      const prev = get().deals[id] as Deal | undefined;
      if (!prev) throw new Error('Deal not found');
      const now = new Date().toISOString();
      const optimistic: Deal = { ...prev, ...patch, updatedAt: now };
      if (patch.stage !== undefined) {
        if (patch.stage === 'won' || patch.stage === 'lost') {
          optimistic.closedAt = prev.closedAt ?? now;
        } else {
          optimistic.closedAt = null;
        }
      }
      set((s) => ({ deals: { ...s.deals, [id]: optimistic } }));
      try {
        const deal = await repository.updateDeal(id, patch);
        set((s) => ({ deals: { ...s.deals, [id]: deal } }));
      } catch (err) {
        set((s) => ({ deals: { ...s.deals, [id]: prev } }));
        throw err;
      }
    },

    async deleteDeal(id) {
      const prev = get().deals[id] as Deal | undefined;
      if (!prev) return;
      set((s) => {
        const next = { ...s.deals };
        delete next[id];
        return { deals: next };
      });
      try {
        await repository.deleteDeal(id);
      } catch (err) {
        set((s) => ({ deals: { ...s.deals, [id]: prev } }));
        throw err;
      }
    },

    dealsForTicket(ticketId) {
      return Object.values(get().deals)
        .filter((d) => d.ticketId === ticketId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    dealsForContact(contactId) {
      return Object.values(get().deals)
        .filter((d) => d.contactId === contactId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    accounts() {
      const now = new Date().toISOString();
      const { tickets, contacts, deals } = get();
      const groups = new Map<string, AccountHealth>();

      const ensure = (company: string): AccountHealth => {
        let acc = groups.get(company);
        if (acc === undefined) {
          acc = {
            company, contactIds: [], mrr: 0, openTickets: 0, urgentOpen: 0,
            wonValue: 0, openPipeline: 0, openExpansion: 0, openRetention: 0, status: 'healthy',
          };
          groups.set(company, acc);
        }
        return acc;
      };

      const companyOf = new Map<string, string>(); // contactId -> company
      for (const c of Object.values(contacts)) {
        if (c.company === null) continue;
        companyOf.set(c.id, c.company);
        const acc = ensure(c.company);
        acc.contactIds.push(c.id);
        acc.mrr += c.mrr ?? 0;
      }

      for (const t of Object.values(tickets)) {
        const company = companyOf.get(t.requesterId);
        if (company === undefined) continue;
        const snoozed = t.snoozedUntil !== null && t.snoozedUntil > now;
        if (t.bucket === 'inbox' && !snoozed && t.status !== 'closed' && t.status !== 'solved') {
          const acc = ensure(company);
          acc.openTickets += 1;
          if (t.priority === 'urgent' || t.priority === 'high') acc.urgentOpen += 1;
        }
      }

      for (const d of Object.values(deals)) {
        const company = companyOf.get(d.contactId);
        if (company === undefined) continue;
        const acc = ensure(company);
        if (d.stage === 'won') acc.wonValue += d.value;
        else if (d.stage === 'open') {
          acc.openPipeline += d.value;
          if (d.type === 'expansion') acc.openExpansion += 1;
          if (d.type === 'retention') acc.openRetention += 1;
        }
      }

      const rank = { at_risk: 0, expansion_ready: 1, healthy: 2 };
      const list = [...groups.values()].map((acc) => {
        acc.status =
          acc.openRetention > 0 || acc.urgentOpen >= 1 ? 'at_risk'
          : acc.openExpansion > 0 ? 'expansion_ready'
          : 'healthy';
        return acc;
      });
      list.sort((a, b) => rank[a.status] - rank[b.status] || b.mrr - a.mrr || a.company.localeCompare(b.company));
      return list;
    },

    setTheme(t) {
      set({ theme: t });
      applyTheme(t);
    },

    searchLocal(q) {
      const query = q.trim().toLowerCase();
      if (query === '') return [];
      const { tickets, contacts } = get();
      const prefixMatches: Ticket[] = [];
      const otherMatches: Ticket[] = [];
      for (const t of Object.values(tickets)) {
        const subject = t.subject.toLowerCase();
        const contact = contacts[t.requesterId] as Contact | undefined;
        const matched =
          subject.includes(query) ||
          t.lastMessagePreview.toLowerCase().includes(query) ||
          (contact !== undefined &&
            (contact.name.toLowerCase().includes(query) || contact.email.toLowerCase().includes(query))) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!matched) continue;
        if (subject.startsWith(query)) prefixMatches.push(t);
        else otherMatches.push(t);
      }
      return [...prefixMatches.sort(byRecency), ...otherMatches.sort(byRecency)].slice(0, 20);
    },
  }));
}

export const useApp = createAppStore(repo);
