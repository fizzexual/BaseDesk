import { create } from 'zustand';
import type { Agent, CannedReply, Contact, Counts, Message, Ticket, TicketPatch, TicketPriority, ViewId } from './types';
import type { Repository } from './repository';
import { repo } from './index';
import { applyTheme, readThemePref } from '../app/theme';

export interface AppState {
  ready: boolean;
  tickets: Record<string, Ticket>; contacts: Record<string, Contact>;
  agents: Record<string, Agent>; canned: CannedReply[];
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
