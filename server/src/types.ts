// Domain types — mirror of web/src/data/types.ts (shared contract, keep in sync).

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
  firstRespondedAt: string | null; resolvedAt: string | null;
  channelId: string | null;
  /** When set, this ticket was merged into the referenced ticket and is a read-only tombstone. */
  mergedIntoId: string | null;
  /** Values for admin-defined custom fields, keyed by field id. */
  customFields: Record<string, string>;
  /** Customer satisfaction rating (1–5), set from the portal on a solved/closed ticket. */
  satisfactionScore?: number | null;
  satisfactionComment?: string | null;
  satisfactionAt?: string | null;
}

/** Aggregate customer-satisfaction figures over rated tickets. */
export interface CsatStats {
  count: number;
  average: number;      // mean score, 1–5 (0 when no ratings)
  positivePct: number;  // share rated 4–5, 0–100
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date';
export type CustomFieldEntity = 'ticket' | 'contact';
/** An admin-defined custom field. Values live on the entity keyed by this id. */
export interface CustomFieldDef {
  id: string; entity: CustomFieldEntity; label: string; type: CustomFieldType;
  options: string[]; required: boolean; position: number; createdAt: string;
}
export type CustomFieldCreate = {
  entity: CustomFieldEntity; label: string; type: CustomFieldType; options?: string[]; required?: boolean;
};
export type CustomFieldPatch = Partial<Pick<CustomFieldDef, 'label' | 'type' | 'options' | 'required' | 'position'>>;

export type ChannelType =
  | 'webchat' | 'webhook' | 'email' | 'discord' | 'slack'
  | 'whatsapp' | 'telegram' | 'messenger' | 'sms';
/** Full channel row, including write-only secrets (server-side only). */
export interface ChannelConn {
  id: string; type: ChannelType; name: string; enabled: boolean;
  inboundToken: string; address: string | null; createdAt: string;
  /** Webhook/API endpoint agent replies are delivered to (null = inbound-only). */
  outboundUrl: string | null;
  /** Optional bearer token / bot secret for the outbound endpoint. Never sent to the client. */
  outboundSecret: string | null;
  /** Optional HMAC-SHA256 signing secret for inbound webhooks/commands. Never sent to the client. */
  inboundSecret: string | null;
}
/** Client-safe channel shape: secrets are masked to booleans. */
export interface PublicChannel {
  id: string; type: ChannelType; name: string; enabled: boolean;
  inboundToken: string; address: string | null; createdAt: string;
  outboundUrl: string | null; hasOutboundSecret: boolean; hasInboundSecret: boolean;
}

export interface SlaTarget { firstResponseMins: number; resolutionMins: number; }
export type SlaTargets = Record<TicketPriority, SlaTarget>;

export type AutomationConditionType = 'subject_contains' | 'body_contains' | 'priority_is' | 'channel_is' | 'from_contains';
export type AutomationActionType = 'set_priority' | 'add_tag' | 'assign' | 'set_status';
export interface AutomationCondition { type: AutomationConditionType; value: string }
export interface AutomationAction { type: AutomationActionType; value: string }
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runOn: 'create' | 'create_update';
}

export interface SlaHours {
  enabled: boolean;
  timezone: string;      // IANA tz, e.g. 'America/New_York'
  days: number[];        // 0=Sun .. 6=Sat
  start: string;         // 'HH:MM'
  end: string;           // 'HH:MM'
}

export type ArticleStatus = 'draft' | 'published';
export interface KbArticle {
  id: string;
  title: string;
  slug: string;
  category: string;
  body: string;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
}

export type Autonomy = 'suggest' | 'draft' | 'resolve';
export interface AiAgent {
  id: string; name: string; avatarHue: number; enabled: boolean;
  autonomy: Autonomy;
  scopeTags: string[];
  scopePriorities: TicketPriority[];
  createdAt: string;
}
export type AiActionKind = 'triage' | 'draft' | 'resolve';
export type AiActionStatus = 'pending' | 'approved' | 'dismissed' | 'sent';
export interface AiAction {
  id: string; agentId: string; ticketId: string;
  kind: AiActionKind; status: AiActionStatus;
  draftBody: string | null;
  suggestedPriority: TicketPriority | null;
  suggestedTags: string[];
  kbArticleId: string | null;
  promptTokens: number; completionTokens: number; // 0 for the rule-based engine
  createdAt: string; resolvedAt: string | null;
}
export interface Attachment {
  id: string; messageId: string | null; ticketId: string | null;
  filename: string; mimeType: string; size: number; createdAt: string;
}
export interface Message {
  id: string; ticketId: string;
  authorKind: 'contact' | 'agent'; authorId: string;
  kind: 'reply' | 'note'; body: string; at: string;
  /** Populated on read (getMessages joins them); omitted on insert. */
  attachments?: Attachment[];
  /** Soft-delete tombstone: set when a message is removed but kept for the record. */
  deletedAt?: string | null;
  deletedBy?: string | null;
}

