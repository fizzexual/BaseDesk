import { create } from 'zustand';
import type { Contact, IntakeAnswer, Ticket, TicketPriority } from '../data/types';
import { getToken, portalApi, setToken } from './api';

export interface PortalState {
  ready: boolean; // finished the initial session check
  contact: Contact | null;
  tickets: Ticket[];
  init(): Promise<void>;
  register(input: { name: string; email: string; password: string }): Promise<void>;
  login(input: { email: string; password: string }): Promise<void>;
  logout(): void;
  refreshTickets(): Promise<void>;
  createTicket(input: {
    subject: string;
    body: string;
    priority: TicketPriority;
    attachmentIds?: string[];
    category?: string | null;
    tags?: string[];
    answers?: IntakeAnswer[];
  }): Promise<string>;
  updateProfile(patch: Partial<Pick<Contact, 'name' | 'company' | 'location' | 'timezone'>>): Promise<void>;
}

export const usePortal = create<PortalState>()((set) => ({
  ready: false,
  contact: null,
  tickets: [],

  async init() {
    if (getToken() === null) {
      set({ ready: true });
      return;
    }
    try {
      const [contact, tickets] = await Promise.all([portalApi.me(), portalApi.listTickets()]);
      set({ contact, tickets, ready: true });
    } catch {
      // Stale or invalid token — clear it and start signed out.
      setToken(null);
      set({ contact: null, tickets: [], ready: true });
    }
  },

  async register(input) {
    const { token, contact } = await portalApi.register(input);
    setToken(token);
    const tickets = await portalApi.listTickets();
    set({ contact, tickets });
  },

  async login(input) {
    const { token, contact } = await portalApi.login(input);
    setToken(token);
    const tickets = await portalApi.listTickets();
    set({ contact, tickets });
  },

  logout() {
    setToken(null);
    set({ contact: null, tickets: [] });
  },

  async refreshTickets() {
    set({ tickets: await portalApi.listTickets() });
  },

  async createTicket(input) {
    const { ticket } = await portalApi.createTicket(input);
    set((s) => ({ tickets: [ticket, ...s.tickets] }));
    return ticket.id;
  },

  async updateProfile(patch) {
    const contact = await portalApi.updateProfile(patch);
    set({ contact });
  },
}));
