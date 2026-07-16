export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TicketBucket = 'inbox' | 'archive' | 'spam' | 'trash';
export type Channel = 'email' | 'chat' | 'web' | 'api';
export type ViewId =
  | 'all' | 'unassigned' | 'mine' | 'awaiting' | 'snoozed'
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
  /** Customer satisfaction rating (1–5) captured from the portal. */
  satisfactionScore?: number | null;
  satisfactionComment?: string | null;
  satisfactionAt?: string | null;
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date';
export type CustomFieldEntity = 'ticket' | 'contact';
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
export interface ChannelConn {
  id: string; type: ChannelType; name: string; enabled: boolean;
  inboundToken: string; address: string | null; createdAt: string;
  /** Where agent replies are delivered (Discord/Slack webhook URL, or a relay endpoint). */
  outboundUrl: string | null;
  /** Whether an outbound auth token is stored server-side (the value never reaches the client). */
  hasOutboundSecret: boolean;
  /** Whether an inbound HMAC signing secret is stored server-side. */
  hasInboundSecret: boolean;
}
export type ChannelCreate = {
  type: ChannelType; name: string; address?: string;
  outboundUrl?: string; outboundSecret?: string; inboundSecret?: string;
};
export type ChannelPatch =
  Partial<Pick<ChannelConn, 'name' | 'enabled' | 'address' | 'outboundUrl'>>
  & { outboundSecret?: string | null; inboundSecret?: string | null };
/** Result of an outbound channel test send. */
export type ChannelTestResult = { ok: boolean; status?: number; error?: string };

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
  timezone: string;
  days: number[];
  start: string;
  end: string;
}

export type SlaState = 'met' | 'breached' | 'due_soon' | 'on_track' | 'paused';
export interface TicketSla {
  state: SlaState;
  label: string;
  clock: 'first_response' | 'resolution' | 'done';
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
export type ArticleCreate = { title: string; category: string; body: string; status?: ArticleStatus };
export type ArticlePatch = Partial<Pick<KbArticle, 'title' | 'category' | 'body' | 'status'>>;

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
  promptTokens: number; completionTokens: number;
  createdAt: string; resolvedAt: string | null;
}
export type AiAgentCreate = { name: string; autonomy: Autonomy; scopeTags?: string[]; scopePriorities?: TicketPriority[]; scopeCategories?: string[] };
export type AiAgentPatch = Partial<Pick<AiAgent, 'name' | 'enabled' | 'autonomy' | 'scopeTags' | 'scopePriorities' | 'scopeCategories'>>;

/** A branching intake form: the decision tree a customer walks to open a ticket. */
export interface IntakeOption {
  id: string;
  label: string;
  /** id of the next node to ask, or null to finish. */
  next: string | null;
  /** Sets/overrides the ticket category when chosen (null = leave as-is). */
  category: string | null;
  tags: string[];
}
export interface IntakeNode {
  id: string;
  prompt: string;
  options: IntakeOption[];
}
export interface IntakeForm {
  enabled: boolean;
  rootId: string | null;
  nodes: Record<string, IntakeNode>;
}
/** One answered question captured when a ticket is opened via the intake form. */
export interface IntakeAnswer { prompt: string; label: string; }

/** A reply or note queued to post to a ticket at a future time. */
export interface ScheduledMessage {
  id: string;
  ticketId: string;
  authorId: string;
  kind: 'reply' | 'note';
  body: string;
  sendAt: string;
  createdAt: string;
}

/** Community forum (mirrors the server types). */
export const FORUM_CATEGORIES = ['general', 'how-to', 'tips', 'bugs', 'feature-requests'] as const;
export type ForumCategory = (typeof FORUM_CATEGORIES)[number];

export interface ForumReply {
  id: string;
  topicId: string;
  authorId: string;
  authorName: string;
  authorIsAgent: boolean;
  body: string;
  accepted: boolean;
  createdAt: string;
}

