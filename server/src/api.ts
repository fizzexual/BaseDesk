import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import {
  getAiAction, getAiActions, getAiAgent, getAiAgents, getChannel, getChannels, getContact, getDeal, getKbArticle,
  getMessages, getSetting, getTicket, insertAiAction, openDb, rowToTicket, setSetting, type TicketRow,
} from './db.js';
import { seedIfEmpty } from './seed-load.js';
import { computeStats } from './stats.js';
import { DEFAULT_AUTOMATION, DEFAULT_SLA_TARGETS } from './defaults.js';
import { runAgent, type AgentContext, type Autonomy } from './ai-engine.js';
import type {
  AiAction, Agent, ArticleStatus, AutomationRule, BootstrapData, CannedReply, Channel, ChannelType, Contact, Deal,
  DealStage, DealType, KbArticle, Message, SlaTargets, Ticket, TicketPatch, TicketPriority, ViewId,
} from './types.js';

const AUTONOMY_RANK: Record<Autonomy, number> = { resolve: 3, draft: 2, suggest: 1 };
const AUTONOMIES: Autonomy[] = ['suggest', 'draft', 'resolve'];
const CHANNEL_TYPES: ChannelType[] = ['webchat', 'webhook', 'email', 'discord', 'slack', 'whatsapp'];
const CHANNEL_TO_TICKET: Record<ChannelType, Channel> = {
  webchat: 'chat', webhook: 'api', email: 'email', discord: 'chat', slack: 'chat', whatsapp: 'chat',
};

const VERSION = '0.1.0';

const DEAL_TYPES: DealType[] = ['expansion', 'retention', 'inbound'];
const DEAL_STAGES: DealStage[] = ['open', 'won', 'lost'];
const RESOLVED_STATUSES = ['solved', 'closed'];

