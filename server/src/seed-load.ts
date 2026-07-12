import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { Agent, CannedReply, Contact, Deal, Message, Ticket } from './types.js';

interface SeedData {
  agents: Agent[];
  contacts: Contact[];
  tickets: Ticket[];
  messages: Message[];
  canned: CannedReply[];
  deals: Deal[];
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Imports shared/seed.json into the database if the tickets table is empty. */
export function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number };
  if (row.n > 0) return;

  const seedPath = path.resolve(moduleDir, '../../shared/seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedData;

  const insertAgent = db.prepare(
    'INSERT INTO agents (id, name, email, avatarHue, role) VALUES (?, ?, ?, ?, ?)',
  );
  const insertContact = db.prepare(
    'INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTicket = db.prepare(
    `INSERT INTO tickets (
      id, number, subject, status, priority, bucket, requesterId, assigneeId,
      tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview,
      firstRespondedAt, resolvedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertCanned = db.prepare('INSERT INTO canned_replies (id, title, body) VALUES (?, ?, ?)');
  const insertDeal = db.prepare(
    `INSERT INTO deals (
      id, title, type, stage, value, currency, contactId, ticketId, ownerId, note, createdAt, closedAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const a of seed.agents) insertAgent.run(a.id, a.name, a.email, a.avatarHue, a.role);
    for (const c of seed.contacts) {
      insertContact.run(c.id, c.name, c.email, c.company, c.avatarHue, c.location, c.timezone, c.createdAt, c.mrr);
    }
    for (const t of seed.tickets) {
      insertTicket.run(
        t.id, t.number, t.subject, t.status, t.priority, t.bucket, t.requesterId, t.assigneeId,
        JSON.stringify(t.tags), t.channel, t.createdAt, t.updatedAt, t.snoozedUntil,
        t.lastMessageAt, t.lastMessagePreview, t.firstRespondedAt, t.resolvedAt,
      );
    }
    for (const m of seed.messages) {
      insertMessage.run(m.id, m.ticketId, m.authorKind, m.authorId, m.kind, m.body, m.at);
    }
    for (const cr of seed.canned) insertCanned.run(cr.id, cr.title, cr.body);
    for (const d of seed.deals) {
      insertDeal.run(
        d.id, d.title, d.type, d.stage, d.value, d.currency, d.contactId, d.ticketId,
        d.ownerId, d.note, d.createdAt, d.closedAt, d.updatedAt,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
