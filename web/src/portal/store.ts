import { create } from 'zustand';
import type { Branding, Contact, IntakeAnswer, Ticket, TicketPriority } from '../data/types';
import { getToken, portalApi, setToken } from './api';
import { applyAccent } from '../data/branding';

export interface PortalState {
  ready: boolean; // finished the initial session check
  contact: Contact | null;
  tickets: Ticket[];
  branding: Branding;
  init(): Promise<void>;
  /** Resolves 'pending' when a link to finish was emailed instead of signing in. */
  register(input: { name: string; email: string; password: string }): Promise<'signed-in' | 'pending'>;
  claim(token: string): Promise<void>;
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
  branding: { productName: 'BaseDesk', accentColor: '' },

  async init() {
    // Branding is public — apply it whether or not the visitor is signed in.
    try {
      const branding = await portalApi.branding();
      applyAccent(branding.accentColor);
      set({ branding });
    } catch {
      /* keep the default branding */
    }
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
    const res = await portalApi.register(input);
    if ('pending' in res) return 'pending';
    setToken(res.token);
    const tickets = await portalApi.listTickets();
    set({ contact: res.contact, tickets });
    return 'signed-in';
  },

  async claim(claimToken) {
    const { token, contact } = await portalApi.claim(claimToken);
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
