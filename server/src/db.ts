import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DEFAULT_AI_PROVIDER } from './defaults.js';
import type { AiAction, AiAgent, AiProvider, AiProviderConfig, ChannelConn, Contact, Deal, KbArticle, Message, Ticket, TicketPriority } from './types.js';

/** Ticket as stored: tags is a JSON string column. */
export type TicketRow = Omit<Ticket, 'tags'> & { tags: string };

export function rowToTicket(row: TicketRow): Ticket {
  return { ...row, tags: JSON.parse(row.tags) as string[] };
}

export function openDb(dataDir: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dataDir, 'basedesk.db'));
  db.exec('PRAGMA journal_mode=WAL;');
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
      channelId TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      ticketId TEXT NOT NULL,
      authorKind TEXT NOT NULL,
      authorId TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canned_replies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL
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
      createdAt TEXT NOT NULL
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

  return db;
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
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
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    };
  } catch {
    return { ...DEFAULT_AI_PROVIDER };
  }
}

export function setAiProviderConfig(db: DatabaseSync, cfg: AiProviderConfig): void {
  setSetting(db, 'ai_provider', JSON.stringify(cfg));
}

/** Strips the secret key, leaving the client-safe status shape. */
export function toPublicProvider(cfg: AiProviderConfig): AiProvider {
  return {
    enabled: cfg.enabled, baseUrl: cfg.baseUrl, model: cfg.model,
    temperature: cfg.temperature, reasoning: cfg.reasoning, hasKey: cfg.apiKey.trim() !== '',
  };
}

export function getTicket(db: DatabaseSync, id: string): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
  return row ? rowToTicket(row) : null;
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
  return db
    .prepare('SELECT * FROM messages WHERE ticketId = ? ORDER BY at ASC, id ASC')
    .all(ticketId) as unknown as Message[];
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
    `INSERT INTO ai_actions (id, agentId, ticketId, kind, status, draftBody, suggestedPriority, suggestedTags, kbArticleId, createdAt, resolvedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.agentId, a.ticketId, a.kind, a.status, a.draftBody, a.suggestedPriority, JSON.stringify(a.suggestedTags), a.kbArticleId, a.createdAt, a.resolvedAt);
}

type ChannelRow = Omit<ChannelConn, 'enabled'> & { enabled: number };
export function rowToChannel(row: ChannelRow): ChannelConn {
  return { ...row, enabled: row.enabled === 1 };
}
export function getChannels(db: DatabaseSync): ChannelConn[] {
  return (db.prepare('SELECT * FROM channels ORDER BY createdAt').all() as unknown as ChannelRow[]).map(rowToChannel);
}
export function getChannel(db: DatabaseSync, id: string): ChannelConn | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
  return row ? rowToChannel(row) : null;
}