export interface ForumTopic {
  id: string;
  category: ForumCategory;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  authorIsAgent: boolean;
  pinned: boolean;
  locked: boolean;
  solved: boolean;
  replyCount: number;
  views: number;
  createdAt: string;
  lastActivityAt: string;
}

export interface ForumTopicDetail extends ForumTopic {
  replies: ForumReply[];
}

export interface ForumList {
  topics: ForumTopic[];
  categories: readonly ForumCategory[];
}

/** Ticket knowledge graph: a category → sub-category → ticket hierarchy. */
export interface GraphSub {
  name: string;
  count: number;
}
export interface GraphTaxonomyNode {
  name: string;
  count: number;
  subs: GraphSub[];
}
export interface GraphHub {
  key: string;
  label: string;
  count: number;
  /** Index into the colour palette. */
  colorKey: number;
}
export interface GraphLeaf {
  key: string;
  label: string;
  /** Key of the hub this leaf hangs off. */
  hub: string;
  kind: 'sub' | 'ticket';
  category: string;
  sub: string;
  ticketId?: string;
  number?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
}
export interface TicketGraph {
  /** The full two-level tree, for the tabs — present at every drill level. */
  taxonomy: GraphTaxonomyNode[];
  level: 0 | 1 | 2;
  focus: { category: string | null; sub: string | null };
  hubs: GraphHub[];
  leaves: GraphLeaf[];
  total: number;
  shown: number;
}

/** Model-provider status as seen by the client — never carries the API key. */
export interface AiProvider {
  enabled: boolean;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoning: boolean;
  kbOnly: boolean;
  hasKey: boolean;
  /** Masked preview of the stored key, e.g. "sk-…4a2" — null when none. */
  keyHint: string | null;
}
/** Provider fields to update. A blank/omitted apiKey keeps the stored key; removeKey clears it. */
export type AiProviderSave = {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  reasoning?: boolean;
  kbOnly?: boolean;
  apiKey?: string;
  removeKey?: boolean;
};
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
/** SMTP fields to update. `pass` omitted keeps the stored password; '' clears it. */
export type SmtpSave = Partial<Omit<SmtpSettings, 'hasPass'>> & { pass?: string };
export interface SmtpTestResult { ok: boolean; to?: string; error?: string }

export interface AiTestResult { ok: boolean; model?: string; latencyMs?: number; error?: string; empty?: boolean }
export type AiSource = 'model' | 'rules';
export interface TokenUsage { promptTokens: number; completionTokens: number }
/** `reason`/`fallbackReason` explains a rule-based fallback: 'off' (AI not set up) or a provider error. */
export interface DraftResult { body: string; source: AiSource; usage: TokenUsage; reason?: string }
export interface CopilotTriage { priority: TicketPriority | null; tags: string[]; reason: string; source: AiSource; usage: TokenUsage; fallbackReason?: string }
export interface SummaryResult { summary: string; source: AiSource; usage: TokenUsage; reason?: string }
export interface Attachment {
  id: string; messageId: string | null; ticketId: string | null;
  filename: string; mimeType: string; size: number; createdAt: string;
}
/** Highlighter colors an agent can apply to words in a cited passage. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
/** A highlighted character range [start, end) within a citation's passage. */
export interface CitationHighlight { start: number; end: number; color: HighlightColor; }
/** A cited knowledge-base passage carried by a message as a structured card. */
export interface KbCitation {
  type: 'kb_citation';
  articleId: string;
  title: string;
  category: string | null;
  slug: string;
  passage: string;
  /** Agent-applied highlight ranges over `passage` (sorted, non-overlapping); omitted when none. */
  highlights?: CitationHighlight[];
}
/** How a choice prompt's options are presented to the customer. */
export type ChoiceLayout = 'buttons' | 'dropdown';
/** One selectable option in a choice prompt. */
export interface ChoiceOption { id: string; label: string; }
/** The customer's selection on a choice prompt, recorded when they pick. */
export interface ChoiceAnswer { optionIds: string[]; at: string; }
/** An interactive question an agent asks the customer, answered by tapping a button or picking from a dropdown. */
export interface ChoicePrompt {
  type: 'choice_prompt';
  question: string;
  layout: ChoiceLayout;
  options: ChoiceOption[];
  /** The customer's pick once made; absent/null until answered. */
  answer?: ChoiceAnswer | null;
}
/** An automatic "we're outside working hours" card, carrying the next opening
 *  instant so the client can show a live countdown to reopening. */
