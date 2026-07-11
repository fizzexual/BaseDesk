import type {
  Agent, CannedReply, Contact, Deal, DealCreate, DealPatch, DealStage, DealType,
  Message, StatsOverview, Ticket, TicketPatch, TicketPriority,
} from './types';

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; currentAgentId: string; deals: Deal[];
}
export interface Repository {
  bootstrap(): Promise<BootstrapData>;
  getMessages(ticketId: string): Promise<Message[]>;
  createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>;
  addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string }): Promise<{ message: Message; ticket: Ticket }>;
  createContact(input: { name: string; email: string; company?: string }): Promise<Contact>;
  saveCanned(c: CannedReply): Promise<CannedReply>;
  deleteCanned(id: string): Promise<void>;
  getStats(): Promise<StatsOverview>;
  search(q: string): Promise<{ ticketIds: string[] }>;
  listDeals(filter?: { stage?: DealStage; type?: DealType; contactId?: string }): Promise<Deal[]>;
  createDeal(input: DealCreate): Promise<Deal>;
  updateDeal(id: string, patch: DealPatch): Promise<Deal>;
  deleteDeal(id: string): Promise<void>;
}
