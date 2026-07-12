import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getAiAction, getAiActions, getAiAgent, getAiAgents, getAiProviderConfig, getAttachment, getCannedReplies, getChannel, getChannels, getContact,
  getContactByEmail, getCustomField, getCustomFields, getDeal, getKbArticle, getMessage, getMessages, getPortalAuth, getSavedViews, getSetting, getSmtpConfig, getTicket, setSavedViews,
  insertAiAction, insertAttachment, linkAttachments, openDb, portalSecret, rowToTicket, setAiProviderConfig, setPortalAuth, setSetting, setSmtpConfig,
  toPublicChannel, toPublicProvider, toPublicSmtp, type TicketRow,
} from './db.js';
import { hashPassword, signSession, verifyPassword, verifySession } from './auth.js';
import { channelCanSend, sendToChannel } from './channel-send.js';
import { sendReplyNotification, sendTestEmail, smtpReady } from './mailer.js';
import { seedIfEmpty } from './seed-load.js';
import { computeStats } from './stats.js';
import { DEFAULT_AUTOMATION, DEFAULT_SLA_HOURS, DEFAULT_SLA_TARGETS, normalizeAutomation } from './defaults.js';
import { draftReply, rankKb, runAgent, suggestTriage, summarizeThread, type AgentContext, type Autonomy } from './ai-engine.js';
import { draftReplyAI, providerReady, resolveAI, suggestTriageAI, summarizeThreadAI } from './ai-llm.js';
import { ping, type LlmConfig } from './llm.js';
import type { ThreadMsg } from './ai-prompts.js';
import type {
  AiAction, AiProviderConfig, Agent, ArticleStatus, Attachment, AutomationAction, AutomationCondition, AutomationRule,
  BootstrapData, CannedReply, Channel, ChannelConn, ChannelType, Contact, CustomFieldDef, CustomFieldEntity,
  CustomFieldType, Deal, DealStage, DealType, KbArticle, MacroActions, Message,
  SavedView, SlaTargets, Ticket, TicketPatch, TicketPriority, TicketStatus, ViewId,
} from './types.js';

const AUTONOMY_RANK: Record<Autonomy, number> = { resolve: 3, draft: 2, suggest: 1 };
const AUTONOMIES: Autonomy[] = ['suggest', 'draft', 'resolve'];
const CHANNEL_TYPES: ChannelType[] = ['webchat', 'webhook', 'email', 'discord', 'slack', 'whatsapp', 'telegram', 'messenger', 'sms'];
const CHANNEL_TO_TICKET: Record<ChannelType, Channel> = {
  webchat: 'chat', webhook: 'api', email: 'email', discord: 'chat', slack: 'chat',
  whatsapp: 'chat', telegram: 'chat', messenger: 'chat', sms: 'chat',
};

const VERSION = '0.1.0';

const DEAL_TYPES: DealType[] = ['expansion', 'retention', 'inbound'];
const DEAL_STAGES: DealStage[] = ['open', 'won', 'lost'];
const RESOLVED_STATUSES = ['solved', 'closed'];

interface AutoMut { subject: string; priority: TicketPriority; tags: string[]; assigneeId: string | null; status: TicketStatus }
interface AutoCtx { subjectLc: string; bodyLc: string; fromLc: string; channelType: string }

function evalCondition(cond: AutomationCondition, mut: AutoMut, ctx: AutoCtx): boolean {
  const v = cond.value.toLowerCase();
  switch (cond.type) {
    case 'subject_contains': return ctx.subjectLc.includes(v);
    case 'body_contains': return ctx.bodyLc.includes(v);
    case 'priority_is': return mut.priority === cond.value;
    case 'channel_is': return ctx.channelType === cond.value;
    case 'from_contains': return ctx.fromLc.includes(v);
    default: return false;
  }
}

function applyAutoAction(action: AutomationAction, mut: AutoMut): void {
  if (action.type === 'set_priority' && PRIORITIES.includes(action.value as TicketPriority)) mut.priority = action.value as TicketPriority;
  else if (action.type === 'add_tag') { if (!mut.tags.includes(action.value)) mut.tags.push(action.value); }
  else if (action.type === 'assign') mut.assigneeId = action.value;
  else if (action.type === 'set_status' && STATUSES.includes(action.value as TicketStatus)) mut.status = action.value as TicketStatus;
}

/** Runs enabled automation rules over a ticket mutation, in order. */
function runAutomation(rules: AutomationRule[], mut: AutoMut, ctx: AutoCtx, phase: 'create' | 'update'): void {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (phase === 'update' && rule.runOn !== 'create_update') continue;
    if (rule.conditions.length === 0) continue;
    const results = rule.conditions.map((cnd) => evalCondition(cnd, mut, ctx));
    const ok = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (ok) for (const action of rule.actions) applyAutoAction(action, mut);
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

/**
 * Validate an untrusted macro-actions payload, keeping only known-good fields.
 * Returns null when nothing usable remains, so a macro with no actions is
 * stored as a plain canned reply.
 */
function normalizeMacroActions(raw: unknown): MacroActions | null {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const out: MacroActions = {};
  if (typeof a.status === 'string' && STATUSES.includes(a.status)) out.status = a.status as TicketStatus;
  if (typeof a.priority === 'string' && PRIORITIES.includes(a.priority as TicketPriority)) out.priority = a.priority as TicketPriority;
  if (a.assignToMe === true) out.assignToMe = true;
  if (Array.isArray(a.addTags)) {
    const tags = [...new Set(a.addTags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()))];
    if (tags.length > 0) out.addTags = tags;
  }
  return Object.keys(out).length > 0 ? out : null;
}
const PATCH_KEYS = ['status', 'priority', 'assigneeId', 'tags', 'bucket', 'snoozedUntil', 'subject', 'customFields'] as const;

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

/**
 * Constant-time check that `provided` is a valid HMAC-SHA256 of `rawBody` under
 * `secret`. Accepts a bare hex digest or a `sha256=…` prefix (Slack/Meta style).
 */
