import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { AiAction, AiAgent, Agent, CannedReply, ChannelConn, Contact, Deal, KbArticle, Message, Ticket } from './types.js';

interface SeedData {
  agents: Agent[];
  contacts: Contact[];
  tickets: Ticket[];
  messages: Message[];
  canned: CannedReply[];
  deals: Deal[];
  kb: KbArticle[];
  aiAgents: AiAgent[];
  aiActions: AiAction[];
  channels: ChannelConn[];
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Imports shared/seed.json into the database if the tickets table is empty. */
export function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number };
  if (row.n > 0) return;

  const seedPath = path.resolve(moduleDir, '../../shared/seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedData;

  const insertAgent = db.prepare(
    'INSERT INTO agents (id, name, email, avatarHue, role, status, inviteToken, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertContact = db.prepare(
    'INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt, mrr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTicket = db.prepare(
    `INSERT INTO tickets (
      id, number, subject, status, priority, bucket, requesterId, assigneeId,
      tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview,
      firstRespondedAt, resolvedAt, channelId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertCanned = db.prepare('INSERT INTO canned_replies (id, title, body, actions) VALUES (?, ?, ?, ?)');
  const insertDeal = db.prepare(
    `INSERT INTO deals (
      id, title, type, stage, value, currency, contactId, ticketId, ownerId, note, createdAt, closedAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertKb = db.prepare(
    `INSERT INTO kb_articles (id, title, slug, category, body, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAiAgent = db.prepare(
    `INSERT INTO ai_agents (id, name, avatarHue, enabled, autonomy, scopeTags, scopePriorities, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAiAction = db.prepare(
    `INSERT INTO ai_actions (id, agentId, ticketId, kind, status, draftBody, suggestedPriority, suggestedTags, kbArticleId, promptTokens, completionTokens, createdAt, resolvedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChannel = db.prepare(
    'INSERT INTO channels (id, type, name, enabled, inboundToken, address, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  db.exec('BEGIN');
  try {
    for (const a of seed.agents) insertAgent.run(a.id, a.name, a.email, a.avatarHue, a.role, a.status, a.inviteToken, a.signature);
    for (const c of seed.contacts) {
      insertContact.run(c.id, c.name, c.email, c.company, c.avatarHue, c.location, c.timezone, c.createdAt, c.mrr);
    }
    for (const t of seed.tickets) {
      insertTicket.run(
        t.id, t.number, t.subject, t.status, t.priority, t.bucket, t.requesterId, t.assigneeId,
        JSON.stringify(t.tags), t.channel, t.createdAt, t.updatedAt, t.snoozedUntil,
        t.lastMessageAt, t.lastMessagePreview, t.firstRespondedAt, t.resolvedAt, t.channelId,
      );
    }
    for (const m of seed.messages) {
      insertMessage.run(m.id, m.ticketId, m.authorKind, m.authorId, m.kind, m.body, m.at);
    }
    for (const cr of seed.canned) insertCanned.run(cr.id, cr.title, cr.body, cr.actions ? JSON.stringify(cr.actions) : null);
    for (const d of seed.deals) {
      insertDeal.run(
        d.id, d.title, d.type, d.stage, d.value, d.currency, d.contactId, d.ticketId,
        d.ownerId, d.note, d.createdAt, d.closedAt, d.updatedAt,
      );
    }
    for (const a of seed.kb) {
      insertKb.run(a.id, a.title, a.slug, a.category, a.body, a.status, a.createdAt, a.updatedAt);
    }
    for (const g of seed.aiAgents) {
      insertAiAgent.run(g.id, g.name, g.avatarHue, g.enabled ? 1 : 0, g.autonomy, JSON.stringify(g.scopeTags), JSON.stringify(g.scopePriorities), g.createdAt);
    }
    for (const a of seed.aiActions) {
      insertAiAction.run(a.id, a.agentId, a.ticketId, a.kind, a.status, a.draftBody, a.suggestedPriority, JSON.stringify(a.suggestedTags), a.kbArticleId, a.promptTokens ?? 0, a.completionTokens ?? 0, a.createdAt, a.resolvedAt);
    }
    for (const ch of seed.channels) {
      insertChannel.run(ch.id, ch.type, ch.name, ch.enabled ? 1 : 0, ch.inboundToken, ch.address, ch.createdAt);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
