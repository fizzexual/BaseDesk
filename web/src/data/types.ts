export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TicketBucket = 'inbox' | 'archive' | 'spam' | 'trash';
export type Channel = 'email' | 'chat' | 'web' | 'api';
export type ViewId =
  | 'all' | 'unassigned' | 'mine' | 'snoozed'
  | 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
  | 'archive' | 'spam' | 'trash';

export interface Ticket {
  id: string; number: number; subject: string;
  status: TicketStatus; priority: TicketPriority; bucket: TicketBucket;
  requesterId: string; assigneeId: string | null; tags: string[];
  channel: Channel; createdAt: string; updatedAt: string;
  snoozedUntil: string | null; lastMessageAt: string; lastMessagePreview: string;
}
export interface Message {
  id: string; ticketId: string;
  authorKind: 'contact' | 'agent'; authorId: string;
  kind: 'reply' | 'note'; body: string; at: string;
}
export interface Contact {
  id: string; name: string; email: string; company: string | null;
  avatarHue: number; location: string | null; timezone: string | null; createdAt: string;
}
export interface Agent { id: string; name: string; email: string; avatarHue: number; role: 'admin' | 'agent'; }
export interface CannedReply { id: string; title: string; body: string; }

export interface Counts {
  all: number; unassigned: number; mine: number; snoozed: number;
  open: number; pending: number; on_hold: number; solved: number; closed: number;
  archive: number; spam: number; trash: number;
}
export interface StatsOverview {
  createdLast14Days: { date: string; count: number }[];
  solvedLast14Days: { date: string; count: number }[];
  byPriority: Record<TicketPriority, number>;
  byStatus: Record<TicketStatus, number>;
  perAgentOpen: { agentId: string; count: number }[];
  medianFirstReplyMinutes: number;
  medianResolutionHours: number;
  openNow: number; createdLast7Days: number; solvedLast7Days: number;
}
export type TicketPatch = Partial<Pick<Ticket,
  'status' | 'priority' | 'assigneeId' | 'tags' | 'bucket' | 'snoozedUntil' | 'subject'>>;
