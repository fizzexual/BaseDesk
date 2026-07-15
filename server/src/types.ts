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
  /** True when the customer sent the last public reply and support hasn't answered yet. */
  awaitingReply: boolean;
  /** Values for admin-defined custom fields, keyed by field id. */
  customFields: Record<string, string>;
  /** The type the customer picked in the intake form (routing + filtering); null if none. */
  category: string | null;
  /** Customer satisfaction rating (1–5), set from the portal on a solved/closed ticket. */
  satisfactionScore?: number | null;
  satisfactionComment?: string | null;
  satisfactionAt?: string | null;
}

/**
 * A branching intake form: a decision tree the customer walks when opening a
 * ticket. Each option either ends the branch or points to a follow-up question,
 * and can set the ticket's category and/or add tags.
 */
export interface IntakeOption {
  id: string;
  label: string;
  /** id of the next node to ask, or null to finish. */
  next: string | null;
  /** Sets/overrides the ticket category when this option is chosen (null = leave as-is). */
  category: string | null;
  /** Tags added to the ticket when this option is chosen. */
  tags: string[];
}
export interface IntakeNode {
  id: string;
  prompt: string;
  options: IntakeOption[];
}
export interface IntakeForm {
  enabled: boolean;
  /** The first question shown; null means the form is empty. */
  rootId: string | null;
  nodes: Record<string, IntakeNode>;
}
/** One answered question captured from the intake form, stored as ticket metadata. */
export interface IntakeAnswer { prompt: string; label: string; }

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
export type AutomationActionType = 'set_priority' | 'add_tag' | 'assign' | 'set_status' | 'set_category';
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
  /** Ticket categories this AI agent works; empty = all categories. */
  scopeCategories: string[];
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
  /** A safe masked preview of the stored key, e.g. "sk-…4a2" — null when none. */
  keyHint: string | null;
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
  /** Ticket categories this agent handles; new tickets in these route to them. Empty = all. */
  categories: string[];
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

/** A reusable starting point for a new ticket — prefills subject/body/priority and applies a category + tags. */
export interface TicketTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  priority: TicketPriority;
  category: string | null;
  tags: string[];
}

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

export type TicketEventKind = 'created' | 'status' | 'priority' | 'assignee' | 'tags' | 'merged' | 'link' | 'split' | 'approval';
/**
 * A structured change to a ticket, for its activity timeline. actorName is
 * resolved at read time (null = a system/automation action). `detail` holds the
 * change: {} for created, { from, to } for scalar fields, { added, removed } for
 * tags, { targetNumber } for a merge, { targetNumber, linkType } for a link,
 * { targetNumber, count } for a split.
 */
export interface TicketEvent {
  id: string; ticketId: string; kind: TicketEventKind;
  actorId: string | null; actorName: string | null;
  detail: Record<string, unknown>;
  at: string;
}

/** A ticket event widened with its ticket's number and subject, for the global audit log. */
export interface AuditEvent extends TicketEvent {
  ticketNumber: number;
  ticketSubject: string;
}

/** When a participant (agent or the customer) last viewed a ticket's thread. */
export interface TicketSeen {
  viewerId: string;
  viewerKind: 'agent' | 'contact';
  at: string;
}

/** An agent watching a ticket for activity even when they aren't the assignee. */
export interface TicketFollower {
  agentId: string;
  name: string;
  avatarHue: number;
  at: string;
}

/** One checklist item on a ticket — a sub-step an agent works through to resolve it. */
export interface TicketTask {
  id: string;
  ticketId: string;
  title: string;
  done: boolean;
  position: number;
  createdAt: string;
  doneAt: string | null;
}

/** A typed link to another ticket, phrased from the current ticket's perspective. */
export type TicketLinkType = 'related' | 'blocks' | 'blocked_by' | 'duplicate_of' | 'duplicated_by';
export interface TicketLink {
  linkId: string; // the underlying row id (used to remove the link)
  ticketId: string; // the OTHER ticket
  number: number;
  subject: string;
  status: TicketStatus;
  type: TicketLinkType;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
/** A request for sign-off on a ticket action (e.g. a refund). Names resolve at read time. */
export interface TicketApproval {
  id: string;
  ticketId: string;
  requestedById: string;
  requestedByName: string | null;
  approverId: string | null; // null = anyone on the team can decide
  approverName: string | null;
  reason: string;
  status: ApprovalStatus;
  decidedById: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/**
 * An @mention alert for one agent. Stored with raw ids; actorName and
 * ticketSubject are resolved at read time so renames stay accurate.
 */
/** What happened: a teammate @mentioned you, a customer replied, or a ticket was assigned to you. */
export type NotificationKind = 'mention' | 'reply' | 'assigned';
export interface Notification {
  id: string; agentId: string; ticketId: string; ticketSubject: string;
  messageId: string; actorId: string; actorName: string; snippet: string;
  /** The event type and the channel the ticket came in on ("from where"). */
  kind: NotificationKind; channel: Channel;
  createdAt: string; readAt: string | null;
}

/** How new unassigned tickets are routed to agents. */
export interface AssignmentSettings {
  enabled: boolean;
  strategy: 'round_robin' | 'least_busy';
}

/** An automatic first reply sent the moment a ticket is opened. */
export interface AutoAck {
  enabled: boolean;
  /** Body of the auto-reply; supports {{number}} and {{name}} placeholders. */
  message: string;
}

/**
 * A time-based rule: when a ticket has sat in a given state for `hours`, run its
 * actions once. Powers SLA escalations and stale-ticket cleanup.
 * - awaiting_first_response: opened but no agent has replied yet.
 * - awaiting_reply: the customer is waiting on us (last reply was theirs).
 * - awaiting_customer: we're waiting on the customer (last reply was ours).
 */
export type TimeTrigger = 'awaiting_first_response' | 'awaiting_reply' | 'awaiting_customer';
export interface TimeRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TimeTrigger;
  hours: number;
  actions: AutomationAction[];
}

/** Aggregate AI token spend across every recorded model call. */
export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  generations: number;
}

/** The provider's live model list, cached by the daily/bootup refresher. */
export interface ModelCache { baseUrl: string; models: string[]; fetchedAt: string }

export interface BootstrapData {
  tickets: Ticket[]; contacts: Contact[]; agents: Agent[];
  canned: CannedReply[]; templates: TicketTemplate[]; currentAgentId: string; deals: Deal[];
  sla: SlaTargets; automation: AutomationRule[]; kb: KbArticle[];
  aiAgents: AiAgent[]; aiActions: AiAction[]; aiUsage: AiUsage; channels: PublicChannel[];
  availableModels: ModelCache | null;
  slaHours: SlaHours;
  aiProvider: AiProvider;
  smtp: SmtpSettings;
  notifications: Notification[];
  customFields: CustomFieldDef[];
  savedViews: SavedView[];
  assignment: AssignmentSettings;
  autoAck: AutoAck;
  timeRules: TimeRule[];
  intakeForm: IntakeForm;
  /** Distinct categories defined across the intake form, for coverage pickers. */
  categories: string[];
}