export interface OutsideHours { type: 'outside_hours'; message: string; nextOpenAt: string | null; }
/** A structured card attached to a message (rendered as its own block, not part of the body). */
export type MessageEmbed = KbCitation | ChoicePrompt | OutsideHours;
export interface Message {
  id: string; ticketId: string;
  authorKind: 'contact' | 'agent'; authorId: string;
  kind: 'reply' | 'note'; body: string; at: string;
  attachments?: Attachment[];
  /** Structured cards (e.g. KB citations) shown beneath the body; omitted when none. */
  embeds?: MessageEmbed[];
  /** Soft-delete tombstone: who removed the message and when. */
  deletedAt?: string | null;
  deletedBy?: string | null;
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
  /** Languages this agent speaks; a ticket detected in one routes to a speaker when possible. */
  languages: string[];
}
export type AgentInvite = { name: string; email: string; role: 'admin' | 'agent' };
export type AgentPatch = Partial<Pick<Agent, 'name' | 'role' | 'signature' | 'categories' | 'languages'>>;
/** Ticket mutations a canned reply applies when inserted, making it a macro. */
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

export type ReportMetric = 'volume' | 'solved' | 'resolution' | 'csat';
export type ReportDimension = 'day' | 'agent' | 'priority' | 'status' | 'category' | 'tag';
export type ReportRange = 'last_7' | 'last_14' | 'last_30' | 'all';
export interface CustomReport {
  id: string;
  name: string;
  metric: ReportMetric;
  dimension: ReportDimension;
  range: ReportRange;
}

// --- Public status page ---
export type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
export interface StatusComponent { id: string; name: string; status: ComponentStatus; position: number; }
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentImpact = 'minor' | 'major' | 'critical' | 'maintenance';
export interface IncidentUpdate { at: string; status: IncidentStatus; body: string; }
export interface StatusIncident {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  createdAt: string;
  resolvedAt: string | null;
  updates: IncidentUpdate[];
}
export interface StatusPageData { components: StatusComponent[]; incidents: StatusIncident[]; }

// --- Portal announcements ---
export type AnnouncementLevel = 'info' | 'warning' | 'critical';
export interface Announcement { id: string; body: string; level: AnnouncementLevel; active: boolean; createdAt: string; }

// --- White-label branding ---
export interface Branding { productName: string; accentColor: string; }

export type DealType = 'expansion' | 'retention' | 'inbound';
export type DealStage = 'open' | 'won' | 'lost';

export interface Deal {
  id: string; title: string; type: DealType; stage: DealStage;
  value: number; currency: string;
  contactId: string; ticketId: string | null; ownerId: string;
  note: string; createdAt: string; closedAt: string | null; updatedAt: string;
}

export interface AccountHealth {
  company: string; contactIds: string[]; mrr: number;
  openTickets: number; urgentOpen: number;
  wonValue: number; openPipeline: number;
  openExpansion: number; openRetention: number;
  status: 'at_risk' | 'expansion_ready' | 'healthy';
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
  all: number; unassigned: number; mine: number; awaiting: number; snoozed: number;
  open: number; pending: number; on_hold: number; solved: number; closed: number;
  archive: number; spam: number; trash: number;
}
export interface PerAgentPerformance {
  agentId: string;
  solved: number;
  openLoad: number;
  firstReplyCount: number;
  medianFirstReplyMinutes: number;
  medianResolutionHours: number;
  csatCount: number;
  csatAverage: number;
}

