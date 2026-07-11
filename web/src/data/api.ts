import type {
  CannedReply, Contact, Deal, DealCreate, DealPatch, DealStage, DealType,
  Message, StatsOverview, Ticket, TicketPatch, TicketPriority,
} from './types';
import type { BootstrapData, Repository } from './repository';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') detail = data.error;
    } catch {
      // non-JSON error body; fall back to the status text
    }
    throw new Error(detail ?? res.statusText);
  }
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export class ApiRepository implements Repository {
  bootstrap(): Promise<BootstrapData> {
    return request('/bootstrap');
  }

  getMessages(ticketId: string): Promise<Message[]> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`);
  }

  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }> {
    return request('/tickets', jsonInit('POST', input));
  }

  updateTicket(id: string, patch: TicketPatch): Promise<Ticket> {
    return request(`/tickets/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }

  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string }): Promise<{ message: Message; ticket: Ticket }> {
    return request(`/tickets/${encodeURIComponent(ticketId)}/messages`, jsonInit('POST', input));
  }

  createContact(input: { name: string; email: string; company?: string }): Promise<Contact> {
    return request('/contacts', jsonInit('POST', input));
  }

  saveCanned(c: CannedReply): Promise<CannedReply> {
    const body = { title: c.title, body: c.body };
    return c.id
      ? request(`/canned/${encodeURIComponent(c.id)}`, jsonInit('PUT', body))
      : request('/canned', jsonInit('POST', body));
  }

  async deleteCanned(id: string): Promise<void> {
    await request<{ ok: true }>(`/canned/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getStats(): Promise<StatsOverview> {
    return request('/stats');
  }

  search(q: string): Promise<{ ticketIds: string[] }> {
    return request(`/search?q=${encodeURIComponent(q)}`);
  }

  listDeals(filter?: { stage?: DealStage; type?: DealType; contactId?: string }): Promise<Deal[]> {
    const qs = new URLSearchParams();
    if (filter?.stage) qs.set('stage', filter.stage);
    if (filter?.type) qs.set('type', filter.type);
    if (filter?.contactId) qs.set('contactId', filter.contactId);
    const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
    return request(`/deals${suffix}`);
  }

  createDeal(input: DealCreate): Promise<Deal> {
    return request('/deals', jsonInit('POST', input));
  }

  updateDeal(id: string, patch: DealPatch): Promise<Deal> {
    return request(`/deals/${encodeURIComponent(id)}`, jsonInit('PATCH', patch));
  }

  async deleteDeal(id: string): Promise<void> {
    await request<{ ok: true }>(`/deals/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
