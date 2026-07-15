import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DEFAULT_AI_PROVIDER, DEFAULT_SMTP } from './defaults.js';
import type { Agent, Attachment, AiAction, AiAgent, AiProvider, AiProviderConfig, AuditEvent, CannedReply, ChannelConn, Contact, CustomFieldDef, Deal, IntakeAnswer, IntakeForm, KbArticle, MacroActions, Message, ModelCache, Notification, PublicChannel, SavedView, SmtpConfig, SmtpSettings, Ticket, TicketEvent, TicketPriority, TicketSeen, TicketTask, TicketTemplate } from './types.js';
import { DEFAULT_INTAKE_FORM } from './defaults.js';

/** Ticket as stored: tags and customFields are JSON string columns. */
export type TicketRow = Omit<Ticket, 'tags' | 'customFields'> & { tags: string; customFields: string | null };

export function rowToTicket(row: TicketRow): Ticket {
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
    customFields: JSON.parse(row.customFields ?? '{}') as Record<string, string>,
    awaitingReply: false, // placeholder — display paths compute it from the last reply
  };
}

/** Checkpoint the WAL into the main db file so recent writes survive a bare-file
 *  copy/backup (the WAL isn't part of a naive `cp basedesk.db`). Best-effort. */
function flushWal(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  } catch {
    /* ignore — checkpoint is an optimization, not required for correctness */
  }
}

