import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, AiProvider, AiProviderSave, AiTestResult, Agent, AgentInvite,
  AgentPatch, ArticleCreate, ArticlePatch, ArticleStatus, AutomationCondition, AutomationRule, CannedReply,
  ChannelConn, ChannelCreate, ChannelPatch, Contact, CopilotTriage, Deal, DealCreate, DealPatch, DealStage, DealType,
  DraftResult, KbArticle, Message, SlaHours, SlaTargets, StatsOverview, SummaryResult, Ticket, TicketPatch,
  TicketPriority, TicketStatus,
} from './types';
import type { BootstrapData, Repository } from './repository';
import { computeRevenue } from './deal-stats';
import { DEFAULT_AI_PROVIDER, DEFAULT_AUTOMATION, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, normalizeAutomation } from './defaults';
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
    tickets: seed.tickets.map((t) => ({ ...t, tags: [...t.tags] })),
    messages: seed.messages.map((m) => ({ ...m })),
    contacts: seed.contacts.map((c) => ({ ...c })),
    agents: seed.agents.map((a) => ({ ...a })),
    canned: seed.canned.map((c) => ({ ...c })),
    deals: seed.deals.map((d) => ({ ...d })),
    sla: DEFAULT_SLA_TARGETS,
    slaHours: { ...DEFAULT_SLA_HOURS, days: [...DEFAULT_SLA_HOURS.days] },
    automation: DEFAULT_AUTOMATION.map((r) => ({ ...r })),
    kb: seed.kb.map((a) => ({ ...a })),
    aiAgents: seed.aiAgents.map((a) => ({ ...a })),
    aiActions: seed.aiActions.map((a) => ({ ...a })),
    channels: seed.channels.map((c) => ({ ...c })),
    aiProvider: { ...DEFAULT_AI_PROVIDER },
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
        this.data.channels = (seedJson as unknown as LocalData).channels.map((ch) => ({ ...ch }));
        for (const t of this.data.tickets) {
          if (t.channelId === undefined) t.channelId = t.channel === 'chat' ? 'ch_1' : t.channel === 'email' ? 'ch_2' : null;
        }
        this.persist();
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
      channels: this.data.channels.map((ch) => ({ ...ch })),
      aiProvider: { ...this.data.aiProvider },
    };
  }

  async getMessages(ticketId: string): Promise<Message[]> {
    return this.data.messages
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((m) => ({ ...m }));
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
    this.persist();
    return { ticket: { ...ticket, tags: [...ticket.tags] }, message: { ...message } };
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
    this.persist();
    return { ...t, tags: [...t.tags] };
  }

  async addMessage(ticketId: string, input: { kind: 'reply' | 'note'; body: string }): Promise<{ message: Message; ticket: Ticket }> {
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
    t.updatedAt = now;
    t.lastMessageAt = now;
    if (input.kind === 'reply') {
      t.lastMessagePreview = preview(input.body);
      if (t.status === 'open') t.status = 'pending';
      if (t.firstRespondedAt === null) t.firstRespondedAt = now;
    }
    this.persist();
    return { message: { ...message }, ticket: { ...t, tags: [...t.tags] } };
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
    if (existing) {
      existing.title = c.title;
      existing.body = c.body;
      this.persist();
      return { ...existing };
    }
    const created: CannedReply = {
      id: c.id || nextId(this.data.canned, 'cr_', 1),
      title: c.title,
      body: c.body,
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
    return { body, source: 'rules' };
  }

  async aiTriage(ticketId: string): Promise<CopilotTriage> {
    const ticket = this.ticket(ticketId);
    const bodyText =
      this.data.messages
        .filter((m) => m.ticketId === ticketId && m.authorKind === 'contact' && m.kind === 'reply')
        .map((m) => m.body)
        .join('\n') || ticket.lastMessagePreview;
    const t = suggestTriage({ subject: ticket.subject, bodyText, currentPriority: ticket.priority, currentTags: ticket.tags });
    return { priority: t.priority, tags: t.tags, reason: t.reason, source: 'rules' };
  }

  async aiSummarize(ticketId: string): Promise<SummaryResult> {
    const ticket = this.ticket(ticketId);
    const contact = this.data.contacts.find((c) => c.id === ticket.requesterId);
    const messages = this.data.messages
      .filter((m) => m.ticketId === ticketId)
      .sort((a, b) => a.at.localeCompare(b.at));
    const summary = summarizeThread({ contactName: contact?.name ?? 'there', messages });
    return { summary, source: 'rules' };
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
    this.persist();
    return { ...ch };
  }

  async deleteChannel(id: string): Promise<void> {
    this.data.channels = this.data.channels.filter((c) => c.id !== id);
    this.persist();
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