/** Model-provider config as stored server-side (includes the secret key). */
export interface AiProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoning: boolean; // reasoning model — gets a larger output budget
  kbOnly: boolean; // answer strictly from the knowledge base
  apiKey: string;
}
/** Client-facing provider status — identical but with the key replaced by a flag. */
export interface AiProvider {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoning: boolean;
  kbOnly: boolean;
  hasKey: boolean;
}

/** SMTP config as stored server-side (includes the secret password). */
export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // implicit TLS (port 465)
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  publicUrl: string; // base URL for links in emails, e.g. http://localhost:4011
}
/** Client-facing SMTP settings — the password is replaced by a flag. */
export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  publicUrl: string;
  hasPass: boolean;
}
export interface Contact {
  id: string; name: string; email: string; company: string | null;
  avatarHue: number; location: string | null; timezone: string | null; createdAt: string;
  mrr: number | null;
}
export type AgentStatus = 'active' | 'invited';
export interface Agent {
  id: string; name: string; email: string; avatarHue: number; role: 'admin' | 'agent';
  status: AgentStatus; inviteToken: string | null; signature: string;
}
/**
 * Optional ticket mutations a canned reply applies when inserted, turning it
 * into a macro. Any subset may be present; an empty/absent object is a plain
 * canned reply.
 */
export interface MacroActions {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignToMe?: boolean;
  addTags?: string[];
}
export interface CannedReply { id: string; title: string; body: string; actions: MacroActions | null; }

export type DealType = 'expansion' | 'retention' | 'inbound';
export type DealStage = 'open' | 'won' | 'lost';

export interface Deal {
  id: string; title: string; type: DealType; stage: DealStage;
  value: number; currency: string;
  contactId: string; ticketId: string | null; ownerId: string;
  note: string; createdAt: string; closedAt: string | null; updatedAt: string;
}

export interface RevenueStats {
  wonLast7Days: number; wonThisMonth: number; openPipeline: number;
  savedRevenue: number; winRate: number;
  wonByType: Record<DealType, number>;
  wonLast14Days: { date: string; count: number; value: number }[];
}

export type DealCreate = {
  title: string; type: DealType; value: number; contactId: string;
  ticketId?: string | null; ownerId?: string; note?: string;
};
export type DealPatch = Partial<Pick<Deal, 'title' | 'type' | 'stage' | 'value' | 'ownerId' | 'note'>>;

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
  revenue: RevenueStats;
  csat: CsatStats;
}
export type TicketPatch = Partial<Pick<Ticket,
  'status' | 'priority' | 'assigneeId' | 'tags' | 'bucket' | 'snoozedUntil' | 'subject' | 'customFields'>>;

/** A named, pinned inbox filter. */
export interface SavedView {
  id: string; name: string; view: ViewId;
  priority: TicketPriority | null; assigneeId: string | null; tag: string | null;
}

/**
 * An @mention alert for one agent. Stored with raw ids; actorName and
 * ticketSubject are resolved at read time so renames stay accurate.
 */
export interface Notification {
  id: string; agentId: string; ticketId: string; ticketSubject: string;
  messageId: string; actorId: string; actorName: string; snippet: string;
  createdAt: string; readAt: string | null;
}

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; currentAgentId: string; deals: Deal[];
  sla: SlaTargets; automation: AutomationRule[]; kb: KbArticle[];
  aiAgents: AiAgent[]; aiActions: AiAction[]; channels: PublicChannel[];
  slaHours: SlaHours;
  aiProvider: AiProvider;
  smtp: SmtpSettings;
  notifications: Notification[];
  customFields: CustomFieldDef[];
  savedViews: SavedView[];
}
