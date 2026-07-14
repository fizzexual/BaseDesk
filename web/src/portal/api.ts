// Self-contained data layer for the customer portal. It is deliberately separate
// from the agent-side Repository/store: a customer is a different principal, sees
// only their own data, and authenticates with a bearer token kept in localStorage.

import type { Attachment, Contact, IntakeAnswer, IntakeForm, KbArticle, Ticket, TicketPriority } from '../data/types';

const TOKEN_KEY = 'basedesk-portal-token';

export interface PortalMessage {
  id: string;
  authorKind: 'contact' | 'agent';
  authorName: string;
  body: string;
  at: string;
  attachments: Attachment[];
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/portal${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') detail = data.error;
    } catch {
      /* non-JSON */
    }
    throw new Error(detail ?? res.statusText);
  }
  return (await res.json()) as T;
}

const body = (v: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(v) });

export const portalApi = {
  register(input: { name: string; email: string; password: string }) {
    return req<{ token: string; contact: Contact }>('/register', body(input));
  },
  login(input: { email: string; password: string }) {
    return req<{ token: string; contact: Contact }>('/login', body(input));
  },
  me() {
    return req<Contact>('/me');
  },
  updateProfile(patch: Partial<Pick<Contact, 'name' | 'company' | 'location' | 'timezone'>>) {
    return req<Contact>('/me', { method: 'PATCH', body: JSON.stringify(patch) });
  },
  changePassword(input: { current: string; next: string }) {
    return req<{ ok: true }>('/password', body(input));
  },
  listTickets() {
    return req<Ticket[]>('/tickets');
  },
  getTicket(id: string) {
    return req<{ ticket: Ticket; messages: PortalMessage[] }>(`/tickets/${encodeURIComponent(id)}`);
  },
  createTicket(input: {
    subject: string;
    body: string;
    priority: TicketPriority;
    attachmentIds?: string[];
    /** Intake-wizard results: picked category, accumulated tags, and the full answer path. */
    category?: string | null;
    tags?: string[];
    answers?: IntakeAnswer[];
  }) {
    return req<{ ticket: Ticket }>('/tickets', body(input));
  },
  /** The branching intake form the customer walks before opening a ticket (enabled-only). */
  intakeForm() {
    return req<IntakeForm>('/intake-form');
  },
  reply(id: string, message: string, attachmentIds?: string[]) {
    return req<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}/messages`, body({ body: message, attachmentIds }));
  },
  /** Upload a file (unlinked until a message references it via attachmentIds). */
  async uploadAttachment(file: File): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: form });
    if (!res.ok) {
      let detail: string | undefined;
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data.error === 'string') detail = data.error;
      } catch {
        /* non-JSON */
      }
      throw new Error(detail ?? res.statusText);
    }
    return (await res.json()) as Attachment;
  },
  rate(id: string, score: number, comment: string) {
    return req<{ ticket: Ticket }>(`/tickets/${encodeURIComponent(id)}/rating`, body({ score, comment }));
  },
  kb() {
    return req<KbArticle[]>('/kb');
  },
  /** Published articles most relevant to `q`, for deflecting a ticket (empty = none matched). */
  kbSuggest(q: string) {
    return req<KbArticle[]>(`/kb?q=${encodeURIComponent(q)}`);
  },
};