export function openDb(dataDir: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dataDir, 'basedesk.db'));
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;'); // WAL-recommended: durable across app restarts, fast writes
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatarHue INTEGER NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      inviteToken TEXT,
      signature TEXT NOT NULL DEFAULT '',
      categories TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      avatarHue INTEGER NOT NULL,
      location TEXT,
      timezone TEXT,
      createdAt TEXT NOT NULL,
      mrr INTEGER
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      bucket TEXT NOT NULL,
      requesterId TEXT NOT NULL,
      assigneeId TEXT,
      tags TEXT NOT NULL,
      channel TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      snoozedUntil TEXT,
      lastMessageAt TEXT NOT NULL,
      lastMessagePreview TEXT NOT NULL,
      firstRespondedAt TEXT,
      resolvedAt TEXT,
      channelId TEXT,
      customFields TEXT NOT NULL DEFAULT '{}',
      satisfactionScore INTEGER,
      satisfactionComment TEXT,
      satisfactionAt TEXT,
      category TEXT
    );
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      authorKind TEXT NOT NULL,
      authorId TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      at TEXT NOT NULL,
      deletedAt TEXT,
      deletedBy TEXT
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      messageId TEXT,
      ticketId TEXT,
      filename TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canned_replies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT NOT NULL,
      category TEXT,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      ticketId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      actorId TEXT NOT NULL,
      actorName TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'mention',
      createdAt TEXT NOT NULL,
      readAt TEXT
    );
    CREATE TABLE IF NOT EXISTS ticket_events (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      kind TEXT NOT NULL,
      actorId TEXT,
      detail TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      promptTokens INTEGER NOT NULL,
      completionTokens INTEGER NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_seen (
      ticketId TEXT NOT NULL,
      viewerId TEXT NOT NULL,
      viewerKind TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (ticketId, viewerId)
    );
    CREATE TABLE IF NOT EXISTS ticket_intake (
      ticketId TEXT PRIMARY KEY,
      answers TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_followers (
      ticketId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (ticketId, agentId)
    );
    CREATE TABLE IF NOT EXISTS ticket_tasks (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      doneAt TEXT
    );
    CREATE TABLE IF NOT EXISTS time_rule_fired (
      ruleId TEXT NOT NULL,
      ticketId TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (ruleId, ticketId)
    );
    CREATE TABLE IF NOT EXISTS ticket_links (
      id TEXT PRIMARY KEY,
      fromId TEXT NOT NULL,
      toId TEXT NOT NULL,
      type TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      stage TEXT NOT NULL,
      value INTEGER NOT NULL,
      currency TEXT NOT NULL,
      contactId TEXT NOT NULL,
      ticketId TEXT,
      ownerId TEXT NOT NULL,
      note TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      closedAt TEXT,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portal_auth (
      contactId TEXT PRIMARY KEY,
      passwordHash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kb_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      category TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatarHue INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      autonomy TEXT NOT NULL,
      scopeTags TEXT NOT NULL,
      scopePriorities TEXT NOT NULL,
      scopeCategories TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_actions (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      ticketId TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      draftBody TEXT,
      suggestedPriority TEXT,
      suggestedTags TEXT NOT NULL,
      kbArticleId TEXT,
      promptTokens INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      resolvedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_actions_status ON ai_actions(kind, status);
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      inboundToken TEXT NOT NULL,
      address TEXT,
      createdAt TEXT NOT NULL,
      outboundUrl TEXT,
      outboundSecret TEXT,
      inboundSecret TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_bucket ON tickets(bucket);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket_at ON messages(ticketId, at);
    CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contactId);
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
  `);

  // Migration for databases created before v0.2 (contacts predate the mrr column).
  const contactCols = db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[];
  if (!contactCols.some((c) => c.name === 'mrr')) {
    db.exec('ALTER TABLE contacts ADD COLUMN mrr INTEGER');
  }

  // Migration for databases created before v0.3 (tickets predate the SLA columns).
  const ticketCols = db.prepare('PRAGMA table_info(tickets)').all() as { name: string }[];
  if (!ticketCols.some((c) => c.name === 'firstRespondedAt')) {
    db.exec('ALTER TABLE tickets ADD COLUMN firstRespondedAt TEXT');
  }
  if (!ticketCols.some((c) => c.name === 'resolvedAt')) {
    db.exec('ALTER TABLE tickets ADD COLUMN resolvedAt TEXT');
  }
  if (!ticketCols.some((c) => c.name === 'channelId')) {
    db.exec('ALTER TABLE tickets ADD COLUMN channelId TEXT');
  }
  const agentCols = db.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  if (!agentCols.some((c) => c.name === 'status')) db.exec("ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!agentCols.some((c) => c.name === 'inviteToken')) db.exec('ALTER TABLE agents ADD COLUMN inviteToken TEXT');
  if (!agentCols.some((c) => c.name === 'signature')) db.exec("ALTER TABLE agents ADD COLUMN signature TEXT NOT NULL DEFAULT ''");

  const actionCols = db.prepare('PRAGMA table_info(ai_actions)').all() as { name: string }[];
  if (!actionCols.some((c) => c.name === 'promptTokens')) db.exec('ALTER TABLE ai_actions ADD COLUMN promptTokens INTEGER NOT NULL DEFAULT 0');
  if (!actionCols.some((c) => c.name === 'completionTokens')) db.exec('ALTER TABLE ai_actions ADD COLUMN completionTokens INTEGER NOT NULL DEFAULT 0');

  const channelCols = db.prepare('PRAGMA table_info(channels)').all() as { name: string }[];
  if (!channelCols.some((c) => c.name === 'outboundUrl')) db.exec('ALTER TABLE channels ADD COLUMN outboundUrl TEXT');
  if (!channelCols.some((c) => c.name === 'outboundSecret')) db.exec('ALTER TABLE channels ADD COLUMN outboundSecret TEXT');
  if (!channelCols.some((c) => c.name === 'inboundSecret')) db.exec('ALTER TABLE channels ADD COLUMN inboundSecret TEXT');

  if (!ticketCols.some((c) => c.name === 'customFields')) db.exec("ALTER TABLE tickets ADD COLUMN customFields TEXT NOT NULL DEFAULT '{}'");
  if (!ticketCols.some((c) => c.name === 'satisfactionScore')) db.exec('ALTER TABLE tickets ADD COLUMN satisfactionScore INTEGER');
  if (!ticketCols.some((c) => c.name === 'satisfactionComment')) db.exec('ALTER TABLE tickets ADD COLUMN satisfactionComment TEXT');
  if (!ticketCols.some((c) => c.name === 'satisfactionAt')) db.exec('ALTER TABLE tickets ADD COLUMN satisfactionAt TEXT');

  const messageCols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
  if (!messageCols.some((c) => c.name === 'deletedAt')) db.exec('ALTER TABLE messages ADD COLUMN deletedAt TEXT');
  if (!messageCols.some((c) => c.name === 'deletedBy')) db.exec('ALTER TABLE messages ADD COLUMN deletedBy TEXT');

  const cannedCols = db.prepare('PRAGMA table_info(canned_replies)').all() as { name: string }[];
  if (!cannedCols.some((c) => c.name === 'actions')) db.exec('ALTER TABLE canned_replies ADD COLUMN actions TEXT');

  if (!ticketCols.some((c) => c.name === 'mergedIntoId')) db.exec('ALTER TABLE tickets ADD COLUMN mergedIntoId TEXT');

  // Notifications gained a type ("what") and a denormalized actor name so a
  // customer (non-agent) actor can be shown. Backfill existing rows as mentions.
  const notifCols = db.prepare('PRAGMA table_info(notifications)').all() as { name: string }[];
  if (!notifCols.some((c) => c.name === 'kind')) db.exec("ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'mention'");
  if (!notifCols.some((c) => c.name === 'actorName')) {
    db.exec("ALTER TABLE notifications ADD COLUMN actorName TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE notifications SET actorName = COALESCE((SELECT name FROM agents WHERE agents.id = notifications.actorId), '') WHERE actorName = ''");
  }

  // Intake forms (v0.5): tickets carry a category; agents + AI agents carry the
  // categories they cover.
  if (!ticketCols.some((c) => c.name === 'category')) db.exec('ALTER TABLE tickets ADD COLUMN category TEXT');
  if (!agentCols.some((c) => c.name === 'categories')) db.exec("ALTER TABLE agents ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
  const aiAgentCols = db.prepare('PRAGMA table_info(ai_agents)').all() as { name: string }[];
  if (!aiAgentCols.some((c) => c.name === 'scopeCategories')) db.exec("ALTER TABLE ai_agents ADD COLUMN scopeCategories TEXT NOT NULL DEFAULT '[]'");

  // One-time backfill: seed the usage ledger from any pre-existing AI actions so
  // an upgraded install keeps the token history it already recorded. New calls
  // (interactive + autonomous) append to the ledger going forward.
  const usageRows = (db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get() as { n: number }).n;
  if (usageRows === 0) {
    db.exec(
      `INSERT INTO ai_usage (id, kind, promptTokens, completionTokens, at)
       SELECT id, kind, promptTokens, completionTokens, createdAt FROM ai_actions
       WHERE (promptTokens + completionTokens) > 0`,
    );
  }

  return db;
}

export interface AiUsageTotals { promptTokens: number; completionTokens: number; generations: number }

/** Aggregate token spend across every recorded model call (interactive + autonomous). */
export function getAiUsage(db: DatabaseSync): AiUsageTotals {
  const r = db
    .prepare('SELECT COALESCE(SUM(promptTokens), 0) AS p, COALESCE(SUM(completionTokens), 0) AS c, COUNT(*) AS n FROM ai_usage')
    .get() as { p: number; c: number; n: number };
  return { promptTokens: r.p, completionTokens: r.c, generations: r.n };
}

export function insertAiUsage(
  db: DatabaseSync,
  u: { id: string; kind: string; promptTokens: number; completionTokens: number; at: string },
): void {
  db.prepare('INSERT INTO ai_usage (id, kind, promptTokens, completionTokens, at) VALUES (?, ?, ?, ?, ?)')
    .run(u.id, u.kind, u.promptTokens, u.completionTokens, u.at);
}

/**
 * Read every canned reply, decoding the `actions` JSON column into a
 * {@link MacroActions} object (or null for a plain reply). Centralised so the
 * three read sites (bootstrap + two AI-context builders) stay consistent.
 */
export function getCannedReplies(db: DatabaseSync): CannedReply[] {
  const rows = db
    .prepare('SELECT id, title, body, actions FROM canned_replies ORDER BY rowid')
    .all() as { id: string; title: string; body: string; actions: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    actions: parseMacroActions(r.actions),
  }));
}

/** Read every ticket template, decoding the JSON `tags` column. */
export function getTicketTemplates(db: DatabaseSync): TicketTemplate[] {
  const rows = db
    .prepare('SELECT id, name, subject, body, priority, category, tags FROM ticket_templates ORDER BY rowid')
    .all() as { id: string; name: string; subject: string; body: string; priority: string; category: string | null; tags: string }[];
  return rows.map((r) => {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(r.tags);
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
    } catch {
      tags = [];
    }
    return { id: r.id, name: r.name, subject: r.subject, body: r.body, priority: r.priority as TicketPriority, category: r.category, tags };
  });
}

function parseMacroActions(raw: string | null): MacroActions | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MacroActions) : null;
  } catch {
    return null;
  }
}

/**
 * An agent's @mention notifications, newest first. actorName and ticketSubject
 * are joined live (and a notification whose ticket was hard-deleted is skipped).
 */
export function getNotifications(db: DatabaseSync, agentId: string, limit = 50): Notification[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.agentId, n.ticketId, n.messageId, n.actorId, n.actorName, n.snippet, n.kind, n.createdAt, n.readAt,
              t.subject AS ticketSubject, t.channel AS channel
         FROM notifications n
         JOIN tickets t ON t.id = n.ticketId
        WHERE n.agentId = ?
        ORDER BY n.createdAt DESC
        LIMIT ?`,
    )
    .all(agentId, limit) as (Omit<Notification, 'ticketSubject'> & { ticketSubject: string })[];
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, ticketId: r.ticketId, ticketSubject: r.ticketSubject,
    messageId: r.messageId, actorId: r.actorId, actorName: r.actorName, snippet: r.snippet,
    kind: r.kind, channel: r.channel, createdAt: r.createdAt, readAt: r.readAt,
  }));
}

