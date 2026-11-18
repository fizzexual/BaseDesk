import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, Agent, AgentInvite,
  AgentPatch, ArticleCreate, ArticlePatch, ArticleStatus, AutomationCondition, AutomationRule, CannedReply,
  Attachment, Channel, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult, Contact, CopilotTriage, CustomFieldCreate, CustomFieldDef, CustomFieldPatch, SavedView, SavedViewCreate, Deal, DealCreate, DealPatch, DealStage, DealType,
  AssignmentSettings, AuditEvent, AutoAck, BusinessHours, ScheduledMessage, ChoiceOption, DraftResult, ImportInput, ImportResult, ImportType, IntakeAnswer, IntakeForm, KbArticle, Message, MessageEmbed, Notification, SlaHours, SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, StatsOverview, TimeRule,
  AiAutomation, Announcement, Branding, ApprovalStatus, CustomReport, ComponentStatus, IncidentImpact, IncidentStatus, StatusComponent, StatusIncident, StatusPageData, HandoverNote, OnCallConfig, SideConversation, SummaryResult, Ticket, TicketApproval, TicketEvent, TicketSeen, TicketFollower, TicketTask, TicketTemplate, TicketLink, TicketLinkType, TicketPatch, TicketPriority, TicketStatus,
  ForumCategory, ForumList, ForumTopicDetail,
} from './types';
import { FORUM_CATEGORIES } from './types';
import { autoMapColumns, IMPORT_EMAIL_RE, IMPORT_FIELDS, parseCsv, toCsv } from './import';
import type { BootstrapData, Repository } from './repository';
import { normalizeHighlights } from './citationHighlight';
import { registerLocalAttachment } from './attachments';
import { computeRevenue } from './deal-stats';
import { DEFAULT_AI_AUTOMATION, DEFAULT_AI_PROVIDER, DEFAULT_AUTO_ACK, DEFAULT_AUTOMATION, DEFAULT_BUSINESS_HOURS, DEFAULT_ON_CALL, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, DEFAULT_SMTP, DEFAULT_TICKET_TEMPLATES, DEFAULT_TIME_RULES, normalizeAutomation } from './defaults';
import { draftReply, runAgent, suggestTriage, summarizeThread } from '../features/ai/engine';
import seedJson from '../../../shared/seed.json';

const AUTONOMY_RANK: Record<string, number> = { resolve: 3, draft: 2, suggest: 1 };

const RESOLVED: TicketStatus[] = ['solved', 'closed'];
const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const AUTO_STATUSES: TicketStatus[] = ['open', 'pending', 'on_hold', 'solved', 'closed'];

/** Fields automation reads and may mutate on a freshly created ticket. */
interface AutoMut {
  subject: string; priority: TicketPriority; tags: string[];
  assigneeId: string | null; status: TicketStatus; category: string | null;
}
interface AutoCtx { body: string; channelType: string; from: string; }

function evalCondition(cond: AutomationCondition, mut: AutoMut, ctx: AutoCtx): boolean {
  const v = cond.value.toLowerCase();
  switch (cond.type) {
    case 'subject_contains': return mut.subject.toLowerCase().includes(v);
    case 'body_contains': return ctx.body.toLowerCase().includes(v);
    case 'priority_is': return mut.priority === cond.value;
    case 'channel_is': return ctx.channelType === cond.value;
    case 'from_contains': return ctx.from.toLowerCase().includes(v);
    default: return false;
  }
}

/** Mirrors the server's runAutomation — multi-condition, multi-action rules. */
function applyAutomationLocal(rules: AutomationRule[], mut: AutoMut, ctx: AutoCtx): void {
  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue;
    const results = rule.conditions.map((c) => evalCondition(c, mut, ctx));
    const ok = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (!ok) continue;
    for (const action of rule.actions) {
      if (action.type === 'set_priority' && PRIORITIES.includes(action.value as TicketPriority)) {
        mut.priority = action.value as TicketPriority;
      } else if (action.type === 'add_tag') {
        if (!mut.tags.includes(action.value)) mut.tags.push(action.value);
      } else if (action.type === 'assign') {
        mut.assigneeId = action.value;
      } else if (action.type === 'set_status' && AUTO_STATUSES.includes(action.value as TicketStatus)) {
        mut.status = action.value as TicketStatus;
      } else if (action.type === 'set_category') {
        mut.category = action.value.trim() === '' ? null : action.value;
      }
    }
  }
}