/** Applies enabled automation rules to a just-created ticket, in order. */
function applyAutomation(
  rules: AutomationRule[],
  ticket: { subject: string; priority: TicketPriority; tags: string[]; assigneeId: string | null },
  body: string,
): void {
  const subject = ticket.subject.toLowerCase();
  const bodyLc = body.toLowerCase();
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

const VIEW_IDS: ViewId[] = [
  'all', 'unassigned', 'mine', 'snoozed',
  'open', 'pending', 'on_hold', 'solved', 'closed',
  'archive', 'spam', 'trash',
];
const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'];
const BUCKETS = ['inbox', 'archive', 'spam', 'trash'];
const PATCH_KEYS = ['status', 'priority', 'assigneeId', 'tags', 'bucket', 'snoozedUntil', 'subject'] as const;

function newId(prefix: string): string {
  return `${prefix}${randomUUID().slice(0, 8)}`;
}

/** Simple djb2 string hash, used for contact avatar hues. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function preview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function insertTicketRow(db: DatabaseSync, t: Ticket): void {
  db.prepare(
    `INSERT INTO tickets (
      id, number, subject, status, priority, bucket, requesterId, assigneeId,
      tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview,
      firstRespondedAt, resolvedAt, channelId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id, t.number, t.subject, t.status, t.priority, t.bucket, t.requesterId, t.assigneeId,
    JSON.stringify(t.tags), t.channel, t.createdAt, t.updatedAt, t.snoozedUntil, t.lastMessageAt,
    t.lastMessagePreview, t.firstRespondedAt, t.resolvedAt, t.channelId,
  );
}

/**
 * Shared view semantics (must match the web store selectors):
 * - all       = bucket inbox, not snoozed (snoozedUntil null or <= now), status not closed
 * - unassigned= all AND assigneeId null AND status open|pending
 * - mine      = all AND assigneeId = currentAgentId AND status open|pending|on_hold
 * - snoozed   = bucket inbox AND snoozedUntil > now
 * - statuses  = bucket inbox, not snoozed, that status
 * - buckets   = that bucket
 */
function viewWhere(view: ViewId, nowIso: string, currentAgentId: string): { sql: string; params: string[] } {
  const notSnoozed = '(snoozedUntil IS NULL OR snoozedUntil <= ?)';
  switch (view) {
    case 'all':
      return { sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed'`, params: [nowIso] };
    case 'unassigned':
      return {
        sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed' AND assigneeId IS NULL AND status IN ('open', 'pending')`,
        params: [nowIso],
      };
    case 'mine':
      return {
        sql: `bucket = 'inbox' AND ${notSnoozed} AND status != 'closed' AND assigneeId = ? AND status IN ('open', 'pending', 'on_hold')`,
        params: [nowIso, currentAgentId],
      };
    case 'snoozed':
      return { sql: `bucket = 'inbox' AND snoozedUntil IS NOT NULL AND snoozedUntil > ?`, params: [nowIso] };
    case 'open':
    case 'pending':
    case 'on_hold':
    case 'solved':
    case 'closed':
      return { sql: `bucket = 'inbox' AND ${notSnoozed} AND status = ?`, params: [nowIso, view] };
    case 'archive':
    case 'spam':
    case 'trash':
      return { sql: 'bucket = ?', params: [view] };
  }
}

export function createApp(dataDir: string): { app: Hono; db: DatabaseSync } {
  const db = openDb(dataDir);
  seedIfEmpty(db);

  // Ensure SLA + automation settings exist (fresh install or migrated pre-v0.3 DB).
  if (getSetting(db, 'sla') === null) setSetting(db, 'sla', JSON.stringify(DEFAULT_SLA_TARGETS));
  if (getSetting(db, 'automation') === null) setSetting(db, 'automation', JSON.stringify(DEFAULT_AUTOMATION));

  const slaTargets = (): SlaTargets => {
    try {
      return JSON.parse(getSetting(db, 'sla') ?? '') as SlaTargets;
    } catch {
      return DEFAULT_SLA_TARGETS;
    }
  };
  const automationRules = (): AutomationRule[] => {
    try {
      return JSON.parse(getSetting(db, 'automation') ?? '') as AutomationRule[];
    } catch {
      return DEFAULT_AUTOMATION;
    }
  };

  const currentAgentId = (): string => {
    const row = db.prepare("SELECT id FROM agents WHERE role = 'admin' ORDER BY rowid LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new Error('no admin agent found');
    return row.id;
  };

  /**
   * Runs the enabled AI agents against a freshly-arrived ticket. The
   * highest-autonomy matching agent acts once: a resolve agent that deflects to
   * a KB article sends the reply and solves the ticket; draft/suggest agents
   * record a pending action for the queues.
   */
  const runAgentsOnTicket = (ticket: Ticket, firstBody: string): AiAction | null => {
    const agents = getAiAgents(db)
      .filter((a) => a.enabled)
      .sort((a, b) => AUTONOMY_RANK[b.autonomy] - AUTONOMY_RANK[a.autonomy]);
    if (agents.length === 0) return null;
    const contact = getContact(db, ticket.requesterId);
    const canned = db.prepare('SELECT * FROM canned_replies').all() as unknown as CannedReply[];
    const kb = db.prepare('SELECT * FROM kb_articles').all() as unknown as KbArticle[];
    for (const agent of agents) {
      const ctx: AgentContext = {
        subject: ticket.subject, bodyText: firstBody,
        contactName: contact?.name ?? 'there', agentName: agent.name,
        currentPriority: ticket.priority, currentTags: ticket.tags,
        canned, kb,
      };
      const decision = runAgent(agent, ctx);
      if (decision === null) continue;
      const now = new Date().toISOString();
      const action: AiAction = {
        id: newId('act_'), agentId: agent.id, ticketId: ticket.id, kind: decision.kind,
        status: decision.kind === 'resolve' ? 'sent' : 'pending',
        draftBody: decision.draftBody, suggestedPriority: decision.suggestedPriority,
        suggestedTags: decision.suggestedTags, kbArticleId: decision.kbArticleId,
        createdAt: now, resolvedAt: decision.kind === 'resolve' ? now : null,
      };
      insertAiAction(db, action);
      if (decision.kind === 'resolve' && decision.draftBody !== null) {
        const message: Message = {
          id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(),
          kind: 'reply', body: decision.draftBody, at: now,
        };
        db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
        db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run('solved', now, now, now, preview(decision.draftBody), now, ticket.id);
      }
      return action; // only the highest-autonomy matching agent acts
    }
    return null;
  };

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/api/bootstrap', (c) => {
    const tickets = (db.prepare('SELECT * FROM tickets ORDER BY lastMessageAt DESC').all() as unknown as TicketRow[])
      .map(rowToTicket);
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY rowid').all() as unknown as Contact[];
    const agents = db.prepare('SELECT * FROM agents ORDER BY rowid').all() as unknown as Agent[];
    const canned = db.prepare('SELECT * FROM canned_replies ORDER BY rowid').all() as unknown as CannedReply[];
    const deals = db.prepare('SELECT * FROM deals ORDER BY updatedAt DESC').all() as unknown as Deal[];
    const kb = db.prepare('SELECT * FROM kb_articles ORDER BY category, title').all() as unknown as KbArticle[];
    const data: BootstrapData = {
      tickets, contacts, agents, canned, deals,
      currentAgentId: currentAgentId(),
      sla: slaTargets(),
      automation: automationRules(),
      kb,
      aiAgents: getAiAgents(db),
      aiActions: getAiActions(db),
      channels: getChannels(db),
    };
    return c.json(data);
  });

  app.get('/api/tickets', (c) => {
    const view = c.req.query('view');
    const q = c.req.query('q');
    const priority = c.req.query('priority');
    const assigneeId = c.req.query('assigneeId');

    const clauses: string[] = [];
    const params: string[] = [];

    if (view !== undefined && view !== '') {
      if (!VIEW_IDS.includes(view as ViewId)) return c.json({ error: `unknown view: ${view}` }, 400);
      const w = viewWhere(view as ViewId, new Date().toISOString(), currentAgentId());
      clauses.push(w.sql);
      params.push(...w.params);
    }
    if (q !== undefined && q !== '') {
      clauses.push('(subject LIKE ? OR lastMessagePreview LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (priority !== undefined && priority !== '') {
      if (!PRIORITIES.includes(priority as TicketPriority)) return c.json({ error: `unknown priority: ${priority}` }, 400);
      clauses.push('priority = ?');
      params.push(priority);
    }
    if (assigneeId !== undefined && assigneeId !== '') {
      clauses.push('assigneeId = ?');
      params.push(assigneeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM tickets ${where} ORDER BY lastMessageAt DESC`)
      .all(...params) as unknown as TicketRow[];
    return c.json(rows.map(rowToTicket));
  });

  app.post('/api/tickets', async (c) => {
    let input: { subject?: unknown; body?: unknown; requesterId?: unknown; priority?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { subject, body, requesterId, priority } = input;
    if (typeof subject !== 'string' || subject.trim() === '') return c.json({ error: 'subject is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    if (typeof requesterId !== 'string' || getContact(db, requesterId) === null) {
      return c.json({ error: 'unknown requesterId' }, 400);
    }
    if (typeof priority !== 'string' || !PRIORITIES.includes(priority as TicketPriority)) {
      return c.json({ error: 'invalid priority' }, 400);
    }

    const now = new Date().toISOString();
    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    // Automation rules may adjust priority/tags/assignee at creation time.
    const shaped = { subject: subject.trim(), priority: priority as TicketPriority, tags: [] as string[], assigneeId: null as string | null };
    applyAutomation(automationRules(), shaped, body);
    const ticket: Ticket = {
      id: newId('t_'),
      number: maxRow.maxNumber + 1,
      subject: shaped.subject,
      status: 'open',
      priority: shaped.priority,
      bucket: 'inbox',
      requesterId,
      assigneeId: shaped.assigneeId,
      tags: shaped.tags,
      channel: 'web',
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: preview(body),
      firstRespondedAt: null,
      resolvedAt: null,
      channelId: null,
    };
    const message: Message = {
      id: newId('m_'),
      ticketId: ticket.id,
      authorKind: 'contact',
      authorId: requesterId,
      kind: 'reply',
      body,
      at: now,
    };

    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // AI agents evaluate the new ticket (may auto-resolve it).
    runAgentsOnTicket(ticket, body);
    return c.json({ ticket: getTicket(db, ticket.id), message });
  });

  app.patch('/api/tickets/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getTicket(db, id);
    if (existing === null) return c.json({ error: `ticket not found: ${id}` }, 404);

    let patch: TicketPatch;
    try {
      patch = (await c.req.json()) as TicketPatch;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    // Validate field values so a buggy or hostile client cannot persist a
    // ticket in an unknown status/priority/bucket that the UI can't render.
    if ('status' in patch && !STATUSES.includes(patch.status as string)) return c.json({ error: 'invalid status' }, 400);
    if ('priority' in patch && !PRIORITIES.includes(patch.priority as TicketPriority)) return c.json({ error: 'invalid priority' }, 400);
    if ('bucket' in patch && !BUCKETS.includes(patch.bucket as string)) return c.json({ error: 'invalid bucket' }, 400);
    if ('subject' in patch && (typeof patch.subject !== 'string' || patch.subject.trim() === '')) return c.json({ error: 'invalid subject' }, 400);
    if ('tags' in patch && !Array.isArray(patch.tags)) return c.json({ error: 'invalid tags' }, 400);
    if ('assigneeId' in patch && patch.assigneeId !== null && typeof patch.assigneeId !== 'string') return c.json({ error: 'invalid assigneeId' }, 400);

    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const key of PATCH_KEYS) {
      if (!(key in patch)) continue;
      const value = patch[key];
      sets.push(`${key} = ?`);
      params.push(key === 'tags' ? JSON.stringify(value ?? []) : (value as string | null));
    }
    const now = new Date().toISOString();
    // Maintain resolvedAt for the SLA resolution clock on status transitions.
    if (patch.status !== undefined) {
      if (RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt === null) {
        sets.push('resolvedAt = ?');
        params.push(now);
      } else if (!RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt !== null) {
        sets.push('resolvedAt = ?');
        params.push(null);
      }
    }
    sets.push('updatedAt = ?');
    params.push(now);
    db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getTicket(db, id));
  });

  app.get('/api/tickets/:id/messages', (c) => {
    const id = c.req.param('id');
    if (getTicket(db, id) === null) return c.json({ error: `ticket not found: ${id}` }, 404);
    return c.json(getMessages(db, id));
  });

  app.post('/api/tickets/:id/messages', async (c) => {
    const id = c.req.param('id');
    const ticket = getTicket(db, id);
    if (ticket === null) return c.json({ error: `ticket not found: ${id}` }, 404);

    let input: { kind?: unknown; body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { kind, body } = input;
    if (kind !== 'reply' && kind !== 'note') return c.json({ error: "kind must be 'reply' or 'note'" }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);

    const now = new Date().toISOString();
    const message: Message = {
      id: newId('m_'),
      ticketId: id,
      authorKind: 'agent',
      authorId: currentAgentId(),
      kind,
      body,
      at: now,
    };
    const nextStatus = kind === 'reply' && ticket.status === 'open' ? 'pending' : ticket.status;
    const nextPreview = kind === 'reply' ? preview(body) : ticket.lastMessagePreview;
    // The first agent reply stamps the SLA first-response clock.
    const nextFirstResponded = kind === 'reply' && ticket.firstRespondedAt === null ? now : ticket.firstRespondedAt;

    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.prepare(
        'UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?',
      ).run(nextStatus, now, now, nextPreview, nextFirstResponded, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ message, ticket: getTicket(db, id) });
  });

  app.post('/api/contacts', async (c) => {
    let input: { name?: unknown; email?: unknown; company?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, company } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof email !== 'string' || email.trim() === '') return c.json({ error: 'email is required' }, 400);

    const contact: Contact = {
      id: newId('c_'),
      name: name.trim(),
      email: email.trim(),
      company: typeof company === 'string' && company.trim() !== '' ? company.trim() : null,
      avatarHue: djb2(email.trim()) % 360,
      location: null,
      timezone: null,
      createdAt: new Date().toISOString(),
      mrr: null,
    };
    db.prepare(
      'INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    return c.json(contact);
  });

  app.post('/api/canned', async (c) => {
    let input: { title?: unknown; body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const canned: CannedReply = { id: newId('cr_'), title, body };
    db.prepare('INSERT INTO canned_replies (id, title, body) VALUES (?, ?, ?)').run(canned.id, canned.title, canned.body);
    return c.json(canned);
  });

  app.put('/api/canned/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT * FROM canned_replies WHERE id = ?').get(id) as CannedReply | undefined;
    if (existing === undefined) return c.json({ error: `canned reply not found: ${id}` }, 404);
    let input: { title?: unknown; body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    db.prepare('UPDATE canned_replies SET title = ?, body = ? WHERE id = ?').run(title, body, id);
    return c.json({ id, title, body } satisfies CannedReply);
  });

  app.delete('/api/canned/:id', (c) => {
    const id = c.req.param('id');
    db.prepare('DELETE FROM canned_replies WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.get('/api/deals', (c) => {
    const stage = c.req.query('stage');
    const type = c.req.query('type');
    const contactId = c.req.query('contactId');
    const clauses: string[] = [];
    const params: string[] = [];
    if (stage !== undefined && stage !== '') {
      if (!DEAL_STAGES.includes(stage as DealStage)) return c.json({ error: `unknown stage: ${stage}` }, 400);
      clauses.push('stage = ?');
      params.push(stage);
    }
    if (type !== undefined && type !== '') {
      if (!DEAL_TYPES.includes(type as DealType)) return c.json({ error: `unknown type: ${type}` }, 400);
      clauses.push('type = ?');
      params.push(type);
    }
    if (contactId !== undefined && contactId !== '') {
      clauses.push('contactId = ?');
      params.push(contactId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM deals ${where} ORDER BY updatedAt DESC`).all(...params) as unknown as Deal[];
    return c.json(rows);
  });

  app.post('/api/deals', async (c) => {
    let input: {
      title?: unknown; type?: unknown; value?: unknown; contactId?: unknown;
      ticketId?: unknown; ownerId?: unknown; note?: unknown;
    };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, type, value, contactId, ticketId, ownerId, note } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof type !== 'string' || !DEAL_TYPES.includes(type as DealType)) return c.json({ error: 'invalid type' }, 400);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return c.json({ error: 'value must be a non-negative integer (cents)' }, 400);
    }
    if (typeof contactId !== 'string' || getContact(db, contactId) === null) {
      return c.json({ error: 'unknown contactId' }, 400);
    }
    let linkedTicketId: string | null = null;
    if (ticketId !== undefined && ticketId !== null) {
      if (typeof ticketId !== 'string' || getTicket(db, ticketId) === null) {
        return c.json({ error: 'unknown ticketId' }, 400);
      }
      linkedTicketId = ticketId;
    }
    let owner = currentAgentId();
    if (ownerId !== undefined) {
      if (typeof ownerId !== 'string') return c.json({ error: 'invalid ownerId' }, 400);
      owner = ownerId;
    }
    const now = new Date().toISOString();
    const deal: Deal = {
      id: newId('d_'),
      title: title.trim(),
      type: type as DealType,
      stage: 'open',
      value,
      currency: 'USD',
      contactId,
      ticketId: linkedTicketId,
      ownerId: owner,
      note: typeof note === 'string' ? note : '',
      createdAt: now,
      closedAt: null,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO deals (
        id, title, type, stage, value, currency, contactId, ticketId, ownerId, note, createdAt, closedAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      deal.id, deal.title, deal.type, deal.stage, deal.value, deal.currency, deal.contactId,
      deal.ticketId, deal.ownerId, deal.note, deal.createdAt, deal.closedAt, deal.updatedAt,
    );
    return c.json(deal);
  });

  app.patch('/api/deals/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getDeal(db, id);
    if (existing === null) return c.json({ error: `deal not found: ${id}` }, 404);

    let patch: { title?: unknown; type?: unknown; stage?: unknown; value?: unknown; ownerId?: unknown; note?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if ('title' in patch) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') return c.json({ error: 'invalid title' }, 400);
      sets.push('title = ?');
      params.push(patch.title.trim());
    }
    if ('type' in patch) {
      if (typeof patch.type !== 'string' || !DEAL_TYPES.includes(patch.type as DealType)) return c.json({ error: 'invalid type' }, 400);
      sets.push('type = ?');
      params.push(patch.type);
    }
    if ('value' in patch) {
      if (typeof patch.value !== 'number' || !Number.isInteger(patch.value) || patch.value < 0) return c.json({ error: 'invalid value' }, 400);
      sets.push('value = ?');
      params.push(patch.value);
    }
    if ('ownerId' in patch) {
      if (typeof patch.ownerId !== 'string') return c.json({ error: 'invalid ownerId' }, 400);
      sets.push('ownerId = ?');
      params.push(patch.ownerId);
    }
    if ('note' in patch) {
      if (typeof patch.note !== 'string') return c.json({ error: 'invalid note' }, 400);
      sets.push('note = ?');
      params.push(patch.note);
    }
    const now = new Date().toISOString();
    if ('stage' in patch) {
      if (typeof patch.stage !== 'string' || !DEAL_STAGES.includes(patch.stage as DealStage)) return c.json({ error: 'invalid stage' }, 400);
      const stage = patch.stage as DealStage;
      sets.push('stage = ?');
      params.push(stage);
      if (stage === 'won' || stage === 'lost') {
        if (existing.closedAt === null) {
          sets.push('closedAt = ?');
          params.push(now);
        }
      } else {
        sets.push('closedAt = ?');
        params.push(null);
      }
    }
    sets.push('updatedAt = ?');
    params.push(now);
    db.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getDeal(db, id));
  });

  app.delete('/api/deals/:id', (c) => {
    const id = c.req.param('id');
    if (getDeal(db, id) === null) return c.json({ error: `deal not found: ${id}` }, 404);
    db.prepare('DELETE FROM deals WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.put('/api/settings/sla', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input !== 'object' || input === null) return c.json({ error: 'invalid SLA targets' }, 400);
    for (const p of PRIORITIES) {
      const t = (input as Record<string, unknown>)[p] as { firstResponseMins?: unknown; resolutionMins?: unknown } | undefined;
      if (
        t === undefined ||
        typeof t.firstResponseMins !== 'number' || t.firstResponseMins < 0 ||
        typeof t.resolutionMins !== 'number' || t.resolutionMins < 0
      ) {
        return c.json({ error: `invalid target for ${p}` }, 400);
      }
    }
    setSetting(db, 'sla', JSON.stringify(input));
    return c.json(input);
  });

  app.put('/api/settings/automation', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!Array.isArray(input)) return c.json({ error: 'automation must be an array' }, 400);
    const CONDITIONS = ['subject_contains', 'body_contains', 'priority_is'];
    const ACTIONS = ['set_priority', 'add_tag', 'assign'];
    for (const r of input as AutomationRule[]) {
      if (
        typeof r?.id !== 'string' || typeof r?.name !== 'string' || typeof r?.enabled !== 'boolean' ||
        !CONDITIONS.includes(r?.condition?.type) || typeof r?.condition?.value !== 'string' ||
        !ACTIONS.includes(r?.action?.type) || typeof r?.action?.value !== 'string'
      ) {
        return c.json({ error: 'invalid automation rule' }, 400);
      }
    }
    setSetting(db, 'automation', JSON.stringify(input));
    return c.json(input);
  });

  app.get('/api/kb', (c) => {
    const rows = db.prepare('SELECT * FROM kb_articles ORDER BY category, title').all() as unknown as KbArticle[];
    return c.json(rows);
  });

  app.post('/api/kb', async (c) => {
    let input: { title?: unknown; category?: unknown; body?: unknown; status?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, category, body, status } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof category !== 'string' || category.trim() === '') return c.json({ error: 'category is required' }, 400);
    if (typeof body !== 'string') return c.json({ error: 'body is required' }, 400);
    const st: ArticleStatus = status === 'published' ? 'published' : 'draft';
    const now = new Date().toISOString();
    const article: KbArticle = {
      id: newId('kb_'),
      title: title.trim(),
      slug: slugify(title),
      category: category.trim(),
      body,
      status: st,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      'INSERT INTO kb_articles (id, title, slug, category, body, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(article.id, article.title, article.slug, article.category, article.body, article.status, article.createdAt, article.updatedAt);
    return c.json(article);
  });

  app.patch('/api/kb/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getKbArticle(db, id);
    if (existing === null) return c.json({ error: `article not found: ${id}` }, 404);
    let patch: { title?: unknown; category?: unknown; body?: unknown; status?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: string[] = [];
    if ('title' in patch) {
      if (typeof patch.title !== 'string' || patch.title.trim() === '') return c.json({ error: 'invalid title' }, 400);
      sets.push('title = ?', 'slug = ?');
      params.push(patch.title.trim(), slugify(patch.title));
    }
    if ('category' in patch) {
      if (typeof patch.category !== 'string' || patch.category.trim() === '') return c.json({ error: 'invalid category' }, 400);
      sets.push('category = ?');
      params.push(patch.category.trim());
    }
    if ('body' in patch) {
      if (typeof patch.body !== 'string') return c.json({ error: 'invalid body' }, 400);
      sets.push('body = ?');
      params.push(patch.body);
    }
    if ('status' in patch) {
      if (patch.status !== 'draft' && patch.status !== 'published') return c.json({ error: 'invalid status' }, 400);
      sets.push('status = ?');
      params.push(patch.status);
    }
    sets.push('updatedAt = ?');
    params.push(new Date().toISOString());
    db.prepare(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getKbArticle(db, id));
  });

  app.delete('/api/kb/:id', (c) => {
    const id = c.req.param('id');
    if (getKbArticle(db, id) === null) return c.json({ error: `article not found: ${id}` }, 404);
    db.prepare('DELETE FROM kb_articles WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.post('/api/ai/agents', async (c) => {
    let input: { name?: unknown; autonomy?: unknown; scopeTags?: unknown; scopePriorities?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, autonomy, scopeTags, scopePriorities } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof autonomy !== 'string' || !AUTONOMIES.includes(autonomy as Autonomy)) return c.json({ error: 'invalid autonomy' }, 400);
    const tags = Array.isArray(scopeTags) ? scopeTags.filter((x): x is string => typeof x === 'string') : [];
    const prios = Array.isArray(scopePriorities) ? scopePriorities.filter((p): p is TicketPriority => PRIORITIES.includes(p as TicketPriority)) : [];
    const agent = {
      id: newId('ai_'), name: name.trim(), avatarHue: djb2(name.trim()) % 360, enabled: true,
      autonomy: autonomy as Autonomy, scopeTags: tags, scopePriorities: prios, createdAt: new Date().toISOString(),
    };
    db.prepare(
      'INSERT INTO ai_agents (id, name, avatarHue, enabled, autonomy, scopeTags, scopePriorities, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(agent.id, agent.name, agent.avatarHue, 1, agent.autonomy, JSON.stringify(agent.scopeTags), JSON.stringify(agent.scopePriorities), agent.createdAt);
    return c.json(agent);
  });

  app.patch('/api/ai/agents/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getAiAgent(db, id);
    if (existing === null) return c.json({ error: `agent not found: ${id}` }, 404);
    let patch: { name?: unknown; enabled?: unknown; autonomy?: unknown; scopeTags?: unknown; scopePriorities?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') return c.json({ error: 'invalid enabled' }, 400);
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    if ('autonomy' in patch) {
      if (typeof patch.autonomy !== 'string' || !AUTONOMIES.includes(patch.autonomy as Autonomy)) return c.json({ error: 'invalid autonomy' }, 400);
      sets.push('autonomy = ?');
      params.push(patch.autonomy);
    }
    if ('scopeTags' in patch) {
      if (!Array.isArray(patch.scopeTags)) return c.json({ error: 'invalid scopeTags' }, 400);
      sets.push('scopeTags = ?');
      params.push(JSON.stringify(patch.scopeTags.filter((x): x is string => typeof x === 'string')));
    }
    if ('scopePriorities' in patch) {
      if (!Array.isArray(patch.scopePriorities)) return c.json({ error: 'invalid scopePriorities' }, 400);
      sets.push('scopePriorities = ?');
      params.push(JSON.stringify(patch.scopePriorities.filter((p): p is TicketPriority => PRIORITIES.includes(p as TicketPriority))));
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE ai_agents SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getAiAgent(db, id));
  });

  app.delete('/api/ai/agents/:id', (c) => {
    const id = c.req.param('id');
    if (getAiAgent(db, id) === null) return c.json({ error: `agent not found: ${id}` }, 404);
    db.prepare('DELETE FROM ai_agents WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  app.post('/api/ai/run', (c) => {
    const actioned = new Set(
      (db.prepare('SELECT DISTINCT ticketId FROM ai_actions').all() as { ticketId: string }[]).map((r) => r.ticketId),
    );
    const rows = db
      .prepare("SELECT * FROM tickets WHERE bucket = 'inbox' AND status IN ('open', 'pending')")
      .all() as unknown as TicketRow[];
    let created = 0;
    for (const row of rows) {
      const ticket = rowToTicket(row);
      if (actioned.has(ticket.id)) continue;
      const firstContact = getMessages(db, ticket.id).find((m) => m.authorKind === 'contact');
      if (runAgentsOnTicket(ticket, firstContact?.body ?? '') !== null) created += 1;
    }
    return c.json({ created });
  });

  app.post('/api/ai/actions/:id/approve', (c) => {
    const id = c.req.param('id');
    const action = getAiAction(db, id);
    if (action === null) return c.json({ error: `action not found: ${id}` }, 404);
    if (action.kind !== 'draft' || action.status !== 'pending') return c.json({ error: 'not an approvable draft' }, 400);
    const ticket = getTicket(db, action.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const now = new Date().toISOString();
    const body = action.draftBody ?? '';
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(),
      kind: 'reply', body, at: now,
    };
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      const nextStatus = ticket.status === 'open' ? 'pending' : ticket.status;
      const nextFirstResponded = ticket.firstRespondedAt ?? now;
      db.prepare('UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
        .run(nextStatus, now, now, preview(body), nextFirstResponded, ticket.id);
      db.prepare("UPDATE ai_actions SET status = 'approved', resolvedAt = ? WHERE id = ?").run(now, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ action: getAiAction(db, id), ticket: getTicket(db, ticket.id), message });
  });

  app.post('/api/ai/actions/:id/dismiss', (c) => {
    const id = c.req.param('id');
    if (getAiAction(db, id) === null) return c.json({ error: `action not found: ${id}` }, 404);
    db.prepare("UPDATE ai_actions SET status = 'dismissed', resolvedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    return c.json({ action: getAiAction(db, id) });
  });

  app.post('/api/channels', async (c) => {
    let input: { type?: unknown; name?: unknown; address?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { type, name, address } = input;
    if (typeof type !== 'string' || !CHANNEL_TYPES.includes(type as ChannelType)) return c.json({ error: 'invalid channel type' }, 400);
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    const channel = {
      id: newId('ch_'), type: type as ChannelType, name: name.trim(), enabled: true,
      inboundToken: `tok_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      address: typeof address === 'string' && address.trim() !== '' ? address.trim() : null,
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO channels (id, type, name, enabled, inboundToken, address, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(channel.id, channel.type, channel.name, 1, channel.inboundToken, channel.address, channel.createdAt);
    return c.json(channel);
  });

  app.patch('/api/channels/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getChannel(db, id);
    if (existing === null) return c.json({ error: `channel not found: ${id}` }, 404);
    let patch: { name?: unknown; enabled?: unknown; address?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('enabled' in patch) {
      if (typeof patch.enabled !== 'boolean') return c.json({ error: 'invalid enabled' }, 400);
      sets.push('enabled = ?');
      params.push(patch.enabled ? 1 : 0);
    }
    if ('address' in patch) {
      sets.push('address = ?');
      params.push(typeof patch.address === 'string' && patch.address.trim() !== '' ? patch.address.trim() : null);
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getChannel(db, id));
  });

  app.delete('/api/channels/:id', (c) => {
    const id = c.req.param('id');
    if (getChannel(db, id) === null) return c.json({ error: `channel not found: ${id}` }, 404);
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // Public, token-gated inbound: a real forwarder / widget POSTs a message here.
  app.post('/api/channels/:id/inbound', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    if (!channel.enabled) return c.json({ error: 'channel disabled' }, 403);
    if (c.req.query('token') !== channel.inboundToken) return c.json({ error: 'invalid token' }, 401);
    let input: { from?: { name?: unknown; email?: unknown }; subject?: unknown; body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const email = input.from?.email;
    const body = input.body;
    if (typeof email !== 'string' || email.trim() === '') return c.json({ error: 'from.email is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const now = new Date().toISOString();

    let contact = db.prepare('SELECT * FROM contacts WHERE email = ?').get(email.trim()) as Contact | undefined;
    if (contact === undefined) {
      const name = typeof input.from?.name === 'string' && input.from.name.trim() !== '' ? input.from.name.trim() : email.trim();
      contact = {
        id: newId('c_'), name, email: email.trim(), company: null, avatarHue: djb2(email.trim()) % 360,
        location: null, timezone: null, createdAt: now, mrr: null,
      };
      db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    }

    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const subject = typeof input.subject === 'string' && input.subject.trim() !== '' ? input.subject.trim() : preview(body);
    const ticket: Ticket = {
      id: newId('t_'), number: maxRow.maxNumber + 1, subject, status: 'open', priority: 'medium', bucket: 'inbox',
      requesterId: contact.id, assigneeId: null, tags: [], channel: CHANNEL_TO_TICKET[channel.type],
      createdAt: now, updatedAt: now, snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(body),
      firstRespondedAt: null, resolvedAt: null, channelId: channel.id,
    };
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now,
    };
    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    runAgentsOnTicket(ticket, body);
    return c.json({ ticketId: ticket.id });
  });

  // Public thread read for the web widget: latest ticket for this contact on this channel.
  app.get('/api/channels/:id/thread', (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    if (c.req.query('token') !== channel.inboundToken) return c.json({ error: 'invalid token' }, 401);
    const email = c.req.query('contact');
    if (email === undefined || email === '') return c.json([]);
    const contact = db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) as Contact | undefined;
    if (contact === undefined) return c.json([]);
    const ticket = db
      .prepare('SELECT * FROM tickets WHERE channelId = ? AND requesterId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(channel.id, contact.id) as TicketRow | undefined;
    if (ticket === undefined) return c.json([]);
    return c.json(getMessages(db, ticket.id));
  });

  app.get('/api/stats', (c) => c.json(computeStats(db, new Date())));

  app.get('/api/search', (c) => {
    const q = c.req.query('q');
    if (q === undefined || q.trim() === '') return c.json({ ticketIds: [] });
    const like = `%${q.trim()}%`;
    const rows = db
      .prepare(
        `SELECT DISTINCT t.id, t.lastMessageAt FROM tickets t
         LEFT JOIN messages m ON m.ticketId = t.id
         LEFT JOIN contacts c ON c.id = t.requesterId
         WHERE t.subject LIKE ? OR m.body LIKE ? OR c.name LIKE ? OR c.email LIKE ?
         ORDER BY t.lastMessageAt DESC
         LIMIT 30`,
      )
      .all(like, like, like, like) as { id: string }[];
    return c.json({ ticketIds: rows.map((r) => r.id) });
  });

  return { app, db };
}
