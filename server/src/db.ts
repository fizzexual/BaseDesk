import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Contact, Message, Ticket } from './types.js';

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
      createdAt TEXT NOT NULL
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
      lastMessagePreview TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_tickets_bucket ON tickets(bucket);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket_at ON messages(ticketId, at);
  `);
  return db;
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