export function insertNotification(
  db: DatabaseSync,
  n: { id: string; agentId: string; ticketId: string; messageId: string; actorId: string; snippet: string; createdAt: string; readAt?: string | null; kind?: Notification['kind']; actorName?: string },
): void {
  // Seed rows (and legacy callers) omit actorName; resolve it from the agent so the
  // display name is always present without a join at read time.
  const actorName =
    n.actorName ??
    ((db.prepare('SELECT name FROM agents WHERE id = ?').get(n.actorId) as { name: string } | undefined)?.name ?? '');
  db.prepare(
    'INSERT INTO notifications (id, agentId, ticketId, messageId, actorId, actorName, snippet, kind, createdAt, readAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(n.id, n.agentId, n.ticketId, n.messageId, n.actorId, actorName, n.snippet, n.kind ?? 'mention', n.createdAt, n.readAt ?? null);
}

/** A ticket's activity events, oldest first, with the actor's name resolved live. */
export function getTicketEvents(db: DatabaseSync, ticketId: string): TicketEvent[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.ticketId, e.kind, e.actorId, e.detail, e.at, a.name AS actorName
         FROM ticket_events e
         LEFT JOIN agents a ON a.id = e.actorId
        WHERE e.ticketId = ?
        ORDER BY e.at ASC, e.rowid ASC`,
    )
    .all(ticketId) as { id: string; ticketId: string; kind: string; actorId: string | null; detail: string; at: string; actorName: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    kind: r.kind as TicketEvent['kind'],
    actorId: r.actorId,
    actorName: r.actorName,
    detail: safeParse(r.detail),
    at: r.at,
  }));
}

/** Recent activity across every ticket, newest first, for the global audit log. */
export function getAllEvents(db: DatabaseSync, opts: { limit?: number } = {}): AuditEvent[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 500), 1), 2000);
  const rows = db
    .prepare(
      `SELECT e.id, e.ticketId, e.kind, e.actorId, e.detail, e.at,
              a.name AS actorName, t.number AS ticketNumber, t.subject AS ticketSubject
         FROM ticket_events e
         LEFT JOIN agents a ON a.id = e.actorId
         LEFT JOIN tickets t ON t.id = e.ticketId
        ORDER BY e.at DESC, e.rowid DESC
        LIMIT ?`,
    )
    .all(limit) as { id: string; ticketId: string; kind: string; actorId: string | null; detail: string; at: string; actorName: string | null; ticketNumber: number | null; ticketSubject: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    kind: r.kind as TicketEvent['kind'],
    actorId: r.actorId,
    actorName: r.actorName,
    detail: safeParse(r.detail),
    at: r.at,
    ticketNumber: r.ticketNumber ?? 0,
    ticketSubject: r.ticketSubject ?? '(deleted ticket)',
  }));
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function insertTicketEvent(
  db: DatabaseSync,
  e: { id: string; ticketId: string; kind: TicketEvent['kind']; actorId: string | null; detail: Record<string, unknown>; at: string },
): void {
  db.prepare('INSERT INTO ticket_events (id, ticketId, kind, actorId, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.id, e.ticketId, e.kind, e.actorId, JSON.stringify(e.detail), e.at);
}

/** Upsert when a viewer last saw a ticket's thread (one row per viewer per ticket). */
export function recordSeen(db: DatabaseSync, ticketId: string, viewerId: string, viewerKind: TicketSeen['viewerKind'], at: string): void {
  db.prepare(
    `INSERT INTO ticket_seen (ticketId, viewerId, viewerKind, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticketId, viewerId) DO UPDATE SET at = excluded.at`,
  ).run(ticketId, viewerId, viewerKind, at);
}

export function getTicketSeen(db: DatabaseSync, ticketId: string): TicketSeen[] {
  return db.prepare('SELECT viewerId, viewerKind, at FROM ticket_seen WHERE ticketId = ?').all(ticketId) as unknown as TicketSeen[];
}

/** The intake-form answers captured when a ticket was opened (metadata, not conversation). */
export function setTicketIntake(db: DatabaseSync, ticketId: string, answers: IntakeAnswer[]): void {
  if (answers.length === 0) return;
  db.prepare(
    `INSERT INTO ticket_intake (ticketId, answers) VALUES (?, ?)
     ON CONFLICT(ticketId) DO UPDATE SET answers = excluded.answers`,
  ).run(ticketId, JSON.stringify(answers));
}
export function getTicketIntake(db: DatabaseSync, ticketId: string): IntakeAnswer[] {
  const row = db.prepare('SELECT answers FROM ticket_intake WHERE ticketId = ?').get(ticketId) as { answers: string } | undefined;
  if (row === undefined) return [];
  try {
    return JSON.parse(row.answers) as IntakeAnswer[];
  } catch {
    return [];
  }
}

/** Followers watch a ticket for new activity even when they aren't the assignee. */
export function followTicket(db: DatabaseSync, ticketId: string, agentId: string, at: string): void {
  db.prepare(
    `INSERT INTO ticket_followers (ticketId, agentId, at) VALUES (?, ?, ?)
     ON CONFLICT(ticketId, agentId) DO NOTHING`,
  ).run(ticketId, agentId, at);
}
export function unfollowTicket(db: DatabaseSync, ticketId: string, agentId: string): void {
  db.prepare('DELETE FROM ticket_followers WHERE ticketId = ? AND agentId = ?').run(ticketId, agentId);
}
export function getFollowers(db: DatabaseSync, ticketId: string): { agentId: string; at: string }[] {
  return db
    .prepare('SELECT agentId, at FROM ticket_followers WHERE ticketId = ? ORDER BY at')
    .all(ticketId) as unknown as { agentId: string; at: string }[];
}

/** A ticket's checklist — sub-steps an agent works through to resolve it. */
export function getTasks(db: DatabaseSync, ticketId: string): TicketTask[] {
  const rows = db
    .prepare('SELECT id, ticketId, title, done, position, createdAt, doneAt FROM ticket_tasks WHERE ticketId = ? ORDER BY position, createdAt')
    .all(ticketId) as unknown as (Omit<TicketTask, 'done'> & { done: number })[];
  return rows.map((r) => ({ ...r, done: r.done === 1 }));
}
export function getTask(db: DatabaseSync, id: string): TicketTask | null {
  const rows = db.prepare('SELECT id, ticketId, title, done, position, createdAt, doneAt FROM ticket_tasks WHERE id = ?').all(id) as unknown as (Omit<TicketTask, 'done'> & { done: number })[];
  return rows.length > 0 ? { ...rows[0], done: rows[0].done === 1 } : null;
}
export function nextTaskPosition(db: DatabaseSync, ticketId: string): number {
  const row = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ticket_tasks WHERE ticketId = ?').get(ticketId) as { n: number };
  return row.n;
}
export function insertTask(db: DatabaseSync, t: TicketTask): void {
  db.prepare('INSERT INTO ticket_tasks (id, ticketId, title, done, position, createdAt, doneAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.id, t.ticketId, t.title, t.done ? 1 : 0, t.position, t.createdAt, t.doneAt);
}
export function patchTask(db: DatabaseSync, id: string, patch: { title?: string; done?: boolean }, now: string): void {
  if (patch.title !== undefined) db.prepare('UPDATE ticket_tasks SET title = ? WHERE id = ?').run(patch.title, id);
  if (patch.done !== undefined) {
    db.prepare('UPDATE ticket_tasks SET done = ?, doneAt = ? WHERE id = ?').run(patch.done ? 1 : 0, patch.done ? now : null, id);
  }
}
export function removeTask(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(id);
}

/** Time-based rules fire once per ticket — these track which have already run. */
export function hasTimeRuleFired(db: DatabaseSync, ruleId: string, ticketId: string): boolean {
  return db.prepare('SELECT 1 FROM time_rule_fired WHERE ruleId = ? AND ticketId = ?').get(ruleId, ticketId) !== undefined;
}
export function recordTimeRuleFired(db: DatabaseSync, ruleId: string, ticketId: string, at: string): void {
  db.prepare('INSERT OR IGNORE INTO time_rule_fired (ruleId, ticketId, at) VALUES (?, ?, ?)').run(ruleId, ticketId, at);
}

/** Typed links between tickets. Stored directionally (from → to) with a base type. */
export function insertLink(db: DatabaseSync, row: { id: string; fromId: string; toId: string; type: string; createdAt: string }): void {
  db.prepare('INSERT INTO ticket_links (id, fromId, toId, type, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.fromId, row.toId, row.type, row.createdAt);
}
export function removeLink(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM ticket_links WHERE id = ?').run(id);
}
/** Every stored link touching this ticket, from either side. */
export function getLinkRows(db: DatabaseSync, ticketId: string): { id: string; fromId: string; toId: string; type: string }[] {
  return db
    .prepare('SELECT id, fromId, toId, type FROM ticket_links WHERE fromId = ? OR toId = ? ORDER BY createdAt')
    .all(ticketId, ticketId) as unknown as { id: string; fromId: string; toId: string; type: string }[];
}
export function linkExists(db: DatabaseSync, aId: string, bId: string): boolean {
  return (
    db.prepare('SELECT 1 FROM ticket_links WHERE (fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?)').get(aId, bId, bId, aId) !==
    undefined
  );
}

/** Mark one notification read (scoped to the agent), or all of the agent's if id is omitted. */
export function markNotificationsRead(db: DatabaseSync, agentId: string, at: string, id?: string): void {
  if (id !== undefined) {
    db.prepare('UPDATE notifications SET readAt = ? WHERE id = ? AND agentId = ? AND readAt IS NULL').run(at, id, agentId);
  } else {
    db.prepare('UPDATE notifications SET readAt = ? WHERE agentId = ? AND readAt IS NULL').run(at, agentId);
  }
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getModelCache(db: DatabaseSync): ModelCache | null {
  const raw = getSetting(db, 'model_cache');
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as ModelCache;
    return v && typeof v.baseUrl === 'string' && Array.isArray(v.models) ? v : null;
  } catch {
    return null;
  }
}

export function setModelCache(db: DatabaseSync, cache: ModelCache): void {
  setSetting(db, 'model_cache', JSON.stringify(cache));
}

export function getSavedViews(db: DatabaseSync): SavedView[] {
  const raw = getSetting(db, 'saved_views');
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}
export function setSavedViews(db: DatabaseSync, views: SavedView[]): void {
  setSetting(db, 'saved_views', JSON.stringify(views));
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

/** Full provider config (including the key) as stored server-side. */
export function getAiProviderConfig(db: DatabaseSync): AiProviderConfig {
  const raw = getSetting(db, 'ai_provider');
  if (raw === null) return { ...DEFAULT_AI_PROVIDER };
  try {
    const p = JSON.parse(raw) as Partial<AiProviderConfig>;
    return {
      enabled: Boolean(p.enabled),
      baseUrl: typeof p.baseUrl === 'string' && p.baseUrl.trim() !== '' ? p.baseUrl : DEFAULT_AI_PROVIDER.baseUrl,
      model: typeof p.model === 'string' && p.model.trim() !== '' ? p.model : DEFAULT_AI_PROVIDER.model,
      temperature: typeof p.temperature === 'number' && p.temperature >= 0 ? p.temperature : DEFAULT_AI_PROVIDER.temperature,
      reasoning: Boolean(p.reasoning),
      kbOnly: p.kbOnly === undefined ? true : Boolean(p.kbOnly),
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    };
  } catch {
    return { ...DEFAULT_AI_PROVIDER };
  }
}

export function setAiProviderConfig(db: DatabaseSync, cfg: AiProviderConfig): void {
  setSetting(db, 'ai_provider', JSON.stringify(cfg));
  flushWal(db); // land the secret in the main .db file so a bare copy/backup keeps it
}

/** A safe masked preview of a secret — first 3 + last 3 chars ("sk-…4a2"), or null. */
export function maskSecret(secret: string): string | null {
  const s = secret.trim();
  if (s === '') return null;
  if (s.length <= 8) return `${s.slice(0, 1)}…${s.slice(-1)}`;
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

/** Strips the secret key, leaving the client-safe status shape (+ a masked hint). */
export function toPublicProvider(cfg: AiProviderConfig): AiProvider {
  return {
    enabled: cfg.enabled, baseUrl: cfg.baseUrl, model: cfg.model,
    temperature: cfg.temperature, reasoning: cfg.reasoning, kbOnly: cfg.kbOnly,
    hasKey: cfg.apiKey.trim() !== '', keyHint: maskSecret(cfg.apiKey),
  };
}

/** Full SMTP config (including the password) as stored server-side. */
export function getSmtpConfig(db: DatabaseSync): SmtpConfig {
  const raw = getSetting(db, 'smtp');
  if (raw === null) return { ...DEFAULT_SMTP };
  try {
    const p = JSON.parse(raw) as Partial<SmtpConfig>;
    return {
      enabled: Boolean(p.enabled),
      host: typeof p.host === 'string' ? p.host : '',
      port: typeof p.port === 'number' && p.port > 0 ? p.port : DEFAULT_SMTP.port,
      secure: Boolean(p.secure),
      user: typeof p.user === 'string' ? p.user : '',
      pass: typeof p.pass === 'string' ? p.pass : '',
      fromName: typeof p.fromName === 'string' && p.fromName !== '' ? p.fromName : DEFAULT_SMTP.fromName,
      fromEmail: typeof p.fromEmail === 'string' ? p.fromEmail : '',
      publicUrl: typeof p.publicUrl === 'string' && p.publicUrl !== '' ? p.publicUrl : DEFAULT_SMTP.publicUrl,
    };
  } catch {
    return { ...DEFAULT_SMTP };
  }
}

export function setSmtpConfig(db: DatabaseSync, cfg: SmtpConfig): void {
  setSetting(db, 'smtp', JSON.stringify(cfg));
  flushWal(db); // credential write — flush to the main db file
}

/** Strips the secret password, leaving the client-safe settings shape. */
export function toPublicSmtp(cfg: SmtpConfig): SmtpSettings {
  return {
    enabled: cfg.enabled, host: cfg.host, port: cfg.port, secure: cfg.secure,
    user: cfg.user, fromName: cfg.fromName, fromEmail: cfg.fromEmail, publicUrl: cfg.publicUrl,
    hasPass: cfg.pass.trim() !== '',
  };
}

export function getTicket(db: DatabaseSync, id: string): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
  if (row === undefined) return null;
  return { ...rowToTicket(row), awaitingReply: awaitingReplyFor(db, id) };
}

/** True when a ticket's last public reply is from the customer (support hasn't answered). */
export function awaitingReplyFor(db: DatabaseSync, ticketId: string): boolean {
  const r = db
    .prepare("SELECT authorKind FROM messages WHERE ticketId = ? AND kind = 'reply' AND deletedAt IS NULL ORDER BY at DESC, rowid DESC LIMIT 1")
    .get(ticketId) as { authorKind: string } | undefined;
  return r !== undefined && r.authorKind === 'contact';
}

/** Batch "awaiting reply" for many tickets in one query — the last reply's author per ticket. */
export function awaitingReplyMap(db: DatabaseSync): Map<string, boolean> {
  // SQLite returns the row matching MAX(at) for the bare columns in a min/max group.
  const rows = db
    .prepare("SELECT ticketId, authorKind, MAX(at) AS at FROM messages WHERE kind = 'reply' AND deletedAt IS NULL GROUP BY ticketId")
    .all() as { ticketId: string; authorKind: string }[];
  return new Map(rows.map((r) => [r.ticketId, r.authorKind === 'contact']));
}

export function getContact(db: DatabaseSync, id: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact | undefined;
  return row ?? null;
}

/** Case-insensitive lookup used by portal sign-in. */
export function getContactByEmail(db: DatabaseSync, email: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE lower(email) = lower(?)').get(email.trim()) as Contact | undefined;
  return row ?? null;
}

export function getPortalAuth(db: DatabaseSync, contactId: string): string | null {
  const row = db.prepare('SELECT passwordHash FROM portal_auth WHERE contactId = ?').get(contactId) as { passwordHash: string } | undefined;
  return row?.passwordHash ?? null;
}

export function setPortalAuth(db: DatabaseSync, contactId: string, passwordHash: string): void {
  db.prepare(
    'INSERT INTO portal_auth (contactId, passwordHash) VALUES (?, ?) ON CONFLICT(contactId) DO UPDATE SET passwordHash = excluded.passwordHash',
  ).run(contactId, passwordHash);
}

/** The per-install secret that signs portal sessions, generated once on first use. */
export function portalSecret(db: DatabaseSync, generate: () => string): string {
  const existing = getSetting(db, 'portal_secret');
  if (existing !== null) return existing;
  const secret = generate();
  setSetting(db, 'portal_secret', secret);
  return secret;
}

export function getMessages(db: DatabaseSync, ticketId: string): Message[] {
  const messages = db
    .prepare('SELECT * FROM messages WHERE ticketId = ? ORDER BY at ASC, id ASC')
    .all(ticketId) as unknown as Message[];
  const files = db
    .prepare('SELECT * FROM attachments WHERE ticketId = ? ORDER BY createdAt ASC')
    .all(ticketId) as unknown as Attachment[];
  const byMessage = new Map<string, Attachment[]>();
  for (const f of files) {
    if (f.messageId === null) continue;
    const list = byMessage.get(f.messageId) ?? [];
    list.push(f);
    byMessage.set(f.messageId, list);
  }
  // A soft-deleted message keeps its tombstone (who/when) but never leaks its content.
  return messages.map((m) =>
    m.deletedAt
      ? { ...m, body: '', attachments: [] }
      : { ...m, attachments: byMessage.get(m.id) ?? [] },
  );
}

export function getMessage(db: DatabaseSync, id: string): Message | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message | undefined;
  return row ?? null;
}

export function insertAttachment(db: DatabaseSync, a: Attachment): void {
  db.prepare('INSERT INTO attachments (id, messageId, ticketId, filename, mimeType, size, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, a.messageId, a.ticketId, a.filename, a.mimeType, a.size, a.createdAt);
}
export function getAttachment(db: DatabaseSync, id: string): Attachment | null {
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment | undefined;
  return row ?? null;
}
/** Bind pending (unlinked) uploads to a freshly-created message + ticket. */
export function linkAttachments(db: DatabaseSync, ids: string[], messageId: string, ticketId: string): void {
  const stmt = db.prepare('UPDATE attachments SET messageId = ?, ticketId = ? WHERE id = ? AND messageId IS NULL');
  for (const id of ids) stmt.run(messageId, ticketId, id);
}

export function getDeal(db: DatabaseSync, id: string): Deal | null {
  const row = db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as Deal | undefined;
  return row ?? null;
}

export function getKbArticle(db: DatabaseSync, id: string): KbArticle | null {
  const row = db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(id) as KbArticle | undefined;
  return row ?? null;
}

type AiAgentRow = Omit<AiAgent, 'enabled' | 'scopeTags' | 'scopePriorities' | 'scopeCategories'> & {
  enabled: number; scopeTags: string; scopePriorities: string; scopeCategories: string;
};
export function rowToAiAgent(row: AiAgentRow): AiAgent {
  return {
    ...row,
    enabled: row.enabled === 1,
    scopeTags: JSON.parse(row.scopeTags) as string[],
    scopePriorities: JSON.parse(row.scopePriorities) as TicketPriority[],
    scopeCategories: JSON.parse(row.scopeCategories ?? '[]') as string[],
  };
}

/** Agents store their covered categories as a JSON column. */
type AgentRow = Omit<Agent, 'categories'> & { categories: string };
export function rowToAgent(row: AgentRow): Agent {
  return { ...row, categories: JSON.parse(row.categories ?? '[]') as string[] };
}
export function getAgents(db: DatabaseSync): Agent[] {
  return (db.prepare('SELECT * FROM agents ORDER BY rowid').all() as unknown as AgentRow[]).map(rowToAgent);
}
export function getAgent(db: DatabaseSync, id: string): Agent | null {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

/** The branching intake form (decision tree) stored as a single settings blob. */
export function getIntakeForm(db: DatabaseSync): IntakeForm {
  const raw = getSetting(db, 'intake_form');
  if (raw === null) return DEFAULT_INTAKE_FORM;
  try {
    return JSON.parse(raw) as IntakeForm;
  } catch {
    return DEFAULT_INTAKE_FORM;
  }
}
export function setIntakeForm(db: DatabaseSync, form: IntakeForm): void {
  setSetting(db, 'intake_form', JSON.stringify(form));
}
/** Distinct category names an option can assign, across the whole tree — for coverage pickers. */
export function categoriesFromForm(form: IntakeForm): string[] {
  const set = new Set<string>();
  for (const node of Object.values(form.nodes)) {
    for (const opt of node.options) if (opt.category != null && opt.category.trim() !== '') set.add(opt.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
export function getAiAgents(db: DatabaseSync): AiAgent[] {
  return (db.prepare('SELECT * FROM ai_agents ORDER BY createdAt').all() as unknown as AiAgentRow[]).map(rowToAiAgent);
}
export function getAiAgent(db: DatabaseSync, id: string): AiAgent | null {
  const row = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id) as AiAgentRow | undefined;
  return row ? rowToAiAgent(row) : null;
}

type AiActionRow = Omit<AiAction, 'suggestedTags'> & { suggestedTags: string };
export function rowToAiAction(row: AiActionRow): AiAction {
  return { ...row, suggestedTags: JSON.parse(row.suggestedTags) as string[] };
}
export function getAiActions(db: DatabaseSync): AiAction[] {
  return (db.prepare('SELECT * FROM ai_actions ORDER BY createdAt DESC').all() as unknown as AiActionRow[]).map(rowToAiAction);
}
export function getAiAction(db: DatabaseSync, id: string): AiAction | null {
  const row = db.prepare('SELECT * FROM ai_actions WHERE id = ?').get(id) as AiActionRow | undefined;
  return row ? rowToAiAction(row) : null;
}

export function insertAiAction(db: DatabaseSync, a: AiAction): void {
  db.prepare(
    `INSERT INTO ai_actions (id, agentId, ticketId, kind, status, draftBody, suggestedPriority, suggestedTags, kbArticleId, promptTokens, completionTokens, createdAt, resolvedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.agentId, a.ticketId, a.kind, a.status, a.draftBody, a.suggestedPriority, JSON.stringify(a.suggestedTags), a.kbArticleId, a.promptTokens, a.completionTokens, a.createdAt, a.resolvedAt);
}

type ChannelRow = Omit<ChannelConn, 'enabled'> & { enabled: number };
export function rowToChannel(row: ChannelRow): ChannelConn {
  return {
    ...row,
    enabled: row.enabled === 1,
    outboundUrl: row.outboundUrl ?? null,
    outboundSecret: row.outboundSecret ?? null,
    inboundSecret: row.inboundSecret ?? null,
  };
}
/** Strip write-only secrets before a channel crosses the wire to the client. */
export function toPublicChannel(ch: ChannelConn): PublicChannel {
  const { outboundSecret, inboundSecret, ...rest } = ch;
  return {
    ...rest,
    hasOutboundSecret: (outboundSecret ?? '').trim() !== '',
    hasInboundSecret: (inboundSecret ?? '').trim() !== '',
  };
}
export function getChannels(db: DatabaseSync): ChannelConn[] {
  return (db.prepare('SELECT * FROM channels ORDER BY createdAt').all() as unknown as ChannelRow[]).map(rowToChannel);
}
export function getChannel(db: DatabaseSync, id: string): ChannelConn | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
  return row ? rowToChannel(row) : null;
}

type CustomFieldRow = Omit<CustomFieldDef, 'options' | 'required'> & { options: string; required: number };
function rowToCustomField(row: CustomFieldRow): CustomFieldDef {
  return { ...row, options: JSON.parse(row.options) as string[], required: row.required === 1 };
}
export function getCustomFields(db: DatabaseSync): CustomFieldDef[] {
  return (db.prepare('SELECT * FROM custom_fields ORDER BY entity, position, createdAt').all() as unknown as CustomFieldRow[]).map(rowToCustomField);
}
export function getCustomField(db: DatabaseSync, id: string): CustomFieldDef | null {
  const row = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id) as CustomFieldRow | undefined;
  return row ? rowToCustomField(row) : null;
}
