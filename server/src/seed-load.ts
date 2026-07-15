import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { AiAction, AiAgent, Agent, CannedReply, ChannelConn, Contact, Deal, KbArticle, Message, Notification, Ticket } from './types.js';
import { insertNotification } from './db.js';
import { DEFAULT_TICKET_TEMPLATES, DEFAULT_STATUS_COMPONENTS } from './defaults.js';

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
  notifications?: Notification[];
  followers?: { ticketId: string; agentId: string; at: string }[];
  intake?: { ticketId: string; answers: { prompt: string; label: string }[] }[];
  tasks?: { id: string; ticketId: string; title: string; done: boolean; position: number; createdAt: string; doneAt: string | null }[];
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
      firstRespondedAt, resolvedAt, channelId, satisfactionScore, satisfactionComment, satisfactionAt, category, mergedIntoId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        t.satisfactionScore ?? null, t.satisfactionComment ?? null, t.satisfactionAt ?? null, t.category ?? null,
        t.mergedIntoId ?? null,
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
    const insertUsage = db.prepare('INSERT INTO ai_usage (id, kind, promptTokens, completionTokens, at) VALUES (?, ?, ?, ?, ?)');
    for (const a of seed.aiActions) {
      insertAiAction.run(a.id, a.agentId, a.ticketId, a.kind, a.status, a.draftBody, a.suggestedPriority, JSON.stringify(a.suggestedTags), a.kbArticleId, a.promptTokens ?? 0, a.completionTokens ?? 0, a.createdAt, a.resolvedAt);
      // Mirror seeded actions into the usage ledger so the AI overview isn't empty.
      if ((a.promptTokens ?? 0) + (a.completionTokens ?? 0) > 0) {
        insertUsage.run(a.id, a.kind, a.promptTokens ?? 0, a.completionTokens ?? 0, a.createdAt);
      }
    }
    for (const ch of seed.channels) {
      insertChannel.run(ch.id, ch.type, ch.name, ch.enabled ? 1 : 0, ch.inboundToken, ch.address, ch.createdAt);
    }
    for (const n of seed.notifications ?? []) {
      insertNotification(db, n);
    }
    const insertFollower = db.prepare('INSERT OR IGNORE INTO ticket_followers (ticketId, agentId, at) VALUES (?, ?, ?)');
    for (const f of seed.followers ?? []) insertFollower.run(f.ticketId, f.agentId, f.at);
    const insertIntake = db.prepare('INSERT OR REPLACE INTO ticket_intake (ticketId, answers) VALUES (?, ?)');
    for (const i of seed.intake ?? []) insertIntake.run(i.ticketId, JSON.stringify(i.answers));
    const insertTask = db.prepare('INSERT INTO ticket_tasks (id, ticketId, title, done, position, createdAt, doneAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of seed.tasks ?? []) insertTask.run(t.id, t.ticketId, t.title, t.done ? 1 : 0, t.position, t.createdAt, t.doneAt);
    const insertTemplate = db.prepare('INSERT INTO ticket_templates (id, name, subject, body, priority, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const t of DEFAULT_TICKET_TEMPLATES) insertTemplate.run(t.id, t.name, t.subject, t.body, t.priority, t.category, JSON.stringify(t.tags));
    const insertComponent = db.prepare('INSERT INTO status_components (id, name, status, position) VALUES (?, ?, ?, ?)');
    for (const cmp of DEFAULT_STATUS_COMPONENTS) insertComponent.run(cmp.id, cmp.name, cmp.status, cmp.position);
    // One resolved showcase incident so the status history isn't empty.
    const nowMs = Date.now();
    const hoursAgo = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
    const incidentUpdates = [
      { at: hoursAgo(50), status: 'investigating', body: 'We are investigating reports of delayed outbound email notifications.' },
      { at: hoursAgo(49), status: 'identified', body: 'A queue backlog at our email provider was identified as the cause.' },
      { at: hoursAgo(47), status: 'resolved', body: 'The backlog has cleared and email delivery times are back to normal.' },
    ];
    db.prepare('INSERT INTO status_incidents (id, title, impact, status, createdAt, resolvedAt, updates) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('si_seed', 'Elevated email delivery latency', 'minor', 'resolved', hoursAgo(50), hoursAgo(47), JSON.stringify(incidentUpdates));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
