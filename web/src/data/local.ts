import type {
  AiAction, AiAgent, AiAgentCreate, AiAgentPatch, Agent, ArticleCreate, ArticlePatch, ArticleStatus, AutomationRule,
  CannedReply, Contact, Deal, DealCreate, DealPatch, DealStage, DealType, KbArticle, Message, SlaTargets,
  StatsOverview, Ticket, TicketPatch, TicketPriority, TicketStatus,
} from './types';
import type { BootstrapData, Repository } from './repository';
import { computeRevenue } from './deal-stats';
import { DEFAULT_AUTOMATION, DEFAULT_SLA_TARGETS } from './defaults';
import { runAgent } from '../features/ai/engine';
import seedJson from '../../../shared/seed.json';

const AUTONOMY_RANK: Record<string, number> = { resolve: 3, draft: 2, suggest: 1 };

const RESOLVED: TicketStatus[] = ['solved', 'closed'];

/** Mirrors the server's create-time automation. */
function applyAutomationLocal(
  rules: AutomationRule[],
  ticket: { subject: string; priority: TicketPriority; tags: string[]; assigneeId: string | null },
  body: string,
): void {
  const subject = ticket.subject.toLowerCase();
  const bodyLc = body.toLowerCase();
  const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const v = rule.condition.value.toLowerCase();
    const matches =
      rule.condition.type === 'subject_contains' ? subject.includes(v)
      : rule.condition.type === 'body_contains' ? bodyLc.includes(v)
      : rule.condition.type === 'priority_is' ? ticket.priority === rule.condition.value
      : false;
    if (!matches) continue;
    if (rule.action.type === 'set_priority' && PRIORITIES.includes(rule.action.value as TicketPriority)) {
      ticket.priority = rule.action.value as TicketPriority;
    } else if (rule.action.type === 'add_tag') {
      if (!ticket.tags.includes(rule.action.value)) ticket.tags.push(rule.action.value);
    } else if (rule.action.type === 'assign') {
      ticket.assigneeId = rule.action.value;
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
  automation: AutomationRule[];
  kb: KbArticle[];
  aiAgents: AiAgent[];
  aiActions: AiAction[];
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
    automation: DEFAULT_AUTOMATION.map((r) => ({ ...r })),
    kb: seed.kb.map((a) => ({ ...a })),
    aiAgents: seed.aiAgents.map((a) => ({ ...a })),
    aiActions: seed.aiActions.map((a) => ({ ...a })),
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
      automation: this.data.automation.map((r) => ({ ...r })),
      kb: this.data.kb.map((a) => ({ ...a })),
      aiAgents: this.data.aiAgents.map((a) => ({ ...a })),
      aiActions: this.data.aiActions.map((a) => ({ ...a })),
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
    const shaped = { subject: input.subject, priority: input.priority, tags: [] as string[], assigneeId: null as string | null };
    applyAutomationLocal(this.data.automation, shaped, input.body);
    const ticket: Ticket = {
      id: nextId(this.data.tickets, 't_', 3),
      number,
      subject: shaped.subject,
      status: 'open',
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
