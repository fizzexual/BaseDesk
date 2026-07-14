import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DEFAULT_AI_PROVIDER, DEFAULT_SMTP } from './defaults.js';
import type { Attachment, AiAction, AiAgent, AiProvider, AiProviderConfig, CannedReply, ChannelConn, Contact, CustomFieldDef, Deal, KbArticle, MacroActions, Message, ModelCache, Notification, PublicChannel, SavedView, SmtpConfig, SmtpSettings, Ticket, TicketEvent, TicketPriority } from './types.js';

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
      signature TEXT NOT NULL DEFAULT ''
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
      satisfactionAt TEXT
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
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL,
      ticketId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      actorId TEXT NOT NULL,
      snippet TEXT NOT NULL,
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
      `SELECT n.id, n.agentId, n.ticketId, n.messageId, n.actorId, n.snippet, n.createdAt, n.readAt,
              a.name AS actorName, t.subject AS ticketSubject
         FROM notifications n
         JOIN agents a ON a.id = n.actorId
         JOIN tickets t ON t.id = n.ticketId
        WHERE n.agentId = ?
        ORDER BY n.createdAt DESC
        LIMIT ?`,
    )
    .all(agentId, limit) as (Omit<Notification, 'actorName' | 'ticketSubject'> & { actorName: string; ticketSubject: string })[];
  return rows.map((r) => ({
    id: r.id, agentId: r.agentId, ticketId: r.ticketId, ticketSubject: r.ticketSubject,
    messageId: r.messageId, actorId: r.actorId, actorName: r.actorName, snippet: r.snippet,
    createdAt: r.createdAt, readAt: r.readAt,
  }));
}

export function insertNotification(
  db: DatabaseSync,
  n: { id: string; agentId: string; ticketId: string; messageId: string; actorId: string; snippet: string; createdAt: string; readAt?: string | null },
): void {
  db.prepare(
    'INSERT INTO notifications (id, agentId, ticketId, messageId, actorId, snippet, createdAt, readAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(n.id, n.agentId, n.ticketId, n.messageId, n.actorId, n.snippet, n.createdAt, n.readAt ?? null);
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

type AiAgentRow = Omit<AiAgent, 'enabled' | 'scopeTags' | 'scopePriorities'> & {
  enabled: number; scopeTags: string; scopePriorities: string;
};
export function rowToAiAgent(row: AiAgentRow): AiAgent {
  return {
    ...row,
    enabled: row.enabled === 1,
    scopeTags: JSON.parse(row.scopeTags) as string[],
    scopePriorities: JSON.parse(row.scopePriorities) as TicketPriority[],
  };
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
