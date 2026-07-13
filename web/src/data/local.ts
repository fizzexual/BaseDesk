import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, Agent, AgentInvite,
  AgentPatch, ArticleCreate, ArticlePatch, ArticleStatus, AutomationCondition, AutomationRule, CannedReply,
  Attachment, ChannelConn, ChannelCreate, ChannelPatch, ChannelTestResult, Contact, CopilotTriage, CustomFieldCreate, CustomFieldDef, CustomFieldPatch, SavedView, SavedViewCreate, Deal, DealCreate, DealPatch, DealStage, DealType,
  AssignmentSettings, DraftResult, ImportInput, ImportResult, ImportType, KbArticle, Message, Notification, SlaHours, SlaTargets, SmtpSave, SmtpSettings, SmtpTestResult, StatsOverview,
  SummaryResult, Ticket, TicketEvent, TicketPatch, TicketPriority, TicketStatus,
} from './types';
import { autoMapColumns, IMPORT_EMAIL_RE, IMPORT_FIELDS, parseCsv, toCsv } from './import';
import type { BootstrapData, Repository } from './repository';
import { registerLocalAttachment } from './attachments';
import { computeRevenue } from './deal-stats';
import { DEFAULT_AI_PROVIDER, DEFAULT_AUTOMATION, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, DEFAULT_SMTP, normalizeAutomation } from './defaults';
import { draftReply, runAgent, suggestTriage, summarizeThread } from '../features/ai/engine';
import seedJson from '../../../shared/seed.json';

const AUTONOMY_RANK: Record<string, number> = { resolve: 3, draft: 2, suggest: 1 };

const RESOLVED: TicketStatus[] = ['solved', 'closed'];
const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const AUTO_STATUSES: TicketStatus[] = ['open', 'pending', 'on_hold', 'solved', 'closed'];

