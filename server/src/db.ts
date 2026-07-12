import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Contact, Deal, KbArticle, Message, Ticket } from './types.js';

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
      role TEXT NOT NULL
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
      resolvedAt TEXT
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

export function getTicket(db: DatabaseSync, id: string): Ticket | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
  return row ? rowToTicket(row) : null;
}

export function getContact(db: DatabaseSync, id: string): Contact | null {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact | undefined;
  return row ?? null;
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