const STORAGE_KEY = 'basedesk-data-v1';
const CURRENT_AGENT_ID = 'a_1';
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface StorageLike {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

interface LocalData {
  tickets: Ticket[];
  messages: Message[];
  contacts: Contact[];
  agents: Agent[];
  canned: CannedReply[];
  deals: Deal[];
  sla: SlaTargets;
  slaHours: SlaHours;
  automation: AutomationRule[];
  kb: KbArticle[];
  aiAgents: AiAgent[];
  aiActions: AiAction[];
  channels: ChannelConn[];
  aiProvider: AiProvider;
  smtp: SmtpSettings;
  customFields: CustomFieldDef[];
  attachments: Attachment[];
  savedViews: SavedView[];
  intakeForm: IntakeForm;
  notifications: Notification[];
  assignment: AssignmentSettings;
  assignmentRr: number; // round-robin cursor
  autoAck: AutoAck;
  businessHours: BusinessHours;
  scheduled: ScheduledMessage[];
  aiAutomation: AiAutomation;
  onCall: OnCallConfig;
  timeRules: TimeRule[];
  events: TicketEvent[];
  templates: TicketTemplate[];
  customReports: CustomReport[];
  announcements: Announcement[];
  branding: Branding;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const DEAL_TYPES: DealType[] = ['expansion', 'retention', 'inbound'];
const DEAL_STAGES: DealStage[] = ['open', 'won', 'lost'];

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem(STORAGE_KEY); // probe: Node's stub throws without a backing file
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => localStorage.setItem(k, v),
      };
    }
  } catch {
    // fall through to in-memory storage
  }
  const mem = new Map<string, string>();
  return {
    get: (k) => mem.get(k) ?? null,
    set: (k, v) => {
      mem.set(k, v);
    },
  };
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Random lowercase-hex token of `len` characters, for demo-mode invite links. */
function randomToken(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

/** First 90 chars of the body with all whitespace collapsed to single spaces. */
function preview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Least-squares linear fit over `counts`, projected `ahead` steps forward (clamped to ≥ 0). Mirrors the server. */
function linearForecast(counts: number[], ahead: number): number[] {
  const n = counts.length;
  if (n === 0) return Array<number>(ahead).fill(0);
  const meanX = (n - 1) / 2;
  const meanY = counts.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (counts[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: ahead }, (_, i) => Math.max(0, Math.round(intercept + slope * (n + i))));
}

/** Next sequential id for a `prefix`-style id family (e.g. t_125, m_00395). */
function nextId(items: { id: string }[], prefix: string, width: number): string {
  let max = 0;
  for (const item of items) {
    if (!item.id.startsWith(prefix)) continue;
    const n = Number(item.id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(width, '0');
}

/** Demo intake form (the server ships its own default; this mirrors it for the static demo). */
const DEFAULT_INTAKE_FORM: IntakeForm = {
  enabled: true,
  rootId: 'n_type',
  nodes: {
    n_type: {
      id: 'n_type',
      prompt: 'What do you need help with?',
      options: [
        { id: 'o_tech', label: 'Technical issue', next: 'n_tech', category: 'Technical', tags: [] },
        { id: 'o_bug', label: 'Report a bug', next: 'n_server', category: 'Bug', tags: [] },
        { id: 'o_abuse', label: 'Report a player', next: 'n_server', category: 'Abuse', tags: [] },
        { id: 'o_billing', label: 'Billing & purchases', next: null, category: 'Billing', tags: [] },
      ],
    },
    n_tech: {
      id: 'n_tech',
      prompt: 'What kind of technical issue?',
      options: [
        { id: 'o_login', label: "Can't log in", next: null, category: null, tags: ['login'] },
        { id: 'o_lag', label: 'Lag or disconnects', next: 'n_server', category: null, tags: ['performance'] },
        { id: 'o_other', label: 'Something else', next: null, category: null, tags: [] },
      ],
    },
    n_server: {
      id: 'n_server',
      prompt: 'Which server is it on?',
      options: [
        { id: 'o_sky', label: 'Skyblock', next: null, category: null, tags: ['skyblock'] },
        { id: 'o_surv', label: 'Survival', next: null, category: null, tags: ['survival'] },
        { id: 'o_creative', label: 'Creative', next: null, category: null, tags: ['creative'] },
      ],
    },
  },
};

/** Distinct category names any option assigns across the tree. */
export function categoriesFromForm(form: IntakeForm): string[] {
  const set = new Set<string>();
  for (const node of Object.values(form.nodes)) {
    for (const opt of node.options) if (opt.category != null && opt.category.trim() !== '') set.add(opt.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function seedData(): LocalData {
  const seed = seedJson as unknown as LocalData;
  return {
    tickets: seed.tickets.map((t) => ({ ...t, tags: [...t.tags], mergedIntoId: t.mergedIntoId ?? null, awaitingReply: t.awaitingReply ?? false, customFields: { ...(t.customFields ?? {}) }, category: t.category ?? null })),
    messages: seed.messages.map((m) => ({ ...m })),
    contacts: seed.contacts.map((c) => ({ ...c })),
    agents: seed.agents.map((a) => ({ ...a, categories: a.categories ?? [], languages: a.languages ?? [] })),
    canned: seed.canned.map((c) => ({ ...c, actions: c.actions ?? null })),
    deals: seed.deals.map((d) => ({ ...d })),
    sla: DEFAULT_SLA_TARGETS,
    slaHours: { ...DEFAULT_SLA_HOURS, days: [...DEFAULT_SLA_HOURS.days], holidays: [] },
    automation: DEFAULT_AUTOMATION.map((r) => ({ ...r })),
    kb: seed.kb.map((a) => ({ ...a })),
    aiAgents: seed.aiAgents.map((a) => ({ ...a, scopeCategories: a.scopeCategories ?? [] })),
    aiActions: seed.aiActions.map((a) => ({ ...a })),
    channels: seed.channels.map((c) => ({ ...c, outboundUrl: c.outboundUrl ?? null, hasOutboundSecret: c.hasOutboundSecret ?? false, hasInboundSecret: c.hasInboundSecret ?? false })),
    aiProvider: { ...DEFAULT_AI_PROVIDER },
    smtp: { ...DEFAULT_SMTP },
    customFields: (seed.customFields ?? []).map((f) => ({ ...f, options: [...f.options] })),
    attachments: [],
    savedViews: [],
    intakeForm: DEFAULT_INTAKE_FORM,
    assignment: { enabled: false, strategy: 'round_robin' },
    assignmentRr: 0,
    autoAck: { ...DEFAULT_AUTO_ACK },
    businessHours: { ...DEFAULT_BUSINESS_HOURS },
    scheduled: [],
    aiAutomation: { ...DEFAULT_AI_AUTOMATION },
    onCall: { ...DEFAULT_ON_CALL, rotation: [...DEFAULT_ON_CALL.rotation] },
    timeRules: DEFAULT_TIME_RULES.map((r) => ({ ...r, actions: r.actions.map((a) => ({ ...a })) })),
    events: [],
    templates: DEFAULT_TICKET_TEMPLATES.map((t) => ({ ...t, tags: [...t.tags] })),
    customReports: [],
    announcements: [],
    branding: { productName: 'BaseDesk', accentColor: '' },
    // Seed notifications ship without the joined display fields; resolve them here.
    notifications: (seed.notifications ?? []).map((n) => ({
      ...n,
      actorName: seed.agents.find((a) => a.id === n.actorId)?.name ?? 'A teammate',
      ticketSubject: seed.tickets.find((t) => t.id === n.ticketId)?.subject ?? '(ticket)',
      channel: (seed.tickets.find((t) => t.id === n.ticketId)?.channel ?? 'web') as Channel,
      kind: 'mention' as const,
    })),
  };
}

/**
 * Repository over a Storage-like key/value backend (localStorage in the browser,
 * an in-memory Map elsewhere). Seeds itself from shared/seed.json on first run
 * and mirrors the server's mutation semantics exactly.
 */
export class LocalRepository implements Repository {
  private readonly storage: StorageLike;
  private data: LocalData;
  private followers = new Map<string, TicketFollower[]>(); // demo-only, in-memory
  private tasks = new Map<string, TicketTask[]>(); // demo-only, in-memory
  private timeRuleFired = new Set<string>(); // `${ruleId}:${ticketId}` — demo-only, not persisted
  private links: { id: string; fromId: string; toId: string; type: string }[] = []; // demo-only, in-memory
  private approvals: {
    id: string; ticketId: string; requestedById: string; approverId: string | null; reason: string;
    status: ApprovalStatus; decidedById: string | null; decisionNote: string | null; createdAt: string; decidedAt: string | null;
  }[] = []; // demo-only, in-memory
  private statusComponents: StatusComponent[] = [
    { id: 'sc_api', name: 'API', status: 'operational', position: 0 },
    { id: 'sc_dashboard', name: 'Agent dashboard', status: 'operational', position: 1 },
    { id: 'sc_portal', name: 'Customer portal', status: 'operational', position: 2 },
    { id: 'sc_email', name: 'Email delivery', status: 'operational', position: 3 },
  ]; // demo-only, in-memory
  private statusIncidents: StatusIncident[] = [];
  private sideConvos: { id: string; ticketId: string; subject: string; participant: string | null; createdAt: string }[] = []; // demo-only
  private sideMsgs: { id: string; sideId: string; authorId: string; body: string; at: string }[] = []; // demo-only
  private handover: { id: string; authorId: string; body: string; createdAt: string }[] = []; // demo-only
  private forum: ForumTopicDetail[] | null = null; // demo-only, lazily seeded from the loaded contacts/agents

  constructor(storage?: StorageLike) {
    this.storage = storage ?? defaultStorage();
    const raw = this.storage.get(STORAGE_KEY);
    if (raw !== null) {
      this.data = JSON.parse(raw) as LocalData;
      // Backfill v0.2 fields for blobs written by v0.1.
      if (!Array.isArray(this.data.deals)) {
        const seed = seedJson as unknown as LocalData;
        const mrrByContact = new Map(seed.contacts.map((c) => [c.id, c.mrr ?? null]));
        this.data.deals = seed.deals.map((d) => ({ ...d }));
        for (const c of this.data.contacts) {
          if (c.mrr === undefined) c.mrr = mrrByContact.get(c.id) ?? null;
        }
        this.persist();
      }
      // Backfill v0.3 fields (SLA settings + per-ticket SLA timestamps).
      if (this.data.sla === undefined || this.data.automation === undefined) {
        this.data.sla = DEFAULT_SLA_TARGETS;
        this.data.automation = DEFAULT_AUTOMATION.map((r) => ({ ...r }));
        const firstAgentReply = new Map<string, string>();
        for (const m of [...this.data.messages].sort((a, b) => a.at.localeCompare(b.at))) {
          if (m.authorKind === 'agent' && m.kind === 'reply' && !firstAgentReply.has(m.ticketId)) {
            firstAgentReply.set(m.ticketId, m.at);
          }
        }
        for (const t of this.data.tickets) {
          if (t.firstRespondedAt === undefined) t.firstRespondedAt = firstAgentReply.get(t.id) ?? null;
          if (t.resolvedAt === undefined) t.resolvedAt = RESOLVED.includes(t.status) ? t.updatedAt : null;
        }
        this.persist();
      }
      // Backfill the knowledge base for blobs written before it existed.
      if (!Array.isArray(this.data.kb)) {
        this.data.kb = (seedJson as unknown as LocalData).kb.map((a) => ({ ...a }));
        this.persist();
      }
      // Backfill AI agents/actions for blobs written before v0.4.
      if (!Array.isArray(this.data.aiAgents) || !Array.isArray(this.data.aiActions)) {
        const seed = seedJson as unknown as LocalData;
        this.data.aiAgents = seed.aiAgents.map((a) => ({ ...a }));
        this.data.aiActions = seed.aiActions.map((a) => ({ ...a }));
        this.persist();
      }
      // Backfill channels + per-ticket channelId for blobs written before v0.4.
      if (!Array.isArray(this.data.channels)) {
        this.data.channels = (seedJson as unknown as LocalData).channels.map((ch) => ({ ...ch, outboundUrl: ch.outboundUrl ?? null, hasOutboundSecret: ch.hasOutboundSecret ?? false, hasInboundSecret: ch.hasInboundSecret ?? false }));
        for (const t of this.data.tickets) {
          if (t.channelId === undefined) t.channelId = t.channel === 'chat' ? 'ch_1' : t.channel === 'email' ? 'ch_2' : null;
        }
        this.persist();
      }
      // Backfill custom fields for blobs written before they existed.
      if (!Array.isArray(this.data.customFields)) {
        this.data.customFields = [];
        for (const t of this.data.tickets) {
          if (t.customFields === undefined) t.customFields = {};
        }
        this.persist();
      }
      // Backfill attachments store for blobs written before it existed.
      if (!Array.isArray(this.data.attachments)) {
        this.data.attachments = [];
        this.persist();
      }
      if (!Array.isArray(this.data.savedViews)) {
        this.data.savedViews = [];
        this.persist();
      }
      if (!Array.isArray(this.data.notifications)) {
        this.data.notifications = [];
        this.persist();
      }
      if (this.data.intakeForm === undefined || this.data.intakeForm === null) {
        this.data.intakeForm = DEFAULT_INTAKE_FORM;
        this.persist();
      }
      if (this.data.assignment === undefined) {
        this.data.assignment = { enabled: false, strategy: 'round_robin' };
        this.data.assignmentRr = 0;
        this.persist();
      }
      if (this.data.autoAck === undefined) {
        this.data.autoAck = { ...DEFAULT_AUTO_ACK };
        this.persist();
      }
      if (this.data.businessHours === undefined) {
        this.data.businessHours = { ...DEFAULT_BUSINESS_HOURS };
        this.persist();
      }
      if (this.data.scheduled === undefined) {
        this.data.scheduled = [];
        this.persist();
      }
      if (this.data.aiAutomation === undefined) {
        this.data.aiAutomation = { ...DEFAULT_AI_AUTOMATION };
        this.persist();
      }
      if (this.data.onCall === undefined) {
        this.data.onCall = { ...DEFAULT_ON_CALL, rotation: [...DEFAULT_ON_CALL.rotation] };
        this.persist();
      }
      if (this.data.timeRules === undefined) {
        this.data.timeRules = DEFAULT_TIME_RULES.map((r) => ({ ...r, actions: r.actions.map((a) => ({ ...a })) }));
        this.persist();
      }
      if (!Array.isArray(this.data.events)) {
        this.data.events = [];
        this.persist();
      }
      if (!Array.isArray(this.data.templates)) {
        this.data.templates = DEFAULT_TICKET_TEMPLATES.map((t) => ({ ...t, tags: [...t.tags] }));
        this.persist();
      }
      if (!Array.isArray(this.data.customReports)) {
        this.data.customReports = [];
        this.persist();
      }
      if (!Array.isArray(this.data.announcements)) {
        this.data.announcements = [];
        this.persist();
      }
      if (this.data.branding === undefined) {
        this.data.branding = { productName: 'BaseDesk', accentColor: '' };
        this.persist();
      }
      // Older demo data predates macro actions; default them to a plain reply.
      for (const c of this.data.canned) {
        if (c.actions === undefined) c.actions = null;
      }
      // Older demo tickets predate merge / awaiting-reply; default them.
      for (const t of this.data.tickets) {
        if (t.mergedIntoId === undefined) t.mergedIntoId = null;
        if (t.awaitingReply === undefined) t.awaitingReply = false;
      }
      // Backfill business-hours SLA + richer agent fields, and migrate v0.3
      // single-condition automation to the v0.4 multi-condition shape.
      if (this.data.slaHours === undefined) {
        this.data.slaHours = { ...DEFAULT_SLA_HOURS, days: [...DEFAULT_SLA_HOURS.days] };
        for (const a of this.data.agents) {
          if (a.status === undefined) a.status = 'active';
          if (a.inviteToken === undefined) a.inviteToken = null;
          if (a.signature === undefined) a.signature = '';
        }
        this.data.automation = normalizeAutomation(this.data.automation);
        this.persist();
      }
      if (!Array.isArray(this.data.slaHours.holidays)) this.data.slaHours.holidays = []; // saved before holidays existed
      // Backfill the AI provider status for blobs written before it existed.
      if (this.data.aiProvider === undefined) {
        this.data.aiProvider = { ...DEFAULT_AI_PROVIDER };
        this.persist();
      }
      // Backfill SMTP settings for blobs written before email notifications.
      if (this.data.smtp === undefined) {
        this.data.smtp = { ...DEFAULT_SMTP };
        this.persist();
      }
    } else {
      this.data = seedData();
      this.persist();
    }
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.data));
  }

  private ticket(id: string): Ticket {
    const t = this.data.tickets.find((x) => x.id === id);
    if (!t) throw new Error('Ticket not found');
    return t;
  }

  private deal(id: string): Deal {
    const d = this.data.deals.find((x) => x.id === id);
    if (!d) throw new Error('Deal not found');
    return d;
  }

  async bootstrap(): Promise<BootstrapData> {
    return {
      tickets: this.data.tickets.map((t) => this.stampAwaiting({ ...t, tags: [...t.tags] })),
      contacts: this.data.contacts.map((c) => ({ ...c })),
      agents: this.data.agents.map((a) => ({ ...a })),
      canned: this.data.canned.map((c) => ({ ...c })),
      templates: this.data.templates.map((t) => ({ ...t, tags: [...t.tags] })),
      customReports: this.data.customReports.map((r) => ({ ...r })),
      announcements: this.data.announcements.map((a) => ({ ...a })),
      branding: { ...this.data.branding },
      deals: [...this.data.deals]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((d) => ({ ...d })),
      currentAgentId: CURRENT_AGENT_ID,
      sla: this.data.sla,
      slaHours: { ...this.data.slaHours, days: [...this.data.slaHours.days], holidays: [...this.data.slaHours.holidays] },
      automation: this.data.automation.map((r) => ({ ...r })),
      kb: this.data.kb.map((a) => ({ ...a })),
      aiAgents: this.data.aiAgents.map((a) => ({ ...a })),
      aiActions: this.data.aiActions.map((a) => ({ ...a })),
      availableModels: null,
      aiUsage: this.data.aiActions.reduce(
        (acc, a) => {
          const tokens = a.promptTokens + a.completionTokens;
          return tokens > 0
            ? { promptTokens: acc.promptTokens + a.promptTokens, completionTokens: acc.completionTokens + a.completionTokens, generations: acc.generations + 1 }
            : acc;
        },
        { promptTokens: 0, completionTokens: 0, generations: 0 },
      ),
      channels: this.data.channels.map((ch) => ({ ...ch })),
      aiProvider: { ...this.data.aiProvider },
      smtp: { ...this.data.smtp },
      customFields: this.data.customFields.map((f) => ({ ...f, options: [...f.options] })),
      savedViews: this.data.savedViews.map((v) => ({ ...v })),
      notifications: [...this.data.notifications]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((n) => ({ ...n })),
      assignment: { ...this.data.assignment },
      autoAck: { ...this.data.autoAck },
      businessHours: { ...this.data.businessHours },
      auth: { enabled: false, hasPassword: false, totpEnabled: false },
      aiAutomation: { ...this.data.aiAutomation },
      onCall: { ...this.data.onCall, rotation: [...this.data.onCall.rotation] },
      timeRules: this.data.timeRules.map((r) => ({ ...r, actions: r.actions.map((a) => ({ ...a })) })),
      intakeForm: this.data.intakeForm,
      categories: categoriesFromForm(this.data.intakeForm),
    };
  }

  async saveIntakeForm(form: IntakeForm): Promise<IntakeForm> {
    this.data.intakeForm = form;
    this.persist();
    return form;
  }

  async listTickets(): Promise<Ticket[]> {
    return this.data.tickets.map((t) => this.stampAwaiting({ ...t, tags: [...t.tags] }));
  }

  async listNotifications(): Promise<Notification[]> {
    return [...this.data.notifications]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({ ...n }));
  }

  async getMessages(ticketId: string): Promise<Message[]> {
    return this.data.messages
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((m) => ({
        ...m,
        attachments: this.data.attachments.filter((a) => a.messageId === m.id).map((a) => ({ ...a })),
      }));
  }

  async deleteMessage(ticketId: string, messageId: string): Promise<Message> {
    const m = this.data.messages.find((x) => x.id === messageId && x.ticketId === ticketId);
    if (!m) throw new Error('Message not found');
    if (m.deletedAt === undefined || m.deletedAt === null) {
      m.deletedAt = new Date().toISOString();
      m.deletedBy = CURRENT_AGENT_ID;
    }
    this.persist();
    return { ...m, body: '', attachments: [] };
  }

  async uploadAttachment(file: File): Promise<Attachment> {
    const attachment: Attachment = {
      id: nextId(this.data.attachments, 'at_', 4),
      messageId: null,
      ticketId: null,
      filename: file.name || 'file',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date().toISOString(),
    };
    registerLocalAttachment(attachment.id, URL.createObjectURL(file));
    this.data.attachments.push(attachment);
    this.persist();
    return { ...attachment };
  }

  async createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority; category?: string | null; tags?: string[] }): Promise<{ ticket: Ticket; message: Message }> {
    const now = new Date().toISOString();
    const number = this.data.tickets.reduce((max, t) => Math.max(max, t.number), 0) + 1;
    // Optional starting category + tags (e.g. applied from a ticket template); automation rules run on top.
    const seedTags = [...new Set((input.tags ?? []).map((t) => t.trim()).filter((t) => t !== ''))];
    const seedCategory = typeof input.category === 'string' && input.category.trim() !== '' ? input.category.trim() : null;
    const shaped: AutoMut = { subject: input.subject, priority: input.priority, tags: seedTags, assigneeId: null, status: 'open', category: seedCategory };
    applyAutomationLocal(this.data.automation, shaped, { body: input.body, channelType: 'web', from: '' });
    const ticket: Ticket = {
      id: nextId(this.data.tickets, 't_', 3),
      number,
      subject: shaped.subject,
      status: shaped.status,
      priority: shaped.priority,
      bucket: 'inbox',
      requesterId: input.requesterId,
      assigneeId: shaped.assigneeId,
      tags: shaped.tags,
      channel: 'web',
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: preview(input.body),
      firstRespondedAt: null,
      resolvedAt: null,
      channelId: null,
      mergedIntoId: null,
      awaitingReply: true,
      customFields: {},
      category: shaped.category,
    };
    const message: Message = {
      id: nextId(this.data.messages, 'm_', 5),
      ticketId: ticket.id,
      authorKind: 'contact',
      authorId: input.requesterId,
      kind: 'reply',
      body: input.body,
      at: now,
    };
    this.data.tickets.push(ticket);
    this.data.messages.push(message);
    this.pushEvent(ticket.id, 'created', CURRENT_AGENT_ID, {}, now);
    this.runAgentsOnTicket(ticket, input.body);
    this.autoAssign(ticket);
    // Auto-acknowledgement: an instant first reply if enabled (doesn't stamp SLA).
    if (this.data.autoAck.enabled && this.data.autoAck.message.trim() !== '') {
      const author = ticket.assigneeId ?? this.data.agents.find((a) => a.status === 'active')?.id ?? null;
      if (author !== null) {
        const ackNow = new Date().toISOString();
        const first = (this.data.contacts.find((c) => c.id === input.requesterId)?.name ?? '').trim().split(/\s+/)[0] || 'there';
        const ackBody = this.data.autoAck.message.replaceAll('{{number}}', String(ticket.number)).replaceAll('{{name}}', first);
        this.data.messages.push({ id: nextId(this.data.messages, 'm_', 5), ticketId: ticket.id, authorKind: 'agent', authorId: author, kind: 'reply', body: ackBody, at: ackNow });
        ticket.lastMessageAt = ackNow;
        ticket.lastMessagePreview = preview(ackBody);
        ticket.updatedAt = ackNow;
      }
    }
    this.persist();
    return { ticket: this.stampAwaiting({ ...ticket, tags: [...ticket.tags] }), message: { ...message } };
  }

  /** Mirrors the server: awaiting a reply when the last public reply is the customer's. */
  private stampAwaiting(t: Ticket): Ticket {
    const last = this.data.messages
      .filter((m) => m.ticketId === t.id && m.kind === 'reply' && !m.deletedAt)
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1);
    return { ...t, awaitingReply: last !== undefined && last.authorKind === 'contact' };
  }

  /** Recompute stored derived fields from a ticket's current messages (mirrors the server after a split). */
  private recomputeDerived(t: Ticket): void {
    const msgs = this.data.messages.filter((m) => m.ticketId === t.id && !m.deletedAt).sort((a, b) => a.at.localeCompare(b.at));
    const replies = msgs.filter((m) => m.kind === 'reply');
    const last = replies.at(-1) ?? msgs.at(-1);
    if (last !== undefined) {
      t.lastMessageAt = last.at;
      t.lastMessagePreview = preview(last.body);
    }
    const firstAgent = replies.find((m) => m.authorKind === 'agent');
    t.firstRespondedAt = firstAgent !== undefined ? firstAgent.at : null;
    t.updatedAt = new Date().toISOString();
  }

  private autoAssign(ticket: Ticket): void {
    if (ticket.assigneeId !== null || !this.data.assignment.enabled) return;
    const pool = this.data.agents.filter((a) => a.status === 'active');
    if (pool.length === 0) return;
    if (this.data.assignment.strategy === 'least_busy') {
      let best = pool[0];
      let bestN = Infinity;
      for (const a of pool) {
        const n = this.data.tickets.filter(
          (t) => t.assigneeId === a.id && t.bucket === 'inbox' && t.mergedIntoId === null && ['open', 'pending', 'on_hold'].includes(t.status),
        ).length;
        if (n < bestN) { bestN = n; best = a; }
      }
      ticket.assigneeId = best.id;
    } else {
      ticket.assigneeId = pool[this.data.assignmentRr % pool.length].id;
      this.data.assignmentRr = (this.data.assignmentRr + 1) % 1_000_000;
    }
    this.pushEvent(ticket.id, 'assignee', null, { from: null, to: ticket.assigneeId, auto: true }, ticket.createdAt);
  }

  async saveAssignment(settings: AssignmentSettings): Promise<AssignmentSettings> {
    this.data.assignment = { enabled: settings.enabled === true, strategy: settings.strategy === 'least_busy' ? 'least_busy' : 'round_robin' };
    this.persist();
    return { ...this.data.assignment };
  }

  async saveAutoAck(settings: AutoAck): Promise<AutoAck> {
    this.data.autoAck = { enabled: settings.enabled === true, message: String(settings.message) };
    this.persist();
    return { ...this.data.autoAck };
  }

  async saveBusinessHours(settings: BusinessHours): Promise<BusinessHours> {
    this.data.businessHours = {
      enabled: settings.enabled === true,
      timezone: typeof settings.timezone === 'string' && settings.timezone.trim() !== '' ? settings.timezone : 'UTC',
      message: String(settings.message),
      days: Array.isArray(settings.days) ? settings.days.slice(0, 7) : [...DEFAULT_BUSINESS_HOURS.days],
    };
    this.persist();
    return { ...this.data.businessHours };
  }

  async ticketPresence(): Promise<string[]> {
    return []; // no live presence in single-user local mode
  }

  async translate(text: string): Promise<{ text: string; detectedLang: string | null; source: 'model' | 'rules'; reason?: string }> {
    return { text, detectedLang: null, source: 'rules', reason: 'off' }; // no model in local mode
  }

  async scheduleMessage(ticketId: string, kind: 'reply' | 'note', body: string, sendAt: string): Promise<ScheduledMessage> {
    const row: ScheduledMessage = {
      id: nextId(this.data.scheduled, 'sm_', 5), ticketId, authorId: CURRENT_AGENT_ID, kind, body, sendAt,
      createdAt: new Date().toISOString(),
    };
    this.data.scheduled.push(row);
    this.persist();
    return { ...row };
  }
  async listScheduled(ticketId: string): Promise<ScheduledMessage[]> {
    return this.data.scheduled.filter((s) => s.ticketId === ticketId).map((s) => ({ ...s }));
  }
  async cancelScheduled(scheduledId: string): Promise<void> {
    this.data.scheduled = this.data.scheduled.filter((s) => s.id !== scheduledId);
    this.persist();
  }

  // Local (offline) mode has no server sessions — auth is a no-op here.
  async login(): Promise<Agent> {
    throw new Error('Login requires the server (you are running in local mode).');
  }
  async logout(): Promise<void> {}
  async setAdminPassword(): Promise<void> {}
  async setup2fa(): Promise<{ secret: string; uri: string }> {
    throw new Error('Two-factor requires the server.');
  }
  async enable2fa(): Promise<void> {}
  async disable2fa(): Promise<void> {}
  async setAuthRequired(): Promise<boolean> {
    return false;
  }

  // --- Community forum (in-memory demo; the real store lives on the server) ---
  private agentName(id: string): string {
    return this.data.agents.find((a) => a.id === id)?.name ?? 'Support';
  }
  private forumStore(): ForumTopicDetail[] {
    if (this.forum === null) {
      const agent = this.data.agents[0];
      const c = (i: number): Contact => this.data.contacts[i] ?? this.data.contacts[0];
      const iso = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
      this.forum = [
        {
          id: 'ft_welcome', category: 'general', title: 'Welcome to the BaseDesk community 👋',
          body: 'Ask questions, share tips, and suggest features here. Be kind and mark the answer that helped you.',
          authorId: agent.id, authorName: agent.name, authorIsAgent: true, pinned: true, locked: false, solved: false, replyCount: 0, views: 342,
          createdAt: iso(240), lastActivityAt: iso(6),
          replies: [{ id: 'fr_w1', topicId: 'ft_welcome', authorId: c(0).id, authorName: c(0).name, authorIsAgent: false, body: 'Loving BaseDesk so far!', accepted: false, createdAt: iso(200) }],
        },
        {
          id: 'ft_darkmode', category: 'feature-requests', title: 'Add a dark mode to the customer portal',
          body: 'The agent workspace has a lovely dark theme — would love the same for the portal.',
          authorId: c(1).id, authorName: c(1).name, authorIsAgent: false, pinned: false, locked: false, solved: false, replyCount: 0, views: 210,
          createdAt: iso(120), lastActivityAt: iso(20), replies: [],
        },
      ];
    }
    return this.forum;
  }
  private forumView(t: ForumTopicDetail): ForumTopicDetail {
    return { ...t, replyCount: t.replies.length, solved: t.replies.some((r) => r.accepted), replies: t.replies.map((r) => ({ ...r })) };
  }
  async getForumTopics(category?: string): Promise<ForumList> {
    const topics = this.forumStore()
      .filter((t) => category === undefined || category === '' || t.category === category)
      .slice()
      .sort((a, b) => (a.pinned === b.pinned ? b.lastActivityAt.localeCompare(a.lastActivityAt) : a.pinned ? -1 : 1))
      .map((t) => this.forumView(t));
    return { topics, categories: FORUM_CATEGORIES };
  }
  async getForumTopic(id: string): Promise<ForumTopicDetail> {
    const t = this.forumStore().find((x) => x.id === id);
    if (t === undefined) throw new Error('topic not found');
    t.views += 1;
    return this.forumView(t);
  }
  async createForumTopic(input: { title: string; body: string; category: ForumCategory }): Promise<ForumTopicDetail> {
    const now = new Date().toISOString();
    const t: ForumTopicDetail = {
      id: `ft_${Date.now().toString(36)}`, category: input.category, title: input.title.trim().slice(0, 200), body: input.body.trim().slice(0, 5000),
      authorId: CURRENT_AGENT_ID, authorName: this.agentName(CURRENT_AGENT_ID), authorIsAgent: true, pinned: false, locked: false, solved: false, replyCount: 0, views: 0,
      createdAt: now, lastActivityAt: now, replies: [],
    };
    this.forumStore().unshift(t);
    return this.forumView(t);
  }
  async replyForumTopic(id: string, body: string): Promise<ForumTopicDetail> {
    const t = this.forumStore().find((x) => x.id === id);
    if (t === undefined) throw new Error('topic not found');
    if (t.locked) throw new Error('This topic is locked');
    const now = new Date().toISOString();
    t.replies.push({ id: `fr_${Date.now().toString(36)}`, topicId: id, authorId: CURRENT_AGENT_ID, authorName: this.agentName(CURRENT_AGENT_ID), authorIsAgent: true, body: body.trim().slice(0, 5000), accepted: false, createdAt: now });
    t.lastActivityAt = now;
    return this.forumView(t);
  }
  async acceptForumReply(topicId: string, replyId: string): Promise<ForumTopicDetail> {
    const t = this.forumStore().find((x) => x.id === topicId);
    if (t === undefined) throw new Error('topic not found');
    t.replies.forEach((r) => (r.accepted = r.id === replyId));
    return this.forumView(t);
  }
  async moderateForumTopic(id: string, flags: { pinned?: boolean; locked?: boolean; category?: ForumCategory }): Promise<ForumTopicDetail> {
    const t = this.forumStore().find((x) => x.id === id);
    if (t === undefined) throw new Error('topic not found');
    if (flags.pinned !== undefined) t.pinned = flags.pinned;
    if (flags.locked !== undefined) t.locked = flags.locked;
    if (flags.category !== undefined) t.category = flags.category;
    return this.forumView(t);
  }
  async deleteForumTopic(id: string): Promise<void> {
    this.forum = this.forumStore().filter((t) => t.id !== id);
  }
  async deleteForumReply(replyId: string): Promise<void> {
    for (const t of this.forumStore()) t.replies = t.replies.filter((r) => r.id !== replyId);
  }

  async saveAiAutomation(settings: AiAutomation): Promise<AiAutomation> {
    this.data.aiAutomation = {
      autoSuggest: settings.autoSuggest === true,
      autoResolve: settings.autoResolve === true,
      autoTriage: settings.autoTriage === true,
    };
    this.persist();
    return { ...this.data.aiAutomation };
  }

  async saveOnCall(config: OnCallConfig): Promise<OnCallConfig> {
    const known = new Set(this.data.agents.map((a) => a.id));
    this.data.onCall = {
      enabled: config.enabled === true,
      cadence: config.cadence === 'daily' ? 'daily' : 'weekly',
      startDate: String(config.startDate),
      rotation: (Array.isArray(config.rotation) ? config.rotation : []).filter((id) => known.has(id)),
    };
    this.persist();
    return { ...this.data.onCall, rotation: [...this.data.onCall.rotation] };
  }

  private handoverList(): HandoverNote[] {
    const name = (id: string) => this.data.agents.find((a) => a.id === id)?.name ?? null;
    return [...this.handover]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, 100)
      .map((h) => ({ ...h, authorName: name(h.authorId) }));
  }
  async getHandover(): Promise<HandoverNote[]> {
    return this.handoverList();
  }
  async addHandover(body: string): Promise<HandoverNote[]> {
    const b = body.trim();
    if (b !== '') this.handover.push({ id: `ho_${Date.now().toString(36)}_${this.handover.length}`, authorId: CURRENT_AGENT_ID, body: b, createdAt: new Date().toISOString() });
    return this.handoverList();
  }
  async deleteHandover(id: string): Promise<HandoverNote[]> {
    this.handover = this.handover.filter((h) => h.id !== id);
    return this.handoverList();
  }

  async saveTimeRules(rules: TimeRule[]): Promise<TimeRule[]> {
    this.data.timeRules = rules.map((r) => ({ ...r, actions: r.actions.map((a) => ({ ...a })) }));
    this.persist();
    return this.data.timeRules.map((r) => ({ ...r, actions: r.actions.map((a) => ({ ...a })) }));
  }

  async runTimeRules(): Promise<number> {
    const rules = this.data.timeRules.filter((r) => r.enabled && r.actions.length > 0 && r.hours > 0);
    if (rules.length === 0) return 0;
    const nowMs = Date.now();
    let fired = 0;
    for (const t of this.data.tickets) {
      if (t.bucket !== 'inbox' || !['open', 'pending', 'on_hold'].includes(t.status)) continue;
      const lastReply = this.data.messages
        .filter((m) => m.ticketId === t.id && m.kind === 'reply' && m.deletedAt == null)
        .sort((a, b) => a.at.localeCompare(b.at))
        .at(-1);
      for (const rule of rules) {
        const key = `${rule.id}:${t.id}`;
        if (this.timeRuleFired.has(key)) continue;
        let match = false;
        if (rule.trigger === 'awaiting_first_response') {
          match = t.firstRespondedAt === null && nowMs - Date.parse(t.createdAt) >= rule.hours * 3_600_000;
        } else if (lastReply !== undefined) {
          const want = rule.trigger === 'awaiting_reply' ? 'contact' : 'agent';
          match = lastReply.authorKind === want && nowMs - Date.parse(lastReply.at) >= rule.hours * 3_600_000;
        }
        if (!match) continue;
        for (const a of rule.actions) {
          if (a.type === 'set_priority') t.priority = a.value as typeof t.priority;
          else if (a.type === 'set_status') t.status = a.value as typeof t.status;
          else if (a.type === 'assign') t.assigneeId = a.value === '' ? null : a.value;
          else if (a.type === 'set_category') t.category = a.value.trim() === '' ? null : a.value;
          else if (a.type === 'add_tag') { if (!t.tags.includes(a.value)) t.tags.push(a.value); }
        }
        if ((t.status === 'solved' || t.status === 'closed') && t.resolvedAt === null) t.resolvedAt = new Date(nowMs).toISOString();
        t.updatedAt = new Date(nowMs).toISOString();
        this.timeRuleFired.add(key);
        fired += 1;
        break;
      }
    }
    if (fired > 0) this.persist();
    return fired;
  }

  /** Mirrors the server: highest-autonomy enabled agent acts on a new ticket. */
  private runAgentsOnTicket(ticket: Ticket, firstBody: string, opts?: { manual?: boolean }): AiAction | null {
    // Automatic runs are opt-in; a manual "Suggest a reply" bypasses that gate.
    if (opts?.manual !== true && !this.data.aiAutomation.autoSuggest) return null;
    const canAutoResolve = this.data.aiAutomation.autoResolve;
    const agents = this.data.aiAgents
      .filter((a) => a.enabled)
      .sort((a, b) => AUTONOMY_RANK[b.autonomy]! - AUTONOMY_RANK[a.autonomy]!);
    if (agents.length === 0) return null;
    const contact = this.data.contacts.find((c) => c.id === ticket.requesterId);
    for (const agent of agents) {
      const decision = runAgent(agent, {
        subject: ticket.subject, bodyText: firstBody,
        contactName: contact?.name ?? 'there', agentName: agent.name,
        currentPriority: ticket.priority, currentTags: ticket.tags,
        canned: this.data.canned, kb: this.data.kb,
      });
      if (decision === null) continue;
      // Auto-send is opt-in: without it, a resolve becomes a draft for a human to approve.
      const kind = decision.kind === 'resolve' && !canAutoResolve ? 'draft' : decision.kind;
      const now = new Date().toISOString();
      const action: AiAction = {
        id: nextId(this.data.aiActions, 'act_', 3), agentId: agent.id, ticketId: ticket.id,
        kind, status: kind === 'resolve' ? 'sent' : 'pending',
        draftBody: decision.draftBody, suggestedPriority: decision.suggestedPriority,
        suggestedTags: decision.suggestedTags, kbArticleId: decision.kbArticleId,
        promptTokens: 0, completionTokens: 0, // demo mode is rule-based — no model tokens
        createdAt: now, resolvedAt: kind === 'resolve' ? now : null,
      };
      this.data.aiActions.push(action);
      if (kind === 'resolve' && decision.draftBody !== null) {
        this.data.messages.push({
          id: nextId(this.data.messages, 'm_', 5), ticketId: ticket.id, authorKind: 'agent',
          authorId: CURRENT_AGENT_ID, kind: 'reply', body: decision.draftBody, at: now,
        });
        ticket.status = 'solved';
        ticket.resolvedAt = now;
        ticket.updatedAt = now;
        ticket.lastMessageAt = now;
        ticket.lastMessagePreview = preview(decision.draftBody);
        if (ticket.firstRespondedAt === null) ticket.firstRespondedAt = now;
      }
      return action;
    }
    return null;
  }

  async updateTicket(id: string, patch: TicketPatch): Promise<Ticket> {
    const t = this.ticket(id);
    const before = { status: t.status, priority: t.priority, assigneeId: t.assigneeId, tags: [...t.tags] };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (t as unknown as Record<string, unknown>)[key] = value;
    }
    const now = new Date().toISOString();
    // Maintain resolvedAt for the SLA resolution clock.
    if (patch.status !== undefined) {
      if (RESOLVED.includes(patch.status) && t.resolvedAt === null) t.resolvedAt = now;
      else if (!RESOLVED.includes(patch.status) && t.resolvedAt !== null) t.resolvedAt = null;
    }
    t.updatedAt = now;
    this.logPatchEvents(id, before, patch, CURRENT_AGENT_ID, now);
    this.persist();
    return this.stampAwaiting({ ...t, tags: [...t.tags] });
  }

  async bulkPatchTickets(ids: string[], patch: TicketPatch, addTags?: string[]): Promise<Ticket[]> {
    const now = new Date().toISOString();
    const out: Ticket[] = [];
    for (const id of ids) {
      const t = this.data.tickets.find((x) => x.id === id);
      if (!t) continue;
      const before = { status: t.status, priority: t.priority, assigneeId: t.assigneeId, tags: [...t.tags] };
      for (const key of ['status', 'priority', 'assigneeId', 'bucket', 'snoozedUntil'] as const) {
        if (key in patch && patch[key] !== undefined) (t as unknown as Record<string, unknown>)[key] = patch[key];
      }
      if (addTags && addTags.length > 0) t.tags = Array.from(new Set([...t.tags, ...addTags]));
      if (patch.status !== undefined) {
        if (RESOLVED.includes(patch.status) && t.resolvedAt === null) t.resolvedAt = now;
        else if (!RESOLVED.includes(patch.status) && t.resolvedAt !== null) t.resolvedAt = null;
      }
      t.updatedAt = now;
      this.logPatchEvents(id, before, { ...patch, tags: t.tags }, CURRENT_AGENT_ID, now);
      out.push(this.stampAwaiting({ ...t, tags: [...t.tags] }));
    }
    this.persist();
    return out;
  }

  private pushEvent(ticketId: string, kind: TicketEvent['kind'], actorId: string | null, detail: Record<string, unknown>, at: string): void {
    const actorName = actorId !== null ? this.data.agents.find((a) => a.id === actorId)?.name ?? null : null;
    this.data.events.push({ id: nextId(this.data.events, 'ev_', 1), ticketId, kind, actorId, actorName, detail, at });
  }

  private logPatchEvents(
    ticketId: string,
    before: { status: TicketStatus; priority: TicketPriority; assigneeId: string | null; tags: string[] },
    patch: TicketPatch,
    actorId: string | null,
    at: string,
  ): void {
    if (patch.status !== undefined && patch.status !== before.status) this.pushEvent(ticketId, 'status', actorId, { from: before.status, to: patch.status }, at);
    if (patch.priority !== undefined && patch.priority !== before.priority) this.pushEvent(ticketId, 'priority', actorId, { from: before.priority, to: patch.priority }, at);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) this.pushEvent(ticketId, 'assignee', actorId, { from: before.assigneeId, to: patch.assigneeId }, at);
    if (patch.tags !== undefined) {
      const added = patch.tags.filter((x) => !before.tags.includes(x));
      const removed = before.tags.filter((x) => !patch.tags!.includes(x));
      if (added.length > 0 || removed.length > 0) this.pushEvent(ticketId, 'tags', actorId, { added, removed }, at);
    }
  }

  async getTicketEvents(ticketId: string): Promise<TicketEvent[]> {
    return this.data.events
      .filter((e) => e.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ ...e }));
  }

  async getAuditLog(limit = 500): Promise<AuditEvent[]> {
    const byId = new Map(this.data.tickets.map((t) => [t.id, t]));
    return this.data.events
      .map((e, i) => ({ e, i }))
      // Newest first; break ties on insertion order so same-timestamp events keep server order.
      .sort((a, b) => (a.e.at < b.e.at ? 1 : a.e.at > b.e.at ? -1 : b.i - a.i))
      .slice(0, Math.min(Math.max(Math.trunc(limit), 1), 2000))
      .map(({ e }) => {
        const t = byId.get(e.ticketId);
        return { ...e, ticketNumber: t?.number ?? 0, ticketSubject: t?.subject ?? '(deleted ticket)' };
      });
  }

  async getTicketSeen(_ticketId: string): Promise<TicketSeen[]> {
    // The static demo has no cross-viewer tracking; the current agent is viewing now.
    return [{ viewerId: CURRENT_AGENT_ID, viewerKind: 'agent', at: new Date().toISOString() }];
  }

  async getTicketIntake(_ticketId: string): Promise<IntakeAnswer[]> {
    return []; // the demo repo doesn't capture intake answers
  }

  async getFollowers(ticketId: string): Promise<TicketFollower[]> {
    return (this.followers.get(ticketId) ?? []).map((f) => ({ ...f }));
  }
  async followTicket(ticketId: string, agentId?: string): Promise<TicketFollower[]> {
    const id = agentId ?? CURRENT_AGENT_ID;
    const agent = this.data.agents.find((a) => a.id === id);
    const list = this.followers.get(ticketId) ?? [];
    if (agent && !list.some((f) => f.agentId === id)) {
      list.push({ agentId: id, name: agent.name, avatarHue: agent.avatarHue, at: new Date().toISOString() });
      this.followers.set(ticketId, list);
    }
    return this.getFollowers(ticketId);
  }
  async unfollowTicket(ticketId: string, agentId: string): Promise<TicketFollower[]> {
    this.followers.set(ticketId, (this.followers.get(ticketId) ?? []).filter((f) => f.agentId !== agentId));
    return this.getFollowers(ticketId);
  }

  async getTasks(ticketId: string): Promise<TicketTask[]> {
    return (this.tasks.get(ticketId) ?? []).map((t) => ({ ...t }));
  }
  async addTask(ticketId: string, title: string): Promise<TicketTask[]> {
    const list = this.tasks.get(ticketId) ?? [];
    list.push({
      id: 'tk_' + Date.now().toString(36) + '_' + list.length,
      ticketId, title: title.trim(), done: false, position: list.length,
      createdAt: new Date().toISOString(), doneAt: null,
    });
    this.tasks.set(ticketId, list);
    return this.getTasks(ticketId);
  }
  async patchTask(ticketId: string, taskId: string, patch: { title?: string; done?: boolean }): Promise<TicketTask[]> {
    const t = (this.tasks.get(ticketId) ?? []).find((x) => x.id === taskId);
    if (t) {
      if (patch.title !== undefined) t.title = patch.title;
      if (patch.done !== undefined) {
        t.done = patch.done;
        t.doneAt = patch.done ? new Date().toISOString() : null;
      }
    }
    return this.getTasks(ticketId);
  }
  async deleteTask(ticketId: string, taskId: string): Promise<TicketTask[]> {
    this.tasks.set(ticketId, (this.tasks.get(ticketId) ?? []).filter((x) => x.id !== taskId));
    return this.getTasks(ticketId);
  }

  private linksFor(ticketId: string): TicketLink[] {
    return this.links
      .filter((r) => r.fromId === ticketId || r.toId === ticketId)
      .map((r): TicketLink | null => {
        const outgoing = r.fromId === ticketId;
        const otherId = outgoing ? r.toId : r.fromId;
        const other = this.data.tickets.find((t) => t.id === otherId);
        if (!other) return null;
        let type: TicketLinkType;
        if (r.type === 'related') type = 'related';
        else if (r.type === 'blocks') type = outgoing ? 'blocks' : 'blocked_by';
        else type = outgoing ? 'duplicate_of' : 'duplicated_by';
        return { linkId: r.id, ticketId: otherId, number: other.number, subject: other.subject, status: other.status, type };
      })
      .filter((l): l is TicketLink => l !== null);
  }
  async getLinks(ticketId: string): Promise<TicketLink[]> {
    return this.linksFor(ticketId);
  }
  async addLink(ticketId: string, linkedTicketId: string, type: TicketLinkType): Promise<TicketLink[]> {
    const other = this.data.tickets.find((t) => t.id === linkedTicketId);
    const dup = this.links.some((r) => (r.fromId === ticketId && r.toId === linkedTicketId) || (r.fromId === linkedTicketId && r.toId === ticketId));
    if (other && linkedTicketId !== ticketId && !dup) {
      let fromId = ticketId;
      let toId = linkedTicketId;
      let stored = 'related';
      if (type === 'blocks') stored = 'blocks';
      else if (type === 'blocked_by') { stored = 'blocks'; fromId = linkedTicketId; toId = ticketId; }
      else if (type === 'duplicate_of') stored = 'duplicate';
      this.links.push({ id: `lk_${Date.now().toString(36)}_${this.links.length}`, fromId, toId, type: stored });
      this.pushEvent(ticketId, 'link', CURRENT_AGENT_ID, { targetId: linkedTicketId, targetNumber: other.number, linkType: type }, new Date().toISOString());
    }
    return this.linksFor(ticketId);
  }
  async removeLink(ticketId: string, linkId: string): Promise<TicketLink[]> {
    this.links = this.links.filter((r) => r.id !== linkId);
    return this.linksFor(ticketId);
  }

  private approvalsFor(ticketId: string): TicketApproval[] {
    const name = (id: string | null) => (id !== null ? this.data.agents.find((a) => a.id === id)?.name ?? null : null);
    return this.approvals
      .filter((a) => a.ticketId === ticketId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((a) => ({ ...a, requestedByName: name(a.requestedById), approverName: name(a.approverId), decidedByName: name(a.decidedById) }));
  }
  async getApprovals(ticketId: string): Promise<TicketApproval[]> {
    return this.approvalsFor(ticketId);
  }
  async requestApproval(ticketId: string, reason: string, approverId: string | null): Promise<TicketApproval[]> {
    const r = reason.trim();
    if (r === '') throw new Error('reason is required');
    const now = new Date().toISOString();
    this.approvals.push({
      id: `appr_${Date.now().toString(36)}_${this.approvals.length}`,
      ticketId, requestedById: CURRENT_AGENT_ID, approverId: approverId || null, reason: r,
      status: 'pending', decidedById: null, decisionNote: null, createdAt: now, decidedAt: null,
    });
    this.pushEvent(ticketId, 'approval', CURRENT_AGENT_ID, { state: 'requested', reason: r }, now);
    return this.approvalsFor(ticketId);
  }
  async decideApproval(ticketId: string, approvalId: string, decision: 'approved' | 'rejected', note: string | null): Promise<TicketApproval[]> {
    const a = this.approvals.find((x) => x.id === approvalId && x.ticketId === ticketId);
    if (a && a.status === 'pending') {
      const now = new Date().toISOString();
      a.status = decision;
      a.decidedById = CURRENT_AGENT_ID;
      a.decisionNote = note && note.trim() !== '' ? note.trim() : null;
      a.decidedAt = now;
      this.pushEvent(ticketId, 'approval', CURRENT_AGENT_ID, { state: decision }, now);
    }
    return this.approvalsFor(ticketId);
  }

  private sideConvosFor(ticketId: string): SideConversation[] {
    const name = (id: string) => this.data.agents.find((a) => a.id === id)?.name ?? null;
    return this.sideConvos
      .filter((c) => c.ticketId === ticketId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({
        ...c,
        messages: this.sideMsgs
          .filter((m) => m.sideId === c.id)
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((m) => ({ ...m, authorName: name(m.authorId) })),
      }));
  }
  async getSideConversations(ticketId: string): Promise<SideConversation[]> {
    return this.sideConvosFor(ticketId);
  }
  async createSideConversation(ticketId: string, subject: string, participant: string | null, body: string): Promise<SideConversation[]> {
    const subj = subject.trim();
    if (subj === '') throw new Error('subject is required');
    const now = new Date().toISOString();
    const sideId = `side_${Date.now().toString(36)}_${this.sideConvos.length}`;
    this.sideConvos.push({ id: sideId, ticketId, subject: subj, participant: participant && participant.trim() !== '' ? participant.trim() : null, createdAt: now });
    if (body.trim() !== '') this.sideMsgs.push({ id: `sm_${Date.now().toString(36)}_${this.sideMsgs.length}`, sideId, authorId: CURRENT_AGENT_ID, body: body.trim(), at: now });
    return this.sideConvosFor(ticketId);
  }
  async addSideMessage(ticketId: string, sideId: string, body: string): Promise<SideConversation[]> {
    const text = body.trim();
    const side = this.sideConvos.find((c) => c.id === sideId && c.ticketId === ticketId);
    if (side && text !== '') {
      this.sideMsgs.push({ id: `sm_${Date.now().toString(36)}_${this.sideMsgs.length}`, sideId, authorId: CURRENT_AGENT_ID, body: text, at: new Date().toISOString() });
    }
    return this.sideConvosFor(ticketId);
  }

  async addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string; attachmentIds?: string[]; embeds?: MessageEmbed[] }): Promise<{ message: Message; ticket: Ticket }> {
    const t = this.ticket(ticketId);
    const now = new Date().toISOString();
    const embeds = this.resolveEmbeds(input.embeds);
    const message: Message = {
      id: nextId(this.data.messages, 'm_', 5),
      ticketId,
      authorKind: 'agent',
      authorId: CURRENT_AGENT_ID,
      kind: input.kind,
      body: input.body,
      at: now,
      embeds: embeds.length > 0 ? embeds : undefined,
    };
    this.data.messages.push(message);
    const ids = input.attachmentIds ?? [];
    for (const a of this.data.attachments) {
      if (a.messageId === null && ids.includes(a.id)) {
        a.messageId = message.id;
        a.ticketId = ticketId;
      }
    }
    const attachments = this.data.attachments.filter((a) => a.messageId === message.id).map((a) => ({ ...a }));
    t.updatedAt = now;
    t.lastMessageAt = now;
    if (input.kind === 'reply') {
      t.lastMessagePreview =
        input.body.trim() !== ''
          ? preview(input.body)
          : embeds.length > 0
            ? embeds[0].type === 'kb_citation'
              ? `Cited “${embeds[0].title}”`
              : embeds[0].type === 'choice_prompt'
                ? `Asked “${embeds[0].question}”`
                : 'Outside working hours'
            : 'Sent an attachment';
      if (t.status === 'open') t.status = 'pending';
      if (t.firstRespondedAt === null) t.firstRespondedAt = now;
    }
    if (input.kind === 'note') this.notifyMentions(message, t.subject);
    this.persist();
    return { message: { ...message, attachments }, ticket: { ...t, tags: [...t.tags] } };
  }

  /** Re-resolve KB citations against the local store (parity with the server), dropping unknown/unpublished ones. */
  private resolveEmbeds(raw?: MessageEmbed[]): MessageEmbed[] {
    const out: MessageEmbed[] = [];
    for (const c of raw ?? []) {
      if (c.type === 'kb_citation') {
        const passage = c.passage.replace(/\s+/g, ' ').trim().slice(0, 2000);
        if (passage === '') continue;
        const article = this.data.kb.find((a) => a.id === c.articleId);
        if (article === undefined || article.status !== 'published') continue;
        const highlights = normalizeHighlights(c.highlights, passage.length);
        out.push({
          type: 'kb_citation',
          articleId: article.id,
          title: article.title,
          category: article.category.trim() === '' ? null : article.category,
          slug: article.slug,
          passage,
          ...(highlights.length > 0 ? { highlights } : {}),
        });
      } else if (c.type === 'choice_prompt') {
        const question = c.question.replace(/\s+/g, ' ').trim().slice(0, 300);
        const options: ChoiceOption[] = [];
        for (const o of c.options ?? []) {
          const label = o.label.trim().slice(0, 120);
          if (label === '') continue;
          options.push({ id: `o${options.length + 1}`, label });
          if (options.length >= 10) break;
        }
        if (question === '' || options.length < 1) continue;
        out.push({ type: 'choice_prompt', question, layout: c.layout === 'dropdown' ? 'dropdown' : 'buttons', options });
      } else continue;
      if (out.length >= 10) break;
    }
    return out;
  }

  /** Mirrors the server: an @mentioned teammate (by first name) gets a notification. */
  private notifyMentions(message: Message, ticketSubject: string): void {
    const tokens = new Set((message.body.match(/@\p{L}[\p{L}'’_-]*/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
    if (tokens.size === 0) return;
    const actorName = this.data.agents.find((a) => a.id === message.authorId)?.name ?? 'A teammate';
    for (const a of this.data.agents) {
      if (a.id === message.authorId) continue;
      const first = a.name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (first !== '' && tokens.has(first)) {
        this.data.notifications.push({
          id: nextId(this.data.notifications, 'nt_', 1),
          agentId: a.id, ticketId: message.ticketId, ticketSubject,
          messageId: message.id, actorId: message.authorId, actorName,
          snippet: preview(message.body), kind: 'mention',
          channel: this.data.tickets.find((t) => t.id === message.ticketId)?.channel ?? 'web',
          createdAt: message.at, readAt: null,
        });
      }
    }
  }

  async mergeTicket(ticketId: string, into: string): Promise<{ source: Ticket; target: Ticket }> {
    const source = this.data.tickets.find((t) => t.id === ticketId);
    const target = this.data.tickets.find((t) => t.id === into);
    if (!source) throw new Error('source ticket not found');
    if (!target) throw new Error('target ticket not found');
    if (ticketId === into) throw new Error('cannot merge a ticket into itself');
    if (source.mergedIntoId !== null) throw new Error('ticket is already merged');
    if (target.mergedIntoId !== null) throw new Error('cannot merge into an already-merged ticket');

    const now = new Date().toISOString();
    // GitHub-style: the source keeps its own conversation; we only cross-reference
    // the merge on the target and close the source as a pointer. Nothing is moved.
    this.data.messages.push({
      id: nextId(this.data.messages, 'm_', 5), ticketId: into, authorKind: 'agent',
      authorId: CURRENT_AGENT_ID, kind: 'note',
      body: `Merged ticket #${source.number} — "${source.subject}" — into this one.`, at: now,
    });
    source.mergedIntoId = into;
    source.status = 'closed';
    source.updatedAt = now;
    this.pushEvent(source.id, 'merged', CURRENT_AGENT_ID, { targetId: into, targetNumber: target.number }, now);
    // The merge is fresh activity on the target — bump it so it surfaces in views.
    target.updatedAt = now;
    this.persist();
    return { source: this.stampAwaiting({ ...source, tags: [...source.tags] }), target: this.stampAwaiting({ ...target, tags: [...target.tags] }) };
  }

  async splitTicket(ticketId: string, subject: string, messageIds: string[]): Promise<{ source: Ticket; created: Ticket }> {
    const source = this.data.tickets.find((t) => t.id === ticketId);
    if (!source) throw new Error('source ticket not found');
    if (source.mergedIntoId !== null) throw new Error('cannot split a merged ticket');
    const subj = subject.trim();
    if (subj === '') throw new Error('subject is required');
    const ids = new Set(messageIds);
    const owned = this.data.messages.filter((m) => m.ticketId === ticketId);
    const moving = owned.filter((m) => ids.has(m.id));
    if (moving.length === 0) throw new Error('select at least one message to split out');
    if (moving.length >= owned.length) throw new Error('a split must leave at least one message behind');

    const now = new Date().toISOString();
    const number = this.data.tickets.reduce((max, t) => Math.max(max, t.number), 0) + 1;
    const created: Ticket = {
      id: nextId(this.data.tickets, 't_', 3),
      number,
      subject: subj,
      status: 'open',
      priority: source.priority,
      bucket: 'inbox',
      requesterId: source.requesterId,
      assigneeId: null,
      tags: [],
      channel: source.channel,
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: '',
      firstRespondedAt: null,
      resolvedAt: null,
      channelId: null,
      mergedIntoId: null,
      awaitingReply: true,
      customFields: {},
      category: source.category,
    };
    this.data.tickets.push(created);
    for (const m of moving) m.ticketId = created.id;
    for (const a of this.data.attachments) if (a.messageId !== null && ids.has(a.messageId)) a.ticketId = created.id;
    this.recomputeDerived(source);
    this.recomputeDerived(created);
    this.links.push({ id: `lk_${Date.now().toString(36)}_${this.links.length}`, fromId: source.id, toId: created.id, type: 'related' });
    this.pushEvent(source.id, 'split', CURRENT_AGENT_ID, { targetId: created.id, targetNumber: created.number, count: moving.length }, now);
    this.pushEvent(created.id, 'created', CURRENT_AGENT_ID, {}, now);
    this.persist();
    return { source: this.stampAwaiting({ ...source, tags: [...source.tags] }), created: this.stampAwaiting({ ...created, tags: [...created.tags] }) };
  }

  async createContact(input: { name: string; email: string; company?: string }): Promise<Contact> {
    const contact: Contact = {
      id: nextId(this.data.contacts, 'c_', 2),
      name: input.name,
      email: input.email,
      company: input.company ?? null,
      avatarHue: djb2(input.email) % 360,
      location: null,
      timezone: null,
      createdAt: new Date().toISOString(),
      mrr: null,
    };
    this.data.contacts.push(contact);
    this.persist();
    return { ...contact };
  }

  async saveCanned(c: CannedReply): Promise<CannedReply> {
    const existing = c.id ? this.data.canned.find((x) => x.id === c.id) : undefined;
    const actions = c.actions ?? null;
    if (existing) {
      existing.title = c.title;
      existing.body = c.body;
      existing.actions = actions;
      this.persist();
      return { ...existing };
    }
    const created: CannedReply = {
      id: c.id || nextId(this.data.canned, 'cr_', 1),
      title: c.title,
      body: c.body,
      actions,
    };
    this.data.canned.push(created);
    this.persist();
    return { ...created };
  }

  async deleteCanned(id: string): Promise<void> {
    this.data.canned = this.data.canned.filter((c) => c.id !== id);
    this.persist();
  }

  async saveTemplate(t: TicketTemplate): Promise<TicketTemplate> {
    const shaped = {
      name: t.name.trim(),
      subject: t.subject,
      body: t.body,
      priority: t.priority,
      category: t.category && t.category.trim() !== '' ? t.category.trim() : null,
      tags: [...new Set(t.tags.map((x) => x.trim()).filter((x) => x !== ''))],
    };
    const existing = t.id ? this.data.templates.find((x) => x.id === t.id) : undefined;
    if (existing) {
      Object.assign(existing, shaped);
      this.persist();
      return { ...existing, tags: [...existing.tags] };
    }
    const created: TicketTemplate = { id: t.id || nextId(this.data.templates, 'tpl_', 1), ...shaped };
    this.data.templates.push(created);
    this.persist();
    return { ...created, tags: [...created.tags] };
  }

  async deleteTemplate(id: string): Promise<void> {
    this.data.templates = this.data.templates.filter((t) => t.id !== id);
    this.persist();
  }

  async saveReport(r: CustomReport): Promise<CustomReport> {
    const shaped = { name: r.name.trim(), metric: r.metric, dimension: r.dimension, range: r.range };
    const existing = r.id ? this.data.customReports.find((x) => x.id === r.id) : undefined;
    if (existing) {
      Object.assign(existing, shaped);
      this.persist();
      return { ...existing };
    }
    const created: CustomReport = { id: r.id || nextId(this.data.customReports, 'rep_', 1), ...shaped };
    this.data.customReports.push(created);
    this.persist();
    return { ...created };
  }
  async deleteReport(id: string): Promise<void> {
    this.data.customReports = this.data.customReports.filter((r) => r.id !== id);
    this.persist();
  }

  private cloneComponents(): StatusComponent[] {
    return this.statusComponents.map((c) => ({ ...c }));
  }
  private cloneIncidents(): StatusIncident[] {
    return this.statusIncidents.map((i) => ({ ...i, updates: i.updates.map((u) => ({ ...u })) }));
  }
  async getStatusPage(): Promise<StatusPageData> {
    return { components: this.cloneComponents(), incidents: this.cloneIncidents() };
  }
  async addStatusComponent(name: string): Promise<StatusComponent[]> {
    const n = name.trim();
    if (n === '') throw new Error('name is required');
    const position = this.statusComponents.reduce((m, c) => Math.max(m, c.position), -1) + 1;
    this.statusComponents.push({ id: `sc_${Date.now().toString(36)}_${this.statusComponents.length}`, name: n, status: 'operational', position });
    return this.cloneComponents();
  }
  async saveStatusComponent(id: string, name: string, status: ComponentStatus): Promise<StatusComponent[]> {
    const c = this.statusComponents.find((x) => x.id === id);
    if (c) {
      c.name = name.trim();
      c.status = status;
    }
    return this.cloneComponents();
  }
  async removeStatusComponent(id: string): Promise<StatusComponent[]> {
    this.statusComponents = this.statusComponents.filter((c) => c.id !== id);
    return this.cloneComponents();
  }
  async createIncident(title: string, impact: IncidentImpact, body: string): Promise<StatusIncident[]> {
    const t = title.trim();
    if (t === '') throw new Error('title is required');
    const now = new Date().toISOString();
    this.statusIncidents.unshift({
      id: `si_${Date.now().toString(36)}`,
      title: t,
      impact,
      status: 'investigating',
      createdAt: now,
      resolvedAt: null,
      updates: [{ at: now, status: 'investigating', body: body.trim() !== '' ? body.trim() : 'We are investigating this incident.' }],
    });
    return this.cloneIncidents();
  }
  async postIncidentUpdate(id: string, status: IncidentStatus, body: string): Promise<StatusIncident[]> {
    const i = this.statusIncidents.find((x) => x.id === id);
    if (i && body.trim() !== '') {
      const now = new Date().toISOString();
      i.updates.push({ at: now, status, body: body.trim() });
      i.status = status;
      i.resolvedAt = status === 'resolved' ? now : null;
    }
    return this.cloneIncidents();
  }
  async removeIncident(id: string): Promise<StatusIncident[]> {
    this.statusIncidents = this.statusIncidents.filter((i) => i.id !== id);
    return this.cloneIncidents();
  }

  async saveAnnouncement(a: Announcement): Promise<Announcement[]> {
    const body = a.body.trim();
    if (body === '') throw new Error('a message is required');
    const existing = a.id ? this.data.announcements.find((x) => x.id === a.id) : undefined;
    if (existing) {
      existing.body = body;
      existing.level = a.level;
      existing.active = a.active;
    } else {
      this.data.announcements.unshift({ id: `ann_${Date.now().toString(36)}`, body, level: a.level, active: true, createdAt: new Date().toISOString() });
    }
    this.persist();
    return this.data.announcements.map((x) => ({ ...x }));
  }
  async deleteAnnouncement(id: string): Promise<Announcement[]> {
    this.data.announcements = this.data.announcements.filter((a) => a.id !== id);
    this.persist();
    return this.data.announcements.map((x) => ({ ...x }));
  }
  async saveBranding(b: Branding): Promise<Branding> {
    const HEX = /^#[0-9a-fA-F]{6}$/;
    this.data.branding = {
      productName: b.productName.trim() !== '' ? b.productName.trim().slice(0, 40) : 'BaseDesk',
      accentColor: HEX.test(b.accentColor) ? b.accentColor : '',
    };
    this.persist();
    return { ...this.data.branding };
  }

  async listDeals(filter?: { stage?: DealStage; type?: DealType; contactId?: string }): Promise<Deal[]> {
    return this.data.deals
      .filter((d) => (filter?.stage ? d.stage === filter.stage : true))
      .filter((d) => (filter?.type ? d.type === filter.type : true))
      .filter((d) => (filter?.contactId ? d.contactId === filter.contactId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((d) => ({ ...d }));
  }

  async createDeal(input: DealCreate): Promise<Deal> {
    if (input.title.trim() === '') throw new Error('title is required');
    if (!DEAL_TYPES.includes(input.type)) throw new Error('invalid type');
    if (!Number.isInteger(input.value) || input.value < 0) throw new Error('value must be a non-negative integer');
    if (!this.data.contacts.some((c) => c.id === input.contactId)) throw new Error('unknown contactId');
    if (input.ticketId != null && !this.data.tickets.some((t) => t.id === input.ticketId)) {
      throw new Error('unknown ticketId');
    }
    const now = new Date().toISOString();
    const deal: Deal = {
      id: nextId(this.data.deals, 'd_', 3),
      title: input.title.trim(),
      type: input.type,
      stage: 'open',
      value: input.value,
      currency: 'USD',
      contactId: input.contactId,
      ticketId: input.ticketId ?? null,
      ownerId: input.ownerId ?? CURRENT_AGENT_ID,
      note: input.note ?? '',
      createdAt: now,
      closedAt: null,
      updatedAt: now,
    };
    this.data.deals.push(deal);
    this.persist();
    return { ...deal };
  }

  async updateDeal(id: string, patch: DealPatch): Promise<Deal> {
    const d = this.deal(id);
    const now = new Date().toISOString();
    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw new Error('invalid title');
      d.title = patch.title.trim();
    }
    if (patch.type !== undefined) {
      if (!DEAL_TYPES.includes(patch.type)) throw new Error('invalid type');
      d.type = patch.type;
    }
    if (patch.value !== undefined) {
      if (!Number.isInteger(patch.value) || patch.value < 0) throw new Error('invalid value');
      d.value = patch.value;
    }
    if (patch.ownerId !== undefined) d.ownerId = patch.ownerId;
    if (patch.note !== undefined) d.note = patch.note;
    if (patch.stage !== undefined) {
      if (!DEAL_STAGES.includes(patch.stage)) throw new Error('invalid stage');
      d.stage = patch.stage;
      if (patch.stage === 'won' || patch.stage === 'lost') {
        if (d.closedAt === null) d.closedAt = now;
      } else {
        d.closedAt = null;
      }
    }
    d.updatedAt = now;
    this.persist();
    return { ...d };
  }

  async deleteDeal(id: string): Promise<void> {
    this.data.deals = this.data.deals.filter((d) => d.id !== id);
    this.persist();
  }

  async saveSlaTargets(targets: SlaTargets): Promise<SlaTargets> {
    this.data.sla = targets;
    this.persist();
    return targets;
  }

  async saveAutomation(rules: AutomationRule[]): Promise<AutomationRule[]> {
    this.data.automation = rules.map((r) => ({ ...r }));
    this.persist();
    return this.data.automation.map((r) => ({ ...r }));
  }

  async saveSlaHours(hours: SlaHours): Promise<SlaHours> {
    this.data.slaHours = { ...hours, days: [...hours.days], holidays: [...new Set(hours.holidays ?? [])].sort() };
    this.persist();
    return { ...this.data.slaHours, days: [...this.data.slaHours.days], holidays: [...this.data.slaHours.holidays] };
  }

  async inviteAgent(input: AgentInvite): Promise<Agent> {
    if (input.name.trim() === '') throw new Error('name is required');
    if (input.email.trim() === '') throw new Error('email is required');
    const agent: Agent = {
      id: nextId(this.data.agents, 'a_', 1),
      name: input.name.trim(),
      email: input.email.trim(),
      avatarHue: djb2(input.email.trim()) % 360,
      role: input.role === 'admin' ? 'admin' : 'agent',
      status: 'invited',
      inviteToken: `inv_${randomToken(16)}`,
      signature: '',
      categories: [],
      languages: [],
    };
    this.data.agents.push(agent);
    this.persist();
    return { ...agent };
  }

  async updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
    const a = this.data.agents.find((x) => x.id === id);
    if (!a) throw new Error(`agent not found: ${id}`);
    if (patch.name !== undefined) {
      if (patch.name.trim() === '') throw new Error('invalid name');
      a.name = patch.name.trim();
    }
    if (patch.role !== undefined) {
      if (patch.role !== 'admin' && patch.role !== 'agent') throw new Error('invalid role');
      a.role = patch.role;
    }
    if (patch.signature !== undefined) a.signature = patch.signature;
    if (patch.categories !== undefined) a.categories = patch.categories.filter((x): x is string => typeof x === 'string');
    if (patch.languages !== undefined) a.languages = patch.languages.filter((x): x is string => typeof x === 'string');
    this.persist();
    return { ...a };
  }

  async deleteAgent(id: string): Promise<void> {
    const a = this.data.agents.find((x) => x.id === id);
    if (!a) throw new Error(`agent not found: ${id}`);
    const activeAdmins = this.data.agents.filter((x) => x.role === 'admin' && x.status === 'active').length;
    if (a.role === 'admin' && a.status === 'active' && activeAdmins <= 1) {
      throw new Error('cannot remove the last admin');
    }
    this.data.agents = this.data.agents.filter((x) => x.id !== id);
    this.persist();
  }

  async saveAiProvider(input: AiProviderSave): Promise<AiProvider> {
    const cur = this.data.aiProvider;
    const mask = (s: string): string => (s.length <= 8 ? `${s.slice(0, 1)}…${s.slice(-1)}` : `${s.slice(0, 3)}…${s.slice(-3)}`);
    const newKey = typeof input.apiKey === 'string' && input.apiKey.trim() !== '' ? input.apiKey.trim() : null;
    const next: AiProvider = {
      enabled: input.enabled ?? cur.enabled,
      baseUrl: input.baseUrl && input.baseUrl.trim() !== '' ? input.baseUrl.trim() : cur.baseUrl,
      model: input.model && input.model.trim() !== '' ? input.model.trim() : cur.model,
      temperature: typeof input.temperature === 'number' ? Math.min(2, Math.max(0, input.temperature)) : cur.temperature,
      reasoning: typeof input.reasoning === 'boolean' ? input.reasoning : cur.reasoning,
      kbOnly: typeof input.kbOnly === 'boolean' ? input.kbOnly : cur.kbOnly,
      // Mirror the server: only a new non-empty key changes it; removeKey clears it.
      hasKey: input.removeKey === true ? false : newKey !== null ? true : cur.hasKey,
      keyHint: input.removeKey === true ? null : newKey !== null ? mask(newKey) : cur.keyHint,
    };
    this.data.aiProvider = next;
    this.persist();
    return { ...next };
  }

  async testAiProvider(): Promise<AiTestResult> {
    // Demo mode has no server to hold a key or reach a provider.
    return { ok: false, error: 'Model calls run on the self-hosted server — demo mode uses the built-in rule-based engine.' };
  }

  async listProviderModels(): Promise<{ models?: string[]; error?: string }> {
    return { error: 'Fetching the live model list runs on the self-hosted server.' };
  }

  async saveSmtp(input: SmtpSave): Promise<SmtpSettings> {
    const cur = this.data.smtp;
    const next: SmtpSettings = {
      enabled: input.enabled ?? cur.enabled,
      host: input.host !== undefined ? input.host.trim() : cur.host,
      port: typeof input.port === 'number' && input.port > 0 ? input.port : cur.port,
      secure: input.secure ?? cur.secure,
      user: input.user !== undefined ? input.user.trim() : cur.user,
      fromName: input.fromName !== undefined && input.fromName.trim() !== '' ? input.fromName.trim() : cur.fromName,
      fromEmail: input.fromEmail !== undefined ? input.fromEmail.trim() : cur.fromEmail,
      publicUrl: input.publicUrl !== undefined && input.publicUrl.trim() !== '' ? input.publicUrl.trim() : cur.publicUrl,
      hasPass: typeof input.pass === 'string' ? input.pass.trim() !== '' : cur.hasPass,
    };
    this.data.smtp = next;
    this.persist();
    return { ...next };
  }

  async testSmtp(): Promise<SmtpTestResult> {
    // Demo mode has no server to open an SMTP connection.
    return { ok: false, error: 'Email sending runs on the self-hosted server.' };
  }

  async aiDraft(ticketId: string): Promise<DraftResult> {
    const ticket = this.ticket(ticketId);
    const contact = this.data.contacts.find((c) => c.id === ticket.requesterId);
    const agent = this.data.agents.find((a) => a.id === CURRENT_AGENT_ID);
    const msgs = this.data.messages
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at));
    const lastCustomer = [...msgs].reverse().find((m) => m.authorKind === 'contact' && m.kind === 'reply');
    const body = draftReply({
      subject: ticket.subject,
      contactName: contact?.name ?? 'there',
      agentName: agent?.name ?? 'there',
      lastCustomerMessage: lastCustomer?.body ?? '',
      canned: this.data.canned,
    });
    return { body, source: 'rules', usage: { promptTokens: 0, completionTokens: 0 } };
  }

  async aiTriage(ticketId: string): Promise<CopilotTriage> {
    const ticket = this.ticket(ticketId);
    const bodyText =
      this.data.messages
        .filter((m) => m.ticketId === ticketId && m.authorKind === 'contact' && m.kind === 'reply')
        .map((m) => m.body)
        .join('\n') || ticket.lastMessagePreview;
    const t = suggestTriage({ subject: ticket.subject, bodyText, currentPriority: ticket.priority, currentTags: ticket.tags });
    return { priority: t.priority, tags: t.tags, reason: t.reason, source: 'rules', usage: { promptTokens: 0, completionTokens: 0 } };
  }

  async aiSummarize(ticketId: string): Promise<SummaryResult> {
    const ticket = this.ticket(ticketId);
    const contact = this.data.contacts.find((c) => c.id === ticket.requesterId);
    const messages = this.data.messages
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at));
    const summary = summarizeThread({ contactName: contact?.name ?? 'there', messages });
    return { summary, source: 'rules', usage: { promptTokens: 0, completionTokens: 0 } };
  }

  async createArticle(input: ArticleCreate): Promise<KbArticle> {
    if (input.title.trim() === '') throw new Error('title is required');
    if (input.category.trim() === '') throw new Error('category is required');
    const now = new Date().toISOString();
    const article: KbArticle = {
      id: nextId(this.data.kb, 'kb_', 2),
      title: input.title.trim(),
      slug: slugify(input.title),
      category: input.category.trim(),
      body: input.body,
      status: (input.status ?? 'draft') as ArticleStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.data.kb.push(article);
    this.persist();
    return { ...article };
  }

  async updateArticle(id: string, patch: ArticlePatch): Promise<KbArticle> {
    const a = this.data.kb.find((x) => x.id === id);
    if (!a) throw new Error('Article not found');
    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw new Error('invalid title');
      a.title = patch.title.trim();
      a.slug = slugify(patch.title);
    }
    if (patch.category !== undefined) {
      if (patch.category.trim() === '') throw new Error('invalid category');
      a.category = patch.category.trim();
    }
    if (patch.body !== undefined) a.body = patch.body;
    if (patch.status !== undefined) a.status = patch.status;
    a.updatedAt = new Date().toISOString();
    this.persist();
    return { ...a };
  }

  async deleteArticle(id: string): Promise<void> {
    this.data.kb = this.data.kb.filter((a) => a.id !== id);
    this.persist();
  }

  async createAiAgent(input: AiAgentCreate): Promise<AiAgent> {
    const agent: AiAgent = {
      id: nextId(this.data.aiAgents, 'ai_', 1),
      name: input.name.trim(),
      avatarHue: djb2(input.name.trim()) % 360,
      enabled: true,
      autonomy: input.autonomy,
      scopeTags: input.scopeTags ?? [],
      scopePriorities: input.scopePriorities ?? [],
      scopeCategories: input.scopeCategories ?? [],
      createdAt: new Date().toISOString(),
    };
    this.data.aiAgents.push(agent);
    this.persist();
    return { ...agent };
  }

  async updateAiAgent(id: string, patch: AiAgentPatch): Promise<AiAgent> {
    const a = this.data.aiAgents.find((x) => x.id === id);
    if (!a) throw new Error('Agent not found');
    if (patch.name !== undefined) a.name = patch.name.trim();
    if (patch.enabled !== undefined) a.enabled = patch.enabled;
    if (patch.autonomy !== undefined) a.autonomy = patch.autonomy;
    if (patch.scopeTags !== undefined) a.scopeTags = patch.scopeTags;
    if (patch.scopePriorities !== undefined) a.scopePriorities = patch.scopePriorities;
    this.persist();
    return { ...a };
  }

  async deleteAiAgent(id: string): Promise<void> {
    this.data.aiAgents = this.data.aiAgents.filter((a) => a.id !== id);
    this.persist();
  }

  async runAgents(ticketId?: string): Promise<{ created: number }> {
    const firstContactBody = (id: string) =>
      this.data.messages
        .filter((m) => m.ticketId === id)
        .sort((a, b) => a.at.localeCompare(b.at))
        .find((m) => m.authorKind === 'contact')?.body ?? '';
    // Manual per-ticket run (the "Suggest a reply" button).
    if (ticketId !== undefined) {
      const t = this.data.tickets.find((x) => x.id === ticketId);
      const created = t && this.runAgentsOnTicket(t, firstContactBody(t.id), { manual: true }) !== null ? 1 : 0;
      this.persist();
      return { created };
    }
    const actioned = new Set(this.data.aiActions.map((a) => a.ticketId));
    let created = 0;
    for (const t of this.data.tickets) {
      if (t.bucket !== 'inbox' || (t.status !== 'open' && t.status !== 'pending')) continue;
      if (actioned.has(t.id)) continue;
      if (this.runAgentsOnTicket(t, firstContactBody(t.id), { manual: true }) !== null) created += 1;
    }
    this.persist();
    return { created };
  }

  async approveAction(id: string): Promise<{ action: AiAction; ticket: Ticket; message: Message }> {
    const action = this.data.aiActions.find((a) => a.id === id);
    if (!action) throw new Error('Action not found');
    if (action.kind !== 'draft' || action.status !== 'pending') throw new Error('not an approvable draft');
    const t = this.ticket(action.ticketId);
    const now = new Date().toISOString();
    const message: Message = {
      id: nextId(this.data.messages, 'm_', 5), ticketId: t.id, authorKind: 'agent',
      authorId: CURRENT_AGENT_ID, kind: 'reply', body: action.draftBody ?? '', at: now,
    };
    this.data.messages.push(message);
    if (t.status === 'open') t.status = 'pending';
    if (t.firstRespondedAt === null) t.firstRespondedAt = now;
    t.updatedAt = now;
    t.lastMessageAt = now;
    t.lastMessagePreview = preview(action.draftBody ?? '');
    action.status = 'approved';
    action.resolvedAt = now;
    this.persist();
    return { action: { ...action }, ticket: { ...t, tags: [...t.tags] }, message: { ...message } };
  }

  async dismissAction(id: string): Promise<{ action: AiAction }> {
    const action = this.data.aiActions.find((a) => a.id === id);
    if (!action) throw new Error('Action not found');
    action.status = 'dismissed';
    action.resolvedAt = new Date().toISOString();
    this.persist();
    return { action: { ...action } };
  }

  async createChannel(input: ChannelCreate): Promise<ChannelConn> {
    const channel: ChannelConn = {
      id: nextId(this.data.channels, 'ch_', 1),
      type: input.type,
      name: input.name.trim(),
      enabled: true,
      inboundToken: `tok_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`,
      address: input.address?.trim() ? input.address.trim() : null,
      createdAt: new Date().toISOString(),
      outboundUrl: input.outboundUrl?.trim() ? input.outboundUrl.trim() : null,
      hasOutboundSecret: Boolean(input.outboundSecret?.trim()),
      hasInboundSecret: Boolean(input.inboundSecret?.trim()),
    };
    this.data.channels.push(channel);
    this.persist();
    return { ...channel };
  }

  async updateChannel(id: string, patch: ChannelPatch): Promise<ChannelConn> {
    const ch = this.data.channels.find((x) => x.id === id);
    if (!ch) throw new Error('Channel not found');
    if (patch.name !== undefined) ch.name = patch.name.trim();
    if (patch.enabled !== undefined) ch.enabled = patch.enabled;
    if (patch.address !== undefined) ch.address = patch.address && patch.address.trim() !== '' ? patch.address.trim() : null;
    if (patch.outboundUrl !== undefined) ch.outboundUrl = patch.outboundUrl && patch.outboundUrl.trim() !== '' ? patch.outboundUrl.trim() : null;
    if (patch.outboundSecret !== undefined) ch.hasOutboundSecret = patch.outboundSecret !== null && patch.outboundSecret.trim() !== '';
    if (patch.inboundSecret !== undefined) ch.hasInboundSecret = patch.inboundSecret !== null && patch.inboundSecret.trim() !== '';
    this.persist();
    return { ...ch };
  }

  async deleteChannel(id: string): Promise<void> {
    this.data.channels = this.data.channels.filter((c) => c.id !== id);
    this.persist();
  }

  async testChannel(_id: string): Promise<ChannelTestResult> {
    return { ok: false, error: 'Outbound delivery runs on the live server, not this demo.' };
  }

  async createCustomField(input: CustomFieldCreate): Promise<CustomFieldDef> {
    const field: CustomFieldDef = {
      id: nextId(this.data.customFields, 'cf_', 1),
      entity: input.entity,
      label: input.label.trim(),
      type: input.type,
      options: (input.options ?? []).map((o) => o.trim()).filter((o) => o !== ''),
      required: input.required === true,
      position: this.data.customFields.filter((f) => f.entity === input.entity).length,
      createdAt: new Date().toISOString(),
    };
    this.data.customFields.push(field);
    this.persist();
    return { ...field, options: [...field.options] };
  }

  async updateCustomField(id: string, patch: CustomFieldPatch): Promise<CustomFieldDef> {
    const f = this.data.customFields.find((x) => x.id === id);
    if (!f) throw new Error('Custom field not found');
    if (patch.label !== undefined) f.label = patch.label.trim();
    if (patch.type !== undefined) f.type = patch.type;
    if (patch.options !== undefined) f.options = patch.options.map((o) => o.trim()).filter((o) => o !== '');
    if (patch.required !== undefined) f.required = patch.required;
    if (patch.position !== undefined) f.position = patch.position;
    this.persist();
    return { ...f, options: [...f.options] };
  }

  async deleteCustomField(id: string): Promise<void> {
    this.data.customFields = this.data.customFields.filter((f) => f.id !== id);
    this.persist();
  }

  async createSavedView(input: SavedViewCreate): Promise<SavedView> {
    const view: SavedView = { id: nextId(this.data.savedViews, 'sv_', 1), ...input };
    this.data.savedViews.push(view);
    this.persist();
    return { ...view };
  }

  async deleteSavedView(id: string): Promise<void> {
    this.data.savedViews = this.data.savedViews.filter((v) => v.id !== id);
    this.persist();
  }

  async markNotificationsRead(id?: string): Promise<Notification[]> {
    const now = new Date().toISOString();
    for (const n of this.data.notifications) {
      if (n.agentId !== CURRENT_AGENT_ID) continue;
      if ((id === undefined || n.id === id) && n.readAt === null) n.readAt = now;
    }
    this.persist();
    return [...this.data.notifications]
      .filter((n) => n.agentId === CURRENT_AGENT_ID)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({ ...n }));
  }

  async exportCsv(type: ImportType): Promise<string> {
    if (type === 'contacts') {
      const rows = this.data.contacts.map((c) => [c.name, c.email, c.company, c.mrr, c.location, c.createdAt]);
      return toCsv(['name', 'email', 'company', 'mrr', 'location', 'createdAt'], rows);
    }
    const agentName = (id: string | null) => (id !== null ? this.data.agents.find((a) => a.id === id)?.name ?? '' : '');
    const rows = [...this.data.tickets]
      .sort((a, b) => a.number - b.number)
      .map((t) => {
        const email = this.data.contacts.find((c) => c.id === t.requesterId)?.email ?? '';
        return [t.number, t.subject, t.status, t.priority, email, agentName(t.assigneeId), t.tags.join(', '), t.channel, t.createdAt, t.updatedAt, t.resolvedAt];
      });
    return toCsv(['number', 'subject', 'status', 'priority', 'requesterEmail', 'assignee', 'tags', 'channel', 'createdAt', 'updatedAt', 'resolvedAt'], rows);
  }

  async importData(input: ImportInput): Promise<ImportResult> {
    const { type } = input;
    const { headers, rows } = parseCsv(input.csv);
    const mapping = autoMapColumns(type, headers);
    if (input.mapping) {
      const keys = new Set(IMPORT_FIELDS[type].map((f) => f.key));
      for (const [k, v] of Object.entries(input.mapping)) {
        if (keys.has(k) && typeof v === 'string' && headers.includes(v)) mapping[k] = v;
        else if (keys.has(k) && v === '') delete mapping[k];
      }
    }
    const fields = IMPORT_FIELDS[type];
    const dryRun = input.dryRun === true;
    const skipped: { row: number; reason: string }[] = [];
    const errors: { row: number; reason: string }[] = [];
    let created = 0;
    const base: ImportResult = { type, headers, mapping, fields, rowCount: rows.length, dryRun, created: 0, skippedCount: 0, errorCount: 0, skipped, errors };
    if (headers.length === 0) return { ...base, error: 'no columns found in the CSV' };
    const missing = fields.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label);
    if (missing.length > 0) return { ...base, error: `Map a column for: ${missing.join(', ')}` };

    const val = (row: Record<string, string>, key: string): string => (mapping[key] ? (row[mapping[key]] ?? '').trim() : '');
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const PRIOS = ['urgent', 'high', 'medium', 'low'];
    const STATS = ['open', 'pending', 'on_hold', 'solved', 'closed'];

    rows.forEach((row, idx) => {
      const line = idx + 2;
      if (type === 'contacts') {
        const name = val(row, 'name');
        const email = val(row, 'email').toLowerCase();
        if (name === '' || email === '') return void errors.push({ row: line, reason: 'missing name or email' });
        if (!IMPORT_EMAIL_RE.test(email)) return void errors.push({ row: line, reason: `invalid email "${email}"` });
        if (seen.has(email) || this.data.contacts.some((c) => c.email.toLowerCase() === email)) return void skipped.push({ row: line, reason: `${email} already exists` });
        seen.add(email);
        if (!dryRun) {
          this.data.contacts.push({ id: nextId(this.data.contacts, 'c_', 2), name, email, company: val(row, 'company') || null, avatarHue: djb2(email) % 360, location: null, timezone: null, createdAt: now, mrr: null });
        }
        created += 1;
      } else {
        const subject = val(row, 'subject');
        const email = val(row, 'requesterEmail').toLowerCase();
        if (subject === '' || email === '') return void errors.push({ row: line, reason: 'missing subject or requester email' });
        if (!IMPORT_EMAIL_RE.test(email)) return void errors.push({ row: line, reason: `invalid email "${email}"` });
        const rawPriority = val(row, 'priority').toLowerCase();
        const priority = (PRIOS.includes(rawPriority) ? rawPriority : 'medium') as TicketPriority;
        const rawStatus = val(row, 'status').toLowerCase().replace(/\s+/g, '_');
        const status = (STATS.includes(rawStatus) ? rawStatus : 'open') as TicketStatus;
        const tags = val(row, 'tags').split(/[,;]/).map((t) => t.trim()).filter((t) => t !== '');
        const bodyText = val(row, 'body') || subject;
        if (!dryRun) {
          let contact = this.data.contacts.find((c) => c.email.toLowerCase() === email);
          if (contact === undefined) {
            contact = { id: nextId(this.data.contacts, 'c_', 2), name: email.split('@')[0], email, company: null, avatarHue: djb2(email) % 360, location: null, timezone: null, createdAt: now, mrr: null };
            this.data.contacts.push(contact);
          }
          const number = this.data.tickets.reduce((m, t) => Math.max(m, t.number), 0) + 1;
          const resolved = status === 'solved' || status === 'closed';
          const ticket: Ticket = {
            id: nextId(this.data.tickets, 't_', 3), number, subject, status, priority, bucket: 'inbox',
            requesterId: contact.id, assigneeId: null, tags, channel: 'web', createdAt: now, updatedAt: now,
            snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(bodyText),
            firstRespondedAt: null, resolvedAt: resolved ? now : null, channelId: null, mergedIntoId: null, customFields: {},
            awaitingReply: !resolved, category: null,
          };
          this.data.tickets.push(ticket);
          this.data.messages.push({ id: nextId(this.data.messages, 'm_', 5), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body: bodyText, at: now });
        }
        created += 1;
      }
    });
    if (!dryRun) this.persist();
    return { ...base, created, skippedCount: skipped.length, errorCount: errors.length, skipped: skipped.slice(0, 100), errors: errors.slice(0, 100) };
  }

  async getStats(): Promise<StatsOverview> {
    const now = new Date();
    const nowIso = now.toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY).toISOString();
    const solvedStatuses: TicketStatus[] = ['solved', 'closed'];
    const activeStatuses: TicketStatus[] = ['open', 'pending', 'on_hold'];

    const days: string[] = [];
    for (let i = 13; i >= 0; i--) days.push(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10));
    const createdByDay = new Map<string, number>(days.map((d) => [d, 0]));
    const solvedByDay = new Map<string, number>(days.map((d) => [d, 0]));

    const byPriority: Record<TicketPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
    const byStatus: Record<TicketStatus, number> = { open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0 };

    let openNow = 0;
    let createdLast7Days = 0;
    let solvedLast7Days = 0;
    const tagCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();

    for (const t of this.data.tickets) {
      // Priority/status mix is scoped to the inbox bucket, matching the server.
      if (t.bucket === 'inbox') {
        byPriority[t.priority] += 1;
        byStatus[t.status] += 1;
      }
      for (const tag of t.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (t.category !== null && t.category.trim() !== '') catCounts.set(t.category, (catCounts.get(t.category) ?? 0) + 1);
      const createdDay = t.createdAt.slice(0, 10);
      if (createdByDay.has(createdDay)) createdByDay.set(createdDay, createdByDay.get(createdDay)! + 1);
      if (t.createdAt >= sevenDaysAgo) createdLast7Days += 1;
      if (solvedStatuses.includes(t.status)) {
        // A ticket counts as solved on the day of its last update.
        const solvedDay = t.updatedAt.slice(0, 10);
        if (solvedByDay.has(solvedDay)) solvedByDay.set(solvedDay, solvedByDay.get(solvedDay)! + 1);
        if (t.updatedAt >= sevenDaysAgo) solvedLast7Days += 1;
      }
      const snoozed = t.snoozedUntil !== null && t.snoozedUntil > nowIso;
      if (t.bucket === 'inbox' && !snoozed && t.status === 'open') openNow += 1;
    }

    // First agent reply per ticket (messages scanned in chronological order).
    const firstAgentReply = new Map<string, { at: string; authorId: string | null }>();
    for (const m of [...this.data.messages].sort((a, b) => a.at.localeCompare(b.at))) {
      if (m.authorKind === 'agent' && m.kind === 'reply' && !firstAgentReply.has(m.ticketId)) {
        firstAgentReply.set(m.ticketId, { at: m.at, authorId: m.authorId });
      }
    }
    // Per-agent performance accumulators (mirrors the server).
    const agentIds = this.data.agents.map((a) => a.id);
    const firstReplyByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
    const resolutionByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
    const csatByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
    const solvedByAgent = new Map<string, number>(agentIds.map((id) => [id, 0]));
    const firstReplyMinutes: number[] = [];
    const resolutionHours: number[] = [];
    for (const t of this.data.tickets) {
      const reply = firstAgentReply.get(t.id);
      if (reply !== undefined) {
        const delta = (Date.parse(reply.at) - Date.parse(t.createdAt)) / MIN;
        if (delta >= 0) {
          firstReplyMinutes.push(delta);
          if (reply.authorId !== null && firstReplyByAgent.has(reply.authorId)) firstReplyByAgent.get(reply.authorId)!.push(delta);
        }
      }
      if (solvedStatuses.includes(t.status)) {
        const h = (Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / HOUR;
        resolutionHours.push(h);
        if (t.assigneeId !== null && solvedByAgent.has(t.assigneeId)) {
          solvedByAgent.set(t.assigneeId, solvedByAgent.get(t.assigneeId)! + 1);
          if (h >= 0) resolutionByAgent.get(t.assigneeId)!.push(h);
        }
      }
      if (typeof t.satisfactionScore === 'number' && t.assigneeId !== null && csatByAgent.has(t.assigneeId)) {
        csatByAgent.get(t.assigneeId)!.push(t.satisfactionScore);
      }
    }

    const perAgentOpen = this.data.agents
      .map((a) => ({
        agentId: a.id,
        count: this.data.tickets.filter(
          (t) => t.bucket === 'inbox' && t.assigneeId === a.id && activeStatuses.includes(t.status),
        ).length,
      }))
      .sort((a, b) => b.count - a.count);
    const openLoadByAgent = new Map(perAgentOpen.map((p) => [p.agentId, p.count]));
    const perAgentPerformance = agentIds
      .map((agentId) => {
        const fr = firstReplyByAgent.get(agentId)!;
        const cs = csatByAgent.get(agentId)!;
        return {
          agentId,
          solved: solvedByAgent.get(agentId)!,
          openLoad: openLoadByAgent.get(agentId) ?? 0,
          firstReplyCount: fr.length,
          medianFirstReplyMinutes: Math.round(median(fr)),
          medianResolutionHours: Math.round(median(resolutionByAgent.get(agentId)!) * 10) / 10,
          csatCount: cs.length,
          csatAverage: cs.length === 0 ? 0 : Math.round((cs.reduce((s, v) => s + v, 0) / cs.length) * 10) / 10,
        };
      })
      .sort((a, b) => b.solved - a.solved);

    return {
      createdLast14Days: days.map((date) => ({ date, count: createdByDay.get(date)! })),
      solvedLast14Days: days.map((date) => ({ date, count: solvedByDay.get(date)! })),
      byPriority,
      byStatus,
      perAgentOpen,
      perAgentPerformance,
      topTags: [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      byCategory: [...catCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      forecastNext7Days: linearForecast(days.map((d) => createdByDay.get(d)!), 7).map((count, i) => ({
        date: new Date(now.getTime() + (i + 1) * DAY).toISOString().slice(0, 10),
        count,
      })),
      medianFirstReplyMinutes: Math.round(median(firstReplyMinutes)),
      medianResolutionHours: Math.round(median(resolutionHours) * 10) / 10,
      openNow,
      createdLast7Days,
      solvedLast7Days,
      revenue: computeRevenue(this.data.deals, now),
      csat: this.computeCsat(),
    };
  }

  private computeCsat() {
    const rated = this.data.tickets.filter((t) => typeof t.satisfactionScore === 'number');
    return {
      count: rated.length,
      average:
        rated.length === 0
          ? 0
          : Math.round((rated.reduce((s, t) => s + (t.satisfactionScore ?? 0), 0) / rated.length) * 10) / 10,
      positivePct:
        rated.length === 0
          ? 0
          : Math.round((rated.filter((t) => (t.satisfactionScore ?? 0) >= 4).length / rated.length) * 100),
    };
  }

  async search(q: string): Promise<{ ticketIds: string[] }> {
    const query = q.trim().toLowerCase();
    if (query === '') return { ticketIds: [] };
    const contactsById = new Map(this.data.contacts.map((c) => [c.id, c]));
    const bodiesByTicket = new Map<string, string[]>();
    for (const m of this.data.messages) {
      const list = bodiesByTicket.get(m.ticketId);
      if (list) list.push(m.body.toLowerCase());
      else bodiesByTicket.set(m.ticketId, [m.body.toLowerCase()]);
    }
    const matches = this.data.tickets.filter((t) => {
      if (t.subject.toLowerCase().includes(query)) return true;
      if (t.lastMessagePreview.toLowerCase().includes(query)) return true;
      const contact = contactsById.get(t.requesterId);
      if (contact && (contact.name.toLowerCase().includes(query) || contact.email.toLowerCase().includes(query))) return true;
      if (t.tags.some((tag) => tag.toLowerCase().includes(query))) return true;
      const bodies = bodiesByTicket.get(t.id);
      return bodies !== undefined && bodies.some((b) => b.includes(query));
    });
    matches.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return { ticketIds: matches.slice(0, 30).map((t) => t.id) };
  }
}