/** Fields automation reads and may mutate on a freshly created ticket. */
interface AutoMut {
  subject: string; priority: TicketPriority; tags: string[];
  assigneeId: string | null; status: TicketStatus;
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
  notifications: Notification[];
  assignment: AssignmentSettings;
  assignmentRr: number; // round-robin cursor
  events: TicketEvent[];
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

function seedData(): LocalData {
  const seed = seedJson as unknown as LocalData;
  return {
    tickets: seed.tickets.map((t) => ({ ...t, tags: [...t.tags], mergedIntoId: t.mergedIntoId ?? null, customFields: { ...(t.customFields ?? {}) } })),
    messages: seed.messages.map((m) => ({ ...m })),
    contacts: seed.contacts.map((c) => ({ ...c })),
    agents: seed.agents.map((a) => ({ ...a })),
    canned: seed.canned.map((c) => ({ ...c, actions: c.actions ?? null })),
    deals: seed.deals.map((d) => ({ ...d })),
    sla: DEFAULT_SLA_TARGETS,
    slaHours: { ...DEFAULT_SLA_HOURS, days: [...DEFAULT_SLA_HOURS.days] },
    automation: DEFAULT_AUTOMATION.map((r) => ({ ...r })),
    kb: seed.kb.map((a) => ({ ...a })),
    aiAgents: seed.aiAgents.map((a) => ({ ...a })),
    aiActions: seed.aiActions.map((a) => ({ ...a })),
    channels: seed.channels.map((c) => ({ ...c, outboundUrl: c.outboundUrl ?? null, hasOutboundSecret: c.hasOutboundSecret ?? false, hasInboundSecret: c.hasInboundSecret ?? false })),
    aiProvider: { ...DEFAULT_AI_PROVIDER },
    smtp: { ...DEFAULT_SMTP },
    customFields: (seed.customFields ?? []).map((f) => ({ ...f, options: [...f.options] })),
    attachments: [],
    savedViews: [],
    assignment: { enabled: false, strategy: 'round_robin' },
    assignmentRr: 0,
    events: [],
    // Seed notifications ship without the joined display fields; resolve them here.
    notifications: (seed.notifications ?? []).map((n) => ({
      ...n,
      actorName: seed.agents.find((a) => a.id === n.actorId)?.name ?? 'A teammate',
      ticketSubject: seed.tickets.find((t) => t.id === n.ticketId)?.subject ?? '(ticket)',
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
      if (this.data.assignment === undefined) {
        this.data.assignment = { enabled: false, strategy: 'round_robin' };
        this.data.assignmentRr = 0;
        this.persist();
      }
      if (!Array.isArray(this.data.events)) {
        this.data.events = [];
        this.persist();
      }
      // Older demo data predates macro actions; default them to a plain reply.
      for (const c of this.data.canned) {
        if (c.actions === undefined) c.actions = null;
      }
      // Older demo tickets predate merge; default the pointer to null.
      for (const t of this.data.tickets) {
        if (t.mergedIntoId === undefined) t.mergedIntoId = null;
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
      tickets: this.data.tickets.map((t) => ({ ...t, tags: [...t.tags] })),
      contacts: this.data.contacts.map((c) => ({ ...c })),
      agents: this.data.agents.map((a) => ({ ...a })),
      canned: this.data.canned.map((c) => ({ ...c })),
      deals: [...this.data.deals]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((d) => ({ ...d })),
      currentAgentId: CURRENT_AGENT_ID,
      sla: this.data.sla,
      slaHours: { ...this.data.slaHours, days: [...this.data.slaHours.days] },
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
    };
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

  async createTicket(input: { subject: string; body: string; requesterId: string; priority: TicketPriority }): Promise<{ ticket: Ticket; message: Message }> {
    const now = new Date().toISOString();
    const number = this.data.tickets.reduce((max, t) => Math.max(max, t.number), 0) + 1;
    const shaped: AutoMut = { subject: input.subject, priority: input.priority, tags: [], assigneeId: null, status: 'open' };
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
      customFields: {},
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
    this.runAgentsOnTicket(ticket, input.body);
    this.autoAssign(ticket);
    this.persist();
    return { ticket: { ...ticket, tags: [...ticket.tags] }, message: { ...message } };
  }

  /** Mirrors the server: route an unassigned new ticket to an active agent when enabled. */
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

  /** Mirrors the server: highest-autonomy enabled agent acts on a new ticket. */
  private runAgentsOnTicket(ticket: Ticket, firstBody: string): AiAction | null {
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
      const now = new Date().toISOString();
      const action: AiAction = {
        id: nextId(this.data.aiActions, 'act_', 3), agentId: agent.id, ticketId: ticket.id,
        kind: decision.kind, status: decision.kind === 'resolve' ? 'sent' : 'pending',
        draftBody: decision.draftBody, suggestedPriority: decision.suggestedPriority,
        suggestedTags: decision.suggestedTags, kbArticleId: decision.kbArticleId,
        promptTokens: 0, completionTokens: 0, // demo mode is rule-based — no model tokens
        createdAt: now, resolvedAt: decision.kind === 'resolve' ? now : null,
      };
      this.data.aiActions.push(action);
      if (decision.kind === 'resolve' && decision.draftBody !== null) {
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
    return { ...t, tags: [...t.tags] };
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
      out.push({ ...t, tags: [...t.tags] });
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

  async addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string; attachmentIds?: string[] }): Promise<{ message: Message; ticket: Ticket }> {
    const t = this.ticket(ticketId);
    const now = new Date().toISOString();
    const message: Message = {
      id: nextId(this.data.messages, 'm_', 5),
      ticketId,
      authorKind: 'agent',
      authorId: CURRENT_AGENT_ID,
      kind: input.kind,
      body: input.body,
      at: now,
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
      t.lastMessagePreview = input.body.trim() !== '' ? preview(input.body) : 'Sent an attachment';
      if (t.status === 'open') t.status = 'pending';
      if (t.firstRespondedAt === null) t.firstRespondedAt = now;
    }
    if (input.kind === 'note') this.notifyMentions(message, t.subject);
    this.persist();
    return { message: { ...message, attachments }, ticket: { ...t, tags: [...t.tags] } };
  }

  /** Mirrors the server: an @mentioned teammate (by first name) gets a notification. */
  private notifyMentions(message: Message, ticketSubject: string): void {
    const tokens = new Set((message.body.match(/@[A-Za-z]+/g) ?? []).map((t) => t.slice(1).toLowerCase()));
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
          snippet: preview(message.body), createdAt: message.at, readAt: null,
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
    for (const m of this.data.messages) if (m.ticketId === ticketId) m.ticketId = into;
    for (const a of this.data.attachments) if (a.ticketId === ticketId) a.ticketId = into;
    this.data.messages.push({
      id: nextId(this.data.messages, 'm_', 5), ticketId: into, authorKind: 'agent',
      authorId: CURRENT_AGENT_ID, kind: 'note',
      body: `Merged ticket #${source.number} — "${source.subject}" — into this one.`, at: now,
    });
    source.mergedIntoId = into;
    source.status = 'closed';
    source.updatedAt = now;
    this.pushEvent(source.id, 'merged', CURRENT_AGENT_ID, { targetId: into, targetNumber: target.number }, now);
    const newestReply = this.data.messages
      .filter((m) => m.ticketId === into && m.kind === 'reply' && !m.deletedAt)
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1);
    target.updatedAt = now;
    if (newestReply) {
      target.lastMessageAt = newestReply.at;
      target.lastMessagePreview = preview(newestReply.body);
    }
    this.persist();
    return { source: { ...source, tags: [...source.tags] }, target: { ...target, tags: [...target.tags] } };
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
    this.data.slaHours = { ...hours, days: [...hours.days] };
    this.persist();
    return { ...this.data.slaHours, days: [...this.data.slaHours.days] };
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
    const next: AiProvider = {
      enabled: input.enabled ?? cur.enabled,
      baseUrl: input.baseUrl && input.baseUrl.trim() !== '' ? input.baseUrl.trim() : cur.baseUrl,
      model: input.model && input.model.trim() !== '' ? input.model.trim() : cur.model,
      temperature: typeof input.temperature === 'number' ? Math.min(2, Math.max(0, input.temperature)) : cur.temperature,
      reasoning: typeof input.reasoning === 'boolean' ? input.reasoning : cur.reasoning,
      kbOnly: typeof input.kbOnly === 'boolean' ? input.kbOnly : cur.kbOnly,
      hasKey: typeof input.apiKey === 'string' ? input.apiKey.trim() !== '' : cur.hasKey,
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

  async runAgents(): Promise<{ created: number }> {
    const actioned = new Set(this.data.aiActions.map((a) => a.ticketId));
    let created = 0;
    for (const t of this.data.tickets) {
      if (t.bucket !== 'inbox' || (t.status !== 'open' && t.status !== 'pending')) continue;
      if (actioned.has(t.id)) continue;
      const firstContact = this.data.messages
        .filter((m) => m.ticketId === t.id)
        .sort((a, b) => a.at.localeCompare(b.at))
        .find((m) => m.authorKind === 'contact');
      if (this.runAgentsOnTicket(t, firstContact?.body ?? '') !== null) created += 1;
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

    for (const t of this.data.tickets) {
      // Priority/status mix is scoped to the inbox bucket, matching the server.
      if (t.bucket === 'inbox') {
        byPriority[t.priority] += 1;
        byStatus[t.status] += 1;
      }
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
    const firstAgentReply = new Map<string, string>();
    for (const m of [...this.data.messages].sort((a, b) => a.at.localeCompare(b.at))) {
      if (m.authorKind === 'agent' && m.kind === 'reply' && !firstAgentReply.has(m.ticketId)) {
        firstAgentReply.set(m.ticketId, m.at);
      }
    }
    const firstReplyMinutes: number[] = [];
    const resolutionHours: number[] = [];
    for (const t of this.data.tickets) {
      const replyAt = firstAgentReply.get(t.id);
      if (replyAt !== undefined) {
        const delta = (Date.parse(replyAt) - Date.parse(t.createdAt)) / MIN;
        if (delta >= 0) firstReplyMinutes.push(delta);
      }
      if (solvedStatuses.includes(t.status)) {
        resolutionHours.push((Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / HOUR);
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

    return {
      createdLast14Days: days.map((date) => ({ date, count: createdByDay.get(date)! })),
      solvedLast14Days: days.map((date) => ({ date, count: solvedByDay.get(date)! })),
      byPriority,
      byStatus,
      perAgentOpen,
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