export interface StatsOverview {
  createdLast14Days: { date: string; count: number }[];
  solvedLast14Days: { date: string; count: number }[];
  byPriority: Record<TicketPriority, number>;
  byStatus: Record<TicketStatus, number>;
  perAgentOpen: { agentId: string; count: number }[];
  perAgentPerformance: PerAgentPerformance[];
  topTags: { tag: string; count: number }[];
  byCategory: { category: string; count: number }[];
  forecastNext7Days: { date: string; count: number }[];
  medianFirstReplyMinutes: number;
  medianResolutionHours: number;
  openNow: number; createdLast7Days: number; solvedLast7Days: number;
  revenue: RevenueStats;
  csat: CsatStats;
}
export interface CsatStats {
  count: number;
  average: number;
  positivePct: number;
}
export interface SavedView {
  id: string; name: string; view: ViewId;
  priority: TicketPriority | null; assigneeId: string | null; tag: string | null;
}
export type SavedViewCreate = Omit<SavedView, 'id'>;

export type TicketEventKind = 'created' | 'status' | 'priority' | 'assignee' | 'tags' | 'merged' | 'link' | 'split' | 'approval';
/** A structured change on a ticket's activity timeline. actorName null = automation/system. */
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
  linkId: string;
  ticketId: string;
  number: number;
  subject: string;
  status: TicketStatus;
  type: TicketLinkType;
}

export interface SideMessage {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  at: string;
}
export interface SideConversation {
  id: string;
  ticketId: string;
  subject: string;
  participant: string | null;
  createdAt: string;
  messages: SideMessage[];
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export interface TicketApproval {
  id: string;
  ticketId: string;
  requestedById: string;
  requestedByName: string | null;
  approverId: string | null;
  approverName: string | null;
  reason: string;
  status: ApprovalStatus;
  decidedById: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** An @mention alert for the current agent. */
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

/** Admin-auth status for the current agent (drives the client login gate). */
export interface AuthStatus {
  enabled: boolean;
  hasPassword: boolean;
  totpEnabled: boolean;
}

/** One day's opening window in 24h "HH:MM"; a null day means closed. */
export interface DayHours { open: string; close: string; }
/** Opening hours — used to auto-reply when a customer writes in while closed. */
export interface BusinessHours {
  enabled: boolean;
  timezone: string; // IANA zone, e.g. "America/New_York"
  message: string; // shown to customers who write in outside hours ({{name}}/{{number}} supported)
  days: (DayHours | null)[]; // length 7, index 0 = Sunday; null = closed that day
}

/** Master switches for AI that would otherwise run on its own — all default OFF. */
export interface AiAutomation {
  autoSuggest: boolean;
  autoResolve: boolean;
  autoTriage: boolean;
}

export type OnCallCadence = 'daily' | 'weekly';
export interface OnCallConfig {
  enabled: boolean;
  cadence: OnCallCadence;
  startDate: string;
  rotation: string[];
}

export interface HandoverNote {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** A time-based rule: run actions once when a ticket sits in a state for `hours`. */
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

export type ImportType = 'contacts' | 'tickets';
export interface ImportField { key: string; label: string; required: boolean }
export interface ImportInput { type: ImportType; csv: string; mapping?: Record<string, string>; dryRun?: boolean }
/** Result of a CSV import (or dry-run preview). `error` is set when a required column is unmapped. */
export interface ImportResult {
  type: ImportType;
  headers: string[];
  mapping: Record<string, string>;
  fields: ImportField[];
  rowCount: number;
  dryRun: boolean;
  created: number;
  skippedCount: number;
  errorCount: number;
  skipped: { row: number; reason: string }[];
  errors: { row: number; reason: string }[];
  error?: string;
}
export type TicketPatch = Partial<Pick<Ticket,
  'status' | 'priority' | 'assigneeId' | 'tags' | 'bucket' | 'snoozedUntil' | 'subject' | 'customFields'>>;