function verifyHmac(secret: string, rawBody: string, provided: string | undefined): boolean {
  if (provided === undefined || provided.trim() === '') return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = provided.replace(/^sha256=/i, '').trim();
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function insertTicketRow(db: DatabaseSync, t: Ticket): void {
  db.prepare(
    `INSERT INTO tickets (
      id, number, subject, status, priority, bucket, requesterId, assigneeId,
      tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview,
      firstRespondedAt, resolvedAt, channelId, customFields
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id, t.number, t.subject, t.status, t.priority, t.bucket, t.requesterId, t.assigneeId,
    JSON.stringify(t.tags), t.channel, t.createdAt, t.updatedAt, t.snoozedUntil, t.lastMessageAt,
    t.lastMessagePreview, t.firstRespondedAt, t.resolvedAt, t.channelId, JSON.stringify(t.customFields),
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

  // Uploaded files live next to the SQLite database, keyed by attachment id.
  const attachDir = path.join(dataDir, 'attachments');
  mkdirSync(attachDir, { recursive: true });
  const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB

  // Ensure settings exist (fresh install or migrated pre-v0.3/v0.4 DB).
  if (getSetting(db, 'sla') === null) setSetting(db, 'sla', JSON.stringify(DEFAULT_SLA_TARGETS));
  if (getSetting(db, 'automation') === null) setSetting(db, 'automation', JSON.stringify(DEFAULT_AUTOMATION));
  if (getSetting(db, 'sla_hours') === null) setSetting(db, 'sla_hours', JSON.stringify(DEFAULT_SLA_HOURS));

  const slaTargets = (): SlaTargets => {
    try {
      return JSON.parse(getSetting(db, 'sla') ?? '') as SlaTargets;
    } catch {
      return DEFAULT_SLA_TARGETS;
    }
  };
  const automationRules = (): AutomationRule[] => {
    try {
      return normalizeAutomation(JSON.parse(getSetting(db, 'automation') ?? ''));
    } catch {
      return DEFAULT_AUTOMATION;
    }
  };
  const slaHours = () => {
    try {
      return JSON.parse(getSetting(db, 'sla_hours') ?? '') as unknown;
    } catch {
      return DEFAULT_SLA_HOURS;
    }
  };

  const currentAgentId = (): string => {
    const row = db.prepare("SELECT id FROM agents WHERE role = 'admin' ORDER BY rowid LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new Error('no admin agent found');
    return row.id;
  };

  /** Fire-and-forget: email the ticket's requester that support replied. */
  const emailReplyToCustomer = (ticket: Ticket, body: string): void => {
    const cfg = getSmtpConfig(db);
    if (!smtpReady(cfg)) return;
    const contact = getContact(db, ticket.requesterId);
    if (contact === null || contact.email.trim() === '') return;
    const ticketUrl = `${cfg.publicUrl.replace(/\/+$/, '')}/portal/ticket/${ticket.id}`;
    void sendReplyNotification(cfg, {
      toEmail: contact.email, toName: contact.name, ticketNumber: ticket.number,
      subject: ticket.subject, body, ticketUrl,
    }).catch((err) => console.error('[email] reply notification failed:', err instanceof Error ? err.message : err));
  };

  /** Fire-and-forget: deliver an agent reply back out to the ticket's chat channel. */
  const sendReplyToChannel = (ticket: Ticket, body: string): void => {
    if (ticket.channelId === null) return;
    const channel = getChannel(db, ticket.channelId);
    if (channel === null || !channelCanSend(channel)) return;
    const contact = getContact(db, ticket.requesterId);
    const fromName = getSmtpConfig(db).fromName.trim() || 'Support';
    void sendToChannel(channel, {
      ticketNumber: ticket.number, subject: ticket.subject, body,
      toName: contact?.name ?? null, fromName,
    })
      .then((r) => { if (!r.ok) console.error(`[channel] outbound to ${channel.type} failed:`, r.error); })
      .catch((err) => console.error('[channel] outbound failed:', err instanceof Error ? err.message : err));
  };

  /** Deliver an outgoing reply on every configured path: email + the source channel. */
  const deliverReply = (ticket: Ticket, body: string): void => {
    emailReplyToCustomer(ticket, body);
    sendReplyToChannel(ticket, body);
  };

  /**
   * Runs the enabled AI agents against a freshly-arrived ticket. The
   * highest-autonomy matching agent acts once: a resolve agent that deflects to
   * a KB article sends the reply and solves the ticket; draft/suggest agents
   * record a pending action for the queues.
   */
  const runAgentsOnTicket = async (ticket: Ticket, firstBody: string): Promise<AiAction | null> => {
    const agents = getAiAgents(db)
      .filter((a) => a.enabled)
      .sort((a, b) => AUTONOMY_RANK[b.autonomy] - AUTONOMY_RANK[a.autonomy]);
    if (agents.length === 0) return null;
    const contact = getContact(db, ticket.requesterId);
    const canned = getCannedReplies(db);
    const kb = db.prepare('SELECT * FROM kb_articles').all() as unknown as KbArticle[];
    const cfg = getAiProviderConfig(db);
    const useModel = providerReady(cfg);
    const contactName = contact?.name ?? 'there';
    const thread: ThreadMsg[] = [{ role: 'customer', body: firstBody }];
    for (const agent of agents) {
      const ctx: AgentContext = {
        subject: ticket.subject, bodyText: firstBody,
        contactName, agentName: agent.name,
        currentPriority: ticket.priority, currentTags: ticket.tags,
        canned, kb,
      };
      const decision = runAgent(agent, ctx);
      if (decision === null) continue;

      // When a model is configured, it writes the body. For a resolve agent it
      // also GATES the auto-send: it only sends if it can answer from the KB,
      // otherwise the action degrades to a draft for a human to review.
      let kind = decision.kind;
      let body = decision.draftBody;
      let kbArticleId = decision.kbArticleId;
      let promptTokens = 0;
      let completionTokens = 0;
      if (useModel && agent.autonomy !== 'suggest') {
        const rankedKb = rankKb(`${ticket.subject} ${firstBody}`, kb, 5);
        const draftCtx = { subject: ticket.subject, contactName, agentName: agent.name, signature: '', thread, canned, kb: rankedKb };
        if (agent.autonomy === 'resolve') {
          const solved = await resolveAI(cfg, draftCtx);
          if (solved !== null) {
            kind = 'resolve'; body = solved.reply; kbArticleId = null;
            promptTokens = solved.usage.promptTokens; completionTokens = solved.usage.completionTokens;
          } else {
            kind = 'draft'; kbArticleId = null;
            const d = await draftReplyAI(cfg, draftCtx, decision.draftBody ?? '');
            body = d.body; promptTokens = d.usage.promptTokens; completionTokens = d.usage.completionTokens;
          }
        } else {
          const d = await draftReplyAI(cfg, draftCtx, decision.draftBody ?? '');
          body = d.body; promptTokens = d.usage.promptTokens; completionTokens = d.usage.completionTokens;
        }
      }

      const now = new Date().toISOString();
      const action: AiAction = {
        id: newId('act_'), agentId: agent.id, ticketId: ticket.id, kind,
        status: kind === 'resolve' ? 'sent' : 'pending',
        draftBody: body, suggestedPriority: decision.suggestedPriority,
        suggestedTags: decision.suggestedTags, kbArticleId,
        promptTokens, completionTokens,
        createdAt: now, resolvedAt: kind === 'resolve' ? now : null,
      };
      insertAiAction(db, action);
      if (kind === 'resolve' && body !== null) {
        const message: Message = {
          id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(),
          kind: 'reply', body, at: now,
        };
        db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
        db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run('solved', now, now, now, preview(body), now, ticket.id);
        deliverReply(ticket, body);
      }
      return action; // only the highest-autonomy matching agent acts
    }
    return null;
  };

  /** A ticket's customer-facing reply thread, shaped for the prompt builders. */
  const threadOf = (ticketId: string): ThreadMsg[] =>
    getMessages(db, ticketId)
      .filter((m) => m.kind === 'reply')
      .map((m) => ({ role: m.authorKind === 'contact' ? 'customer' : 'agent', body: m.body }));

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/api/bootstrap', (c) => {
    const tickets = (db.prepare('SELECT * FROM tickets ORDER BY lastMessageAt DESC').all() as unknown as TicketRow[])
      .map(rowToTicket);
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY rowid').all() as unknown as Contact[];
    const agents = db.prepare('SELECT * FROM agents ORDER BY rowid').all() as unknown as Agent[];
    const canned = getCannedReplies(db);
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
      channels: getChannels(db).map(toPublicChannel),
      customFields: getCustomFields(db),
      savedViews: getSavedViews(db),
      slaHours: slaHours() as BootstrapData['slaHours'],
      aiProvider: toPublicProvider(getAiProviderConfig(db)),
      smtp: toPublicSmtp(getSmtpConfig(db)),
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
    // Automation rules may adjust priority/tags/assignee/status at creation time.
    const requester = getContact(db, requesterId);
    const shaped: AutoMut = {
      subject: subject.trim(), priority: priority as TicketPriority, tags: [], assigneeId: null, status: 'open',
    };
    runAutomation(automationRules(), shaped, {
      subjectLc: shaped.subject.toLowerCase(), bodyLc: body.toLowerCase(),
      fromLc: requester ? `${requester.name} ${requester.email}`.toLowerCase() : '',
      channelType: 'web',
    }, 'create');
    const ticket: Ticket = {
      id: newId('t_'),
      number: maxRow.maxNumber + 1,
      subject: shaped.subject,
      status: shaped.status,
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
      customFields: {},
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
    await runAgentsOnTicket(ticket, body);
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
    if ('customFields' in patch && (typeof patch.customFields !== 'object' || patch.customFields === null || Array.isArray(patch.customFields))) return c.json({ error: 'invalid customFields' }, 400);

    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const key of PATCH_KEYS) {
      if (!(key in patch)) continue;
      const value = patch[key];
      sets.push(`${key} = ?`);
      if (key === 'tags') params.push(JSON.stringify(value ?? []));
      else if (key === 'customFields') params.push(JSON.stringify(value ?? {}));
      else params.push(value as string | null);
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

  // Bulk update: apply a uniform patch (status/priority/assignee/bucket/snooze) to
  // many tickets at once, plus an optional per-ticket tag union. Returns the
  // updated tickets so the client can merge them.
  app.patch('/api/tickets', async (c) => {
    let input: { ids?: unknown; patch?: unknown; addTags?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) return c.json({ error: 'ids is required' }, 400);
    const patch = (input.patch !== null && typeof input.patch === 'object' ? input.patch : {}) as TicketPatch;
    const addTags = Array.isArray(input.addTags)
      ? input.addTags.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : [];
    if ('status' in patch && !STATUSES.includes(patch.status as string)) return c.json({ error: 'invalid status' }, 400);
    if ('priority' in patch && !PRIORITIES.includes(patch.priority as TicketPriority)) return c.json({ error: 'invalid priority' }, 400);
    if ('bucket' in patch && !BUCKETS.includes(patch.bucket as string)) return c.json({ error: 'invalid bucket' }, 400);
    if ('assigneeId' in patch && patch.assigneeId !== null && typeof patch.assigneeId !== 'string') return c.json({ error: 'invalid assigneeId' }, 400);

    const now = new Date().toISOString();
    const BULK_KEYS = ['status', 'priority', 'assigneeId', 'bucket', 'snoozedUntil'] as const;
    const updated: Ticket[] = [];
    for (const id of ids) {
      const existing = getTicket(db, id);
      if (existing === null) continue;
      const sets: string[] = [];
      const params: (string | null)[] = [];
      for (const key of BULK_KEYS) {
        if (!(key in patch)) continue;
        sets.push(`${key} = ?`);
        params.push((patch[key] as string | null | undefined) ?? null);
      }
      if (addTags.length > 0) {
        sets.push('tags = ?');
        params.push(JSON.stringify(Array.from(new Set([...existing.tags, ...addTags]))));
      }
      if ('status' in patch && typeof patch.status === 'string') {
        if (RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt === null) {
          sets.push('resolvedAt = ?');
          params.push(now);
        } else if (!RESOLVED_STATUSES.includes(patch.status) && existing.resolvedAt !== null) {
          sets.push('resolvedAt = ?');
          params.push(null);
        }
      }
      if (sets.length === 0) {
        updated.push(existing);
        continue;
      }
      sets.push('updatedAt = ?');
      params.push(now);
      db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      const t = getTicket(db, id);
      if (t !== null) updated.push(t);
    }
    return c.json({ updated });
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
    // A closed ticket is locked: no one — not even an admin — can post to it until it is reopened.
    if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it to reply' }, 409);

    let input: { kind?: unknown; body?: unknown; attachmentIds?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { kind, body } = input;
    if (kind !== 'reply' && kind !== 'note') return c.json({ error: "kind must be 'reply' or 'note'" }, 400);
    if (typeof body !== 'string') return c.json({ error: 'body is required' }, 400);
    const attachmentIds = Array.isArray(input.attachmentIds)
      ? input.attachmentIds.filter((x): x is string => typeof x === 'string')
      : [];
    if (body.trim() === '' && attachmentIds.length === 0) return c.json({ error: 'a message or attachment is required' }, 400);

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
    const previewText = body.trim() !== '' ? preview(body) : 'Sent an attachment';
    const nextStatus = kind === 'reply' && ticket.status === 'open' ? 'pending' : ticket.status;
    const nextPreview = kind === 'reply' ? previewText : ticket.lastMessagePreview;
    // The first agent reply stamps the SLA first-response clock.
    const nextFirstResponded = kind === 'reply' && ticket.firstRespondedAt === null ? now : ticket.firstRespondedAt;

    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      if (attachmentIds.length > 0) linkAttachments(db, attachmentIds, message.id, id);
      db.prepare(
        'UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?',
      ).run(nextStatus, now, now, nextPreview, nextFirstResponded, id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    // Notify the customer on a public reply (never on an internal note): email + source channel.
    if (kind === 'reply') deliverReply(ticket, body.trim() !== '' ? body : '(sent an attachment)');
    const saved = getMessages(db, id).find((m) => m.id === message.id) ?? message;
    return c.json({ message: saved, ticket: getTicket(db, id) });
  });

  // Soft-delete a message: the row stays (audit trail) and we stamp who removed
  // it and when, so the thread shows a tombstone instead of the content.
  app.delete('/api/tickets/:tid/messages/:mid', (c) => {
    const tid = c.req.param('tid');
    const mid = c.req.param('mid');
    const msg = getMessage(db, mid);
    if (msg === null || msg.ticketId !== tid) return c.json({ error: 'message not found' }, 404);
    if (!msg.deletedAt) {
      db.prepare('UPDATE messages SET deletedAt = ?, deletedBy = ? WHERE id = ?')
        .run(new Date().toISOString(), currentAgentId(), mid);
    }
    return c.json({ message: getMessages(db, tid).find((m) => m.id === mid) ?? null });
  });

  // Upload a file (unattached until a message references it), then serve it back.
  app.post('/api/uploads', async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    if (form === null) return c.json({ error: 'invalid form body' }, 400);
    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400);
    if (file.size > MAX_UPLOAD) return c.json({ error: 'file exceeds the 10 MB limit' }, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const attachment: Attachment = {
      id: newId('at_'),
      messageId: null,
      ticketId: null,
      filename: (file.name || 'file').slice(0, 200),
      mimeType: file.type || 'application/octet-stream',
      size: buf.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(path.join(attachDir, attachment.id), buf);
    insertAttachment(db, attachment);
    return c.json(attachment);
  });

  app.get('/api/attachments/:id', (c) => {
    const id = c.req.param('id');
    const att = getAttachment(db, id);
    if (att === null) return c.json({ error: 'attachment not found' }, 404);
    const filePath = path.join(attachDir, id);
    if (!existsSync(filePath)) return c.json({ error: 'file missing' }, 404);
    const buf = readFileSync(filePath);
    // Inline images so they preview in-thread, but never SVG (script vector); everything else downloads.
    const inline = att.mimeType.startsWith('image/') && att.mimeType !== 'image/svg+xml';
    const safeName = att.filename.replace(/[\r\n"]/g, '');
    return c.body(new Uint8Array(buf), 200, {
      'Content-Type': att.mimeType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
    });
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
    let input: { title?: unknown; body?: unknown; actions?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const actions = normalizeMacroActions(input.actions);
    const canned: CannedReply = { id: newId('cr_'), title, body, actions };
    db.prepare('INSERT INTO canned_replies (id, title, body, actions) VALUES (?, ?, ?, ?)').run(
      canned.id, canned.title, canned.body, actions === null ? null : JSON.stringify(actions),
    );
    return c.json(canned);
  });

  app.put('/api/canned/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT id FROM canned_replies WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing === undefined) return c.json({ error: `canned reply not found: ${id}` }, 404);
    let input: { title?: unknown; body?: unknown; actions?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { title, body } = input;
    if (typeof title !== 'string' || title.trim() === '') return c.json({ error: 'title is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const actions = normalizeMacroActions(input.actions);
    db.prepare('UPDATE canned_replies SET title = ?, body = ?, actions = ? WHERE id = ?').run(
      title, body, actions === null ? null : JSON.stringify(actions), id,
    );
    return c.json({ id, title, body, actions } satisfies CannedReply);
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
    const CONDITIONS = ['subject_contains', 'body_contains', 'priority_is', 'channel_is', 'from_contains'];
    const ACTIONS = ['set_priority', 'add_tag', 'assign', 'set_status'];
    for (const r of input as AutomationRule[]) {
      if (
        typeof r?.id !== 'string' || typeof r?.name !== 'string' || typeof r?.enabled !== 'boolean' ||
        (r?.match !== 'all' && r?.match !== 'any') ||
        (r?.runOn !== 'create' && r?.runOn !== 'create_update') ||
        !Array.isArray(r?.conditions) || !Array.isArray(r?.actions)
      ) {
        return c.json({ error: 'invalid automation rule' }, 400);
      }
      for (const cnd of r.conditions) {
        if (!CONDITIONS.includes(cnd?.type) || typeof cnd?.value !== 'string') return c.json({ error: 'invalid condition' }, 400);
      }
      for (const act of r.actions) {
        if (!ACTIONS.includes(act?.type) || typeof act?.value !== 'string') return c.json({ error: 'invalid action' }, 400);
      }
    }
    setSetting(db, 'automation', JSON.stringify(input));
    return c.json(input);
  });

  app.put('/api/settings/sla-hours', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const h = input as Record<string, unknown>;
    if (
      typeof h?.enabled !== 'boolean' || typeof h?.timezone !== 'string' ||
      !Array.isArray(h?.days) || !h.days.every((d) => typeof d === 'number' && d >= 0 && d <= 6) ||
      typeof h?.start !== 'string' || !/^\d{2}:\d{2}$/.test(h.start) ||
      typeof h?.end !== 'string' || !/^\d{2}:\d{2}$/.test(h.end)
    ) {
      return c.json({ error: 'invalid business hours' }, 400);
    }
    setSetting(db, 'sla_hours', JSON.stringify(input));
    return c.json(input);
  });

  app.post('/api/agents', async (c) => {
    let input: { name?: unknown; email?: unknown; role?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, role } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof email !== 'string' || email.trim() === '') return c.json({ error: 'email is required' }, 400);
    const agent: Agent = {
      id: newId('a_'), name: name.trim(), email: email.trim(), avatarHue: djb2(email.trim()) % 360,
      role: role === 'admin' ? 'admin' : 'agent', status: 'invited',
      inviteToken: `inv_${randomUUID().replace(/-/g, '').slice(0, 16)}`, signature: '',
    };
    db.prepare('INSERT INTO agents (id, name, email, avatarHue, role, status, inviteToken, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.email, agent.avatarHue, agent.role, agent.status, agent.inviteToken, agent.signature);
    return c.json(agent);
  });

  app.patch('/api/agents/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
    if (existing === undefined) return c.json({ error: `agent not found: ${id}` }, 404);
    let patch: { name?: unknown; role?: unknown; signature?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: string[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    if ('role' in patch) {
      if (patch.role !== 'admin' && patch.role !== 'agent') return c.json({ error: 'invalid role' }, 400);
      sets.push('role = ?');
      params.push(patch.role);
    }
    if ('signature' in patch) {
      if (typeof patch.signature !== 'string') return c.json({ error: 'invalid signature' }, 400);
      sets.push('signature = ?');
      params.push(patch.signature);
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
  });

  app.delete('/api/agents/:id', (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
    if (existing === undefined) return c.json({ error: `agent not found: ${id}` }, 404);
    const admins = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role = 'admin' AND status = 'active'").get() as { n: number };
    if (existing.role === 'admin' && existing.status === 'active' && admins.n <= 1) {
      return c.json({ error: 'cannot remove the last admin' }, 400);
    }
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    return c.json({ ok: true });
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

  app.post('/api/ai/run', async (c) => {
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
      if ((await runAgentsOnTicket(ticket, firstContact?.body ?? '')) !== null) created += 1;
    }
    return c.json({ created });
  });

  // --- SMTP / email notifications (the password never leaves the server) ---

  app.get('/api/settings/smtp', (c) => c.json(toPublicSmtp(getSmtpConfig(db))));

  app.put('/api/settings/smtp', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const current = getSmtpConfig(db);
    const str = (k: string, fallback: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : fallback);
    const cfg = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      host: str('host', current.host),
      port: typeof input.port === 'number' && input.port > 0 && input.port <= 65535 ? input.port : current.port,
      secure: typeof input.secure === 'boolean' ? input.secure : current.secure,
      user: str('user', current.user),
      fromName: str('fromName', current.fromName) || 'Support',
      fromEmail: str('fromEmail', current.fromEmail),
      publicUrl: (str('publicUrl', current.publicUrl) || current.publicUrl).replace(/\/+$/, ''),
      // pass absent → keep the stored password; a string (even empty) replaces it.
      pass: typeof input.pass === 'string' ? input.pass : current.pass,
    };
    setSmtpConfig(db, cfg);
    return c.json(toPublicSmtp(cfg));
  });

  app.post('/api/settings/smtp/test', async (c) => {
    let input: { to?: unknown };
    try {
      input = (await c.req.json()) as { to?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const cfg = getSmtpConfig(db);
    const to = typeof input.to === 'string' && input.to.trim() !== '' ? input.to.trim() : cfg.fromEmail;
    if (cfg.host.trim() === '' || cfg.fromEmail.trim() === '') return c.json({ ok: false, error: 'Set the SMTP host and From address first' }, 400);
    if (to === '') return c.json({ ok: false, error: 'No recipient — set a From address or pass one' }, 400);
    try {
      await sendTestEmail(cfg, to);
      return c.json({ ok: true, to });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'send failed' });
    }
  });

  // --- Model provider config (the API key never leaves the server) ---

  app.get('/api/ai/provider', (c) => c.json(toPublicProvider(getAiProviderConfig(db))));

  app.put('/api/ai/provider', async (c) => {
    let input: Record<string, unknown>;
    try {
      input = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const current = getAiProviderConfig(db);
    const temp = typeof input.temperature === 'number' ? input.temperature : current.temperature;
    const cfg: AiProviderConfig = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      baseUrl: typeof input.baseUrl === 'string' && input.baseUrl.trim() !== '' ? input.baseUrl.trim() : current.baseUrl,
      model: typeof input.model === 'string' && input.model.trim() !== '' ? input.model.trim() : current.model,
      temperature: Math.min(2, Math.max(0, temp)),
      reasoning: typeof input.reasoning === 'boolean' ? input.reasoning : current.reasoning,
      kbOnly: typeof input.kbOnly === 'boolean' ? input.kbOnly : current.kbOnly,
      // apiKey absent → keep the stored key; a string (even empty) replaces it.
      apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : current.apiKey,
    };
    setAiProviderConfig(db, cfg);
    return c.json(toPublicProvider(cfg));
  });

  app.post('/api/ai/provider/test', async (c) => {
    let override: Record<string, unknown> = {};
    try {
      override = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // no body — test the stored config
    }
    const stored = getAiProviderConfig(db);
    const cfg: LlmConfig = {
      baseUrl: typeof override.baseUrl === 'string' && override.baseUrl.trim() !== '' ? override.baseUrl.trim() : stored.baseUrl,
      model: typeof override.model === 'string' && override.model.trim() !== '' ? override.model.trim() : stored.model,
      apiKey: typeof override.apiKey === 'string' && override.apiKey.trim() !== '' ? override.apiKey.trim() : stored.apiKey,
      temperature: 0,
    };
    if (cfg.apiKey === '') return c.json({ ok: false, error: 'Add an API key first' }, 400);
    const started = Date.now();
    try {
      const { reply } = await ping(cfg);
      return c.json({ ok: true, model: cfg.model, latencyMs: Date.now() - started, empty: reply.trim() === '' });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'request failed' });
    }
  });

  // --- Copilot: model-backed with a rule-based fallback ---

  app.post('/api/ai/draft', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const contact = getContact(db, ticket.requesterId);
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(currentAgentId()) as Agent | undefined;
    const canned = getCannedReplies(db);
    const allKb = db.prepare("SELECT * FROM kb_articles WHERE status = 'published'").all() as unknown as KbArticle[];
    const thread = threadOf(ticket.id);
    const contactName = contact?.name ?? 'there';
    const agentName = agent?.name ?? 'there';
    const lastCustomer = [...thread].reverse().find((m) => m.role === 'customer')?.body ?? '';
    // Give the model only the articles relevant to this ticket — it answers from these alone.
    const kb = rankKb(`${ticket.subject} ${lastCustomer}`, allKb, 5);
    const fallback = draftReply({ subject: ticket.subject, contactName, agentName, lastCustomerMessage: lastCustomer, canned });
    const result = await draftReplyAI(
      getAiProviderConfig(db),
      { subject: ticket.subject, contactName, agentName, signature: agent?.signature ?? '', thread, canned, kb },
      fallback,
    );
    return c.json(result);
  });

  app.post('/api/ai/triage', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const thread = threadOf(ticket.id);
    const bodyText = thread.filter((m) => m.role === 'customer').map((m) => m.body).join('\n') || ticket.lastMessagePreview;
    const triageCtx = { subject: ticket.subject, bodyText, currentPriority: ticket.priority, currentTags: ticket.tags };
    const fallback = suggestTriage(triageCtx);
    const result = await suggestTriageAI(getAiProviderConfig(db), triageCtx, fallback);
    return c.json(result);
  });

  app.post('/api/ai/summarize', async (c) => {
    let input: { ticketId?: unknown };
    try {
      input = (await c.req.json()) as { ticketId?: unknown };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.ticketId !== 'string') return c.json({ error: 'ticketId is required' }, 400);
    const ticket = getTicket(db, input.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    const contact = getContact(db, ticket.requesterId);
    const contactName = contact?.name ?? 'there';
    const fallback = summarizeThread({ contactName, messages: getMessages(db, ticket.id) });
    const result = await summarizeThreadAI(getAiProviderConfig(db), { contactName, thread: threadOf(ticket.id) }, fallback);
    return c.json(result);
  });

  app.post('/api/ai/actions/:id/approve', (c) => {
    const id = c.req.param('id');
    const action = getAiAction(db, id);
    if (action === null) return c.json({ error: `action not found: ${id}` }, 404);
    if (action.kind !== 'draft' || action.status !== 'pending') return c.json({ error: 'not an approvable draft' }, 400);
    const ticket = getTicket(db, action.ticketId);
    if (ticket === null) return c.json({ error: 'ticket not found' }, 404);
    if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it to reply' }, 409);
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
    deliverReply(ticket, body);
    return c.json({ action: getAiAction(db, id), ticket: getTicket(db, ticket.id), message });
  });

  app.post('/api/ai/actions/:id/dismiss', (c) => {
    const id = c.req.param('id');
    if (getAiAction(db, id) === null) return c.json({ error: `action not found: ${id}` }, 404);
    db.prepare("UPDATE ai_actions SET status = 'dismissed', resolvedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    return c.json({ action: getAiAction(db, id) });
  });

  // --- Customer portal (email + password auth, everything scoped to one contact) ---

  const psecret = () => portalSecret(db, () => randomUUID().replace(/-/g, ''));
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  /** Resolves the signed-in customer from the Bearer token, or null. */
  const contactFromAuth = (header: string | undefined): Contact | null => {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token === '') return null;
    const id = verifySession(psecret(), token);
    return id === null ? null : getContact(db, id);
  };

  /** Agent display name for portal message attribution (falls back to "Support"). */
  const agentName = (id: string): string => {
    const row = db.prepare('SELECT name FROM agents WHERE id = ?').get(id) as { name: string } | undefined;
    return row?.name ?? 'Support';
  };

  app.post('/api/portal/register', async (c) => {
    let input: { name?: unknown; email?: unknown; password?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { name, email, password } = input;
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'Name is required' }, 400);
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return c.json({ error: 'Enter a valid email' }, 400);
    if (typeof password !== 'string' || password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

    const now = new Date().toISOString();
    let contact = getContactByEmail(db, email);
    if (contact !== null) {
      if (getPortalAuth(db, contact.id) !== null) return c.json({ error: 'An account with this email already exists — please sign in.' }, 409);
      // Claim an existing agent/inbound-created contact by setting its first password.
    } else {
      contact = {
        id: newId('c_'), name: name.trim(), email: email.trim(), company: null, avatarHue: djb2(email.trim()) % 360,
        location: null, timezone: null, createdAt: now, mrr: null,
      };
      db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    }
    setPortalAuth(db, contact.id, hashPassword(password));
    return c.json({ token: signSession(psecret(), contact.id), contact });
  });

  app.post('/api/portal/login', async (c) => {
    let input: { email?: unknown; password?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { email, password } = input;
    if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'Email and password are required' }, 400);
    const contact = getContactByEmail(db, email);
    const hash = contact !== null ? getPortalAuth(db, contact.id) : null;
    if (contact === null || hash === null || !verifyPassword(password, hash)) {
      return c.json({ error: 'Wrong email or password' }, 401);
    }
    return c.json({ token: signSession(psecret(), contact.id), contact });
  });

  app.get('/api/portal/me', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    return contact === null ? c.json({ error: 'not signed in' }, 401) : c.json(contact);
  });

  app.patch('/api/portal/me', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let patch: { name?: unknown; company?: unknown; location?: unknown; timezone?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | null)[] = [];
    if ('name' in patch) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') return c.json({ error: 'invalid name' }, 400);
      sets.push('name = ?');
      params.push(patch.name.trim());
    }
    for (const field of ['company', 'location', 'timezone'] as const) {
      if (field in patch) {
        const v = patch[field];
        if (v !== null && typeof v !== 'string') return c.json({ error: `invalid ${field}` }, 400);
        sets.push(`${field} = ?`);
        params.push(v === null || (v as string).trim() === '' ? null : (v as string).trim());
      }
    }
    if (sets.length > 0) db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params, contact.id);
    return c.json(getContact(db, contact.id));
  });

  app.post('/api/portal/password', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let input: { current?: unknown; next?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { current, next } = input;
    if (typeof next !== 'string' || next.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400);
    const hash = getPortalAuth(db, contact.id);
    if (hash === null || typeof current !== 'string' || !verifyPassword(current, hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
    setPortalAuth(db, contact.id, hashPassword(next));
    return c.json({ ok: true });
  });

  app.get('/api/portal/tickets', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const rows = db
      .prepare("SELECT * FROM tickets WHERE requesterId = ? AND bucket = 'inbox' ORDER BY lastMessageAt DESC")
      .all(contact.id) as unknown as TicketRow[];
    return c.json(rows.map(rowToTicket));
  });

  app.get('/api/portal/tickets/:id', (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    // Customers see public replies only — never internal notes.
    const messages = getMessages(db, ticket.id)
      .filter((m) => m.kind === 'reply')
      .map((m) => ({
        id: m.id,
        authorKind: m.authorKind,
        authorName: m.authorKind === 'contact' ? contact.name : agentName(m.authorId),
        body: m.body,
        at: m.at,
      }));
    return c.json({ ticket, messages });
  });

  app.post('/api/portal/tickets', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    let input: { subject?: unknown; body?: unknown; priority?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { subject, body, priority } = input;
    if (typeof subject !== 'string' || subject.trim() === '') return c.json({ error: 'Subject is required' }, 400);
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'Message is required' }, 400);
    const now = new Date().toISOString();
    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const ticket: Ticket = {
      id: newId('t_'), number: maxRow.maxNumber + 1, subject: subject.trim(), status: 'open',
      priority: PRIORITIES.includes(priority as TicketPriority) ? (priority as TicketPriority) : 'medium',
      bucket: 'inbox', requesterId: contact.id, assigneeId: null, tags: [], channel: 'web',
      createdAt: now, updatedAt: now, snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(body),
      firstRespondedAt: null, resolvedAt: null, channelId: null, customFields: {},
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
    await runAgentsOnTicket(ticket, body);
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  app.post('/api/portal/tickets/:id/messages', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    let input: { body?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.body !== 'string' || input.body.trim() === '') return c.json({ error: 'Message is required' }, 400);
    const now = new Date().toISOString();
    const message: Message = {
      id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body: input.body, at: now,
    };
    // A customer reply reopens a solved ticket and clears its resolution stamp.
    const nextStatus = ticket.status === 'solved' || ticket.status === 'closed' ? 'open' : ticket.status;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
        .run(nextStatus, nextStatus === 'open' ? null : ticket.resolvedAt, now, now, preview(input.body), ticket.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  // A customer rates their support once the ticket is solved or closed (CSAT).
  app.post('/api/portal/tickets/:id/rating', async (c) => {
    const contact = contactFromAuth(c.req.header('Authorization'));
    if (contact === null) return c.json({ error: 'not signed in' }, 401);
    const ticket = getTicket(db, c.req.param('id'));
    if (ticket === null || ticket.requesterId !== contact.id) return c.json({ error: 'ticket not found' }, 404);
    if (ticket.status !== 'solved' && ticket.status !== 'closed') {
      return c.json({ error: 'You can rate your support once the ticket is solved.' }, 409);
    }
    let input: { score?: unknown; comment?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { score } = input;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      return c.json({ error: 'Score must be a whole number from 1 to 5' }, 400);
    }
    const comment = typeof input.comment === 'string' && input.comment.trim() !== '' ? input.comment.trim().slice(0, 1000) : null;
    db.prepare('UPDATE tickets SET satisfactionScore = ?, satisfactionComment = ?, satisfactionAt = ? WHERE id = ?')
      .run(score, comment, new Date().toISOString(), ticket.id);
    return c.json({ ticket: getTicket(db, ticket.id) });
  });

  app.get('/api/portal/kb', (c) => {
    const rows = db.prepare("SELECT * FROM kb_articles WHERE status = 'published' ORDER BY category, title").all() as unknown as KbArticle[];
    return c.json(rows);
  });

  app.post('/api/channels', async (c) => {
    let input: { type?: unknown; name?: unknown; address?: unknown; outboundUrl?: unknown; outboundSecret?: unknown; inboundSecret?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { type, name, address } = input;
    if (typeof type !== 'string' || !CHANNEL_TYPES.includes(type as ChannelType)) return c.json({ error: 'invalid channel type' }, 400);
    if (typeof name !== 'string' || name.trim() === '') return c.json({ error: 'name is required' }, 400);
    const cleanStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const channel: ChannelConn = {
      id: newId('ch_'), type: type as ChannelType, name: name.trim(), enabled: true,
      inboundToken: `tok_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      address: cleanStr(address),
      createdAt: new Date().toISOString(),
      outboundUrl: cleanStr(input.outboundUrl),
      outboundSecret: cleanStr(input.outboundSecret),
      inboundSecret: cleanStr(input.inboundSecret),
    };
    db.prepare('INSERT INTO channels (id, type, name, enabled, inboundToken, address, createdAt, outboundUrl, outboundSecret, inboundSecret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(channel.id, channel.type, channel.name, 1, channel.inboundToken, channel.address, channel.createdAt, channel.outboundUrl, channel.outboundSecret, channel.inboundSecret);
    return c.json(toPublicChannel(channel));
  });

  app.patch('/api/channels/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getChannel(db, id);
    if (existing === null) return c.json({ error: `channel not found: ${id}` }, 404);
    let patch: { name?: unknown; enabled?: unknown; address?: unknown; outboundUrl?: unknown; outboundSecret?: unknown; inboundSecret?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const cleanStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
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
      params.push(cleanStr(patch.address));
    }
    if ('outboundUrl' in patch) {
      sets.push('outboundUrl = ?');
      params.push(cleanStr(patch.outboundUrl));
    }
    // Write-only: only touch a secret when its key is present (blank clears it).
    if ('outboundSecret' in patch) {
      sets.push('outboundSecret = ?');
      params.push(cleanStr(patch.outboundSecret));
    }
    if ('inboundSecret' in patch) {
      sets.push('inboundSecret = ?');
      params.push(cleanStr(patch.inboundSecret));
    }
    if (sets.length === 0) return c.json(toPublicChannel(existing));
    db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    const updated = getChannel(db, id);
    return c.json(toPublicChannel(updated ?? existing));
  });

  app.delete('/api/channels/:id', (c) => {
    const id = c.req.param('id');
    if (getChannel(db, id) === null) return c.json({ error: `channel not found: ${id}` }, 404);
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // Send a canned test message to the channel's outbound endpoint, so an admin
  // can confirm Discord/Slack/relay delivery works before a customer relies on it.
  app.post('/api/channels/:id/test', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: `channel not found: ${id}` }, 404);
    if ((channel.outboundUrl?.trim() ?? '') === '') return c.json({ ok: false, error: 'Add an outbound URL first, then test.' });
    const fromName = getSmtpConfig(db).fromName.trim() || 'Support';
    const result = await sendToChannel(channel, {
      ticketNumber: 0,
      subject: 'BaseDesk test',
      body: 'This is a test from BaseDesk. If you can read this, outbound delivery to this channel is working.',
      toName: null,
      fromName,
    });
    return c.json(result);
  });

  // Verify a channel's inbound token (query) and, if set, an HMAC signature over
  // the raw body. Returns an error Response to short-circuit, or null when valid.
  const checkInbound = (c: Context, channel: ChannelConn, raw: string): Response | null => {
    if (!channel.enabled) return c.json({ error: 'channel disabled' }, 403);
    if (c.req.query('token') !== channel.inboundToken) return c.json({ error: 'invalid token' }, 401);
    const secret = channel.inboundSecret?.trim();
    if (secret) {
      const sig =
        c.req.header('x-basedesk-signature') ?? c.req.header('x-hub-signature-256') ?? c.req.header('x-signature-256');
      if (!verifyHmac(secret, raw, sig)) return c.json({ error: 'invalid signature' }, 401);
    }
    return null;
  };

  const insertMessageRow = (m: Message): void => {
    db.prepare('INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.ticketId, m.authorKind, m.authorId, m.kind, m.body, m.at);
  };

  // Public inbound: a forwarder / bot / widget POSTs a customer message here. A
  // sender (by email or externalId) threads into their one open ticket on this
  // channel — a running conversation, not a new ticket per message.
  app.post('/api/channels/:id/inbound', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    const raw = await c.req.text();
    const bad = checkInbound(c, channel, raw);
    if (bad !== null) return bad;

    let input: { from?: { name?: unknown; email?: unknown; externalId?: unknown }; subject?: unknown; body?: unknown };
    try {
      input = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const body = input.body;
    if (typeof body !== 'string' || body.trim() === '') return c.json({ error: 'body is required' }, 400);
    const email = typeof input.from?.email === 'string' ? input.from.email.trim() : '';
    const externalId = typeof input.from?.externalId === 'string' ? input.from.externalId.trim() : '';
    if (email === '' && externalId === '') return c.json({ error: 'from.email or from.externalId is required' }, 400);

    // A stable identity so the same sender maps to one contact + threads together.
    const identity = email !== '' ? email : `ext_${channel.type}_${externalId}@basedesk.local`;
    const displayName =
      typeof input.from?.name === 'string' && input.from.name.trim() !== ''
        ? input.from.name.trim()
        : email !== '' ? email : `${channel.name} user`;
    const now = new Date().toISOString();

    let contact = db.prepare('SELECT * FROM contacts WHERE email = ?').get(identity) as Contact | undefined;
    if (contact === undefined) {
      contact = {
        id: newId('c_'), name: displayName, email: identity, company: null, avatarHue: djb2(identity) % 360,
        location: null, timezone: null, createdAt: now, mrr: null,
      };
      db.prepare('INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt, contact.mrr);
    }

    // Thread into this sender's most recent still-open ticket on this channel.
    const openRow = db
      .prepare(
        "SELECT * FROM tickets WHERE channelId = ? AND requesterId = ? AND bucket = 'inbox' AND status NOT IN ('solved', 'closed') ORDER BY lastMessageAt DESC LIMIT 1",
      )
      .get(channel.id, contact.id) as TicketRow | undefined;

    if (openRow !== undefined) {
      const existing = rowToTicket(openRow);
      const message: Message = { id: newId('m_'), ticketId: existing.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now };
      db.exec('BEGIN');
      try {
        insertMessageRow(message);
        db.prepare('UPDATE tickets SET updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?')
          .run(now, now, preview(body), existing.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return c.json({ ticketId: existing.id, ticketNumber: existing.number, threaded: true });
    }

    const maxRow = db.prepare('SELECT COALESCE(MAX(number), 0) AS maxNumber FROM tickets').get() as { maxNumber: number };
    const subject = typeof input.subject === 'string' && input.subject.trim() !== '' ? input.subject.trim() : preview(body);
    const ticket: Ticket = {
      id: newId('t_'), number: maxRow.maxNumber + 1, subject, status: 'open', priority: 'medium', bucket: 'inbox',
      requesterId: contact.id, assigneeId: null, tags: [], channel: CHANNEL_TO_TICKET[channel.type],
      createdAt: now, updatedAt: now, snoozedUntil: null, lastMessageAt: now, lastMessagePreview: preview(body),
      firstRespondedAt: null, resolvedAt: null, channelId: channel.id, customFields: {},
    };
    const message: Message = { id: newId('m_'), ticketId: ticket.id, authorKind: 'contact', authorId: contact.id, kind: 'reply', body, at: now };
    db.exec('BEGIN');
    try {
      insertTicketRow(db, ticket);
      insertMessageRow(message);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await runAgentsOnTicket(ticket, body);
    return c.json({ ticketId: ticket.id, ticketNumber: ticket.number, threaded: false });
  });

  // Manage a ticket from the channel side (e.g. a Discord slash command relayed
  // by a bot): reply, solve/close, reopen, or read status. Same token + optional
  // signature auth as inbound. A reply is delivered back out to the channel too.
  app.post('/api/channels/:id/command', async (c) => {
    const id = c.req.param('id');
    const channel = getChannel(db, id);
    if (channel === null) return c.json({ error: 'channel not found' }, 404);
    const raw = await c.req.text();
    const bad = checkInbound(c, channel, raw);
    if (bad !== null) return bad;

    let input: { action?: unknown; ticket?: unknown; text?: unknown };
    try {
      input = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const action = input.action;
    if (typeof action !== 'string') return c.json({ error: 'action is required' }, 400);

    // Resolve the ticket by number or id — and only if it belongs to this channel.
    let ticket: Ticket | null = null;
    if (typeof input.ticket === 'number') {
      const row = db.prepare('SELECT * FROM tickets WHERE number = ? AND channelId = ?').get(input.ticket, channel.id) as TicketRow | undefined;
      ticket = row ? rowToTicket(row) : null;
    } else if (typeof input.ticket === 'string') {
      const t = getTicket(db, input.ticket);
      ticket = t !== null && t.channelId === channel.id ? t : null;
    }
    if (ticket === null) return c.json({ error: 'ticket not found on this channel' }, 404);

    const now = new Date().toISOString();
    if (action === 'reply') {
      const text = input.text;
      if (typeof text !== 'string' || text.trim() === '') return c.json({ error: 'text is required for a reply' }, 400);
      if (ticket.status === 'closed') return c.json({ error: 'ticket is closed — reopen it first' }, 409);
      const message: Message = { id: newId('m_'), ticketId: ticket.id, authorKind: 'agent', authorId: currentAgentId(), kind: 'reply', body: text, at: now };
      const nextStatus = ticket.status === 'open' ? 'pending' : ticket.status;
      db.exec('BEGIN');
      try {
        insertMessageRow(message);
        db.prepare('UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ?, firstRespondedAt = ? WHERE id = ?')
          .run(nextStatus, now, now, preview(text), ticket.firstRespondedAt ?? now, ticket.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      deliverReply(ticket, text);
    } else if (action === 'solve' || action === 'close') {
      const status = action === 'close' ? 'closed' : 'solved';
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ? WHERE id = ?').run(status, ticket.resolvedAt ?? now, now, ticket.id);
    } else if (action === 'reopen') {
      db.prepare('UPDATE tickets SET status = ?, resolvedAt = ?, updatedAt = ? WHERE id = ?').run('open', null, now, ticket.id);
    } else if (action !== 'status') {
      return c.json({ error: `unknown action: ${action}` }, 400);
    }

    const updated = getTicket(db, ticket.id) ?? ticket;
    return c.json({ ok: true, ticket: { id: updated.id, number: updated.number, subject: updated.subject, status: updated.status, assigneeId: updated.assigneeId } });
  });

  // ── Custom fields ────────────────────────────────────────────────────────
  const CUSTOM_FIELD_TYPES: CustomFieldType[] = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];
  const CUSTOM_FIELD_ENTITIES: CustomFieldEntity[] = ['ticket', 'contact'];
  const cleanOptions = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim()) : [];

  app.post('/api/custom-fields', async (c) => {
    let input: { entity?: unknown; label?: unknown; type?: unknown; options?: unknown; required?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { entity, label, type } = input;
    if (typeof entity !== 'string' || !CUSTOM_FIELD_ENTITIES.includes(entity as CustomFieldEntity)) return c.json({ error: 'invalid entity' }, 400);
    if (typeof label !== 'string' || label.trim() === '') return c.json({ error: 'label is required' }, 400);
    if (typeof type !== 'string' || !CUSTOM_FIELD_TYPES.includes(type as CustomFieldType)) return c.json({ error: 'invalid type' }, 400);
    const options = cleanOptions(input.options);
    if (type === 'select' && options.length === 0) return c.json({ error: 'a select field needs at least one option' }, 400);
    const position = getCustomFields(db).filter((f) => f.entity === entity).length;
    const field: CustomFieldDef = {
      id: newId('cf_'), entity: entity as CustomFieldEntity, label: label.trim(), type: type as CustomFieldType,
      options, required: input.required === true, position, createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO custom_fields (id, entity, label, type, options, required, position, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(field.id, field.entity, field.label, field.type, JSON.stringify(field.options), field.required ? 1 : 0, field.position, field.createdAt);
    return c.json(field);
  });

  app.patch('/api/custom-fields/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getCustomField(db, id);
    if (existing === null) return c.json({ error: `custom field not found: ${id}` }, 404);
    let patch: { label?: unknown; type?: unknown; options?: unknown; required?: unknown; position?: unknown };
    try {
      patch = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if ('label' in patch) {
      if (typeof patch.label !== 'string' || patch.label.trim() === '') return c.json({ error: 'invalid label' }, 400);
      sets.push('label = ?');
      params.push(patch.label.trim());
    }
    if ('type' in patch) {
      if (typeof patch.type !== 'string' || !CUSTOM_FIELD_TYPES.includes(patch.type as CustomFieldType)) return c.json({ error: 'invalid type' }, 400);
      sets.push('type = ?');
      params.push(patch.type);
    }
    if ('options' in patch) {
      sets.push('options = ?');
      params.push(JSON.stringify(cleanOptions(patch.options)));
    }
    if ('required' in patch) {
      sets.push('required = ?');
      params.push(patch.required === true ? 1 : 0);
    }
    if ('position' in patch && typeof patch.position === 'number' && Number.isFinite(patch.position)) {
      sets.push('position = ?');
      params.push(patch.position);
    }
    if (sets.length === 0) return c.json(existing);
    db.prepare(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return c.json(getCustomField(db, id));
  });

  app.delete('/api/custom-fields/:id', (c) => {
    const id = c.req.param('id');
    if (getCustomField(db, id) === null) return c.json({ error: `custom field not found: ${id}` }, 404);
    db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  // ── Saved views ───────────────────────────────────────────────────────────
  app.post('/api/saved-views', async (c) => {
    let input: { name?: unknown; view?: unknown; priority?: unknown; assigneeId?: unknown; tag?: unknown };
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof input.name !== 'string' || input.name.trim() === '') return c.json({ error: 'name is required' }, 400);
    if (typeof input.view !== 'string' || input.view.trim() === '') return c.json({ error: 'view is required' }, 400);
    const view: SavedView = {
      id: newId('sv_'),
      name: input.name.trim().slice(0, 60),
      view: input.view as ViewId,
      priority: PRIORITIES.includes(input.priority as TicketPriority) ? (input.priority as TicketPriority) : null,
      assigneeId: typeof input.assigneeId === 'string' && input.assigneeId.trim() !== '' ? input.assigneeId.trim() : null,
      tag: typeof input.tag === 'string' && input.tag.trim() !== '' ? input.tag.trim() : null,
    };
    setSavedViews(db, [...getSavedViews(db), view]);
    return c.json(view);
  });

  app.delete('/api/saved-views/:id', (c) => {
    const id = c.req.param('id');
    const views = getSavedViews(db);
    if (!views.some((v) => v.id === id)) return c.json({ error: `saved view not found: ${id}` }, 404);
    setSavedViews(db, views.filter((v) => v.id !== id));
    return c.json({ ok: true });
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
