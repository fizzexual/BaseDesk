import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { getContact, getMessages, getTicket, openDb, rowToTicket, type TicketRow } from './db.js';
import { seedIfEmpty } from './seed-load.js';
import { computeStats } from './stats.js';
import type {
  Agent, BootstrapData, CannedReply, Contact, Message, Ticket, TicketPatch, TicketPriority, ViewId,
} from './types.js';

const VERSION = '0.1.0';

const VIEW_IDS: ViewId[] = [
  'all', 'unassigned', 'mine', 'snoozed',
  'open', 'pending', 'on_hold', 'solved', 'closed',
  'archive', 'spam', 'trash',
];
const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
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

  const currentAgentId = (): string => {
    const row = db.prepare("SELECT id FROM agents WHERE role = 'admin' ORDER BY rowid LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new Error('no admin agent found');
    return row.id;
  };

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/api/bootstrap', (c) => {
    const tickets = (db.prepare('SELECT * FROM tickets ORDER BY lastMessageAt DESC').all() as unknown as TicketRow[])
      .map(rowToTicket);
    const contacts = db.prepare('SELECT * FROM contacts ORDER BY rowid').all() as unknown as Contact[];
    const agents = db.prepare('SELECT * FROM agents ORDER BY rowid').all() as unknown as Agent[];
    const canned = db.prepare('SELECT * FROM canned_replies ORDER BY rowid').all() as unknown as CannedReply[];
    const data: BootstrapData = { tickets, contacts, agents, canned, currentAgentId: currentAgentId() };
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
    const ticket: Ticket = {
      id: newId('t_'),
      number: maxRow.maxNumber + 1,
      subject: subject.trim(),
      status: 'open',
      priority: priority as TicketPriority,
      bucket: 'inbox',
      requesterId,
      assigneeId: null,
      tags: [],
      channel: 'web',
      createdAt: now,
      updatedAt: now,
      snoozedUntil: null,
      lastMessageAt: now,
      lastMessagePreview: preview(body),
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
      db.prepare(
        `INSERT INTO tickets (
          id, number, subject, status, priority, bucket, requesterId, assigneeId,
          tags, channel, createdAt, updatedAt, snoozedUntil, lastMessageAt, lastMessagePreview
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        ticket.id, ticket.number, ticket.subject, ticket.status, ticket.priority, ticket.bucket,
        ticket.requesterId, ticket.assigneeId, JSON.stringify(ticket.tags), ticket.channel,
        ticket.createdAt, ticket.updatedAt, ticket.snoozedUntil, ticket.lastMessageAt, ticket.lastMessagePreview,
      );
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ ticket, message });
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

    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const key of PATCH_KEYS) {
      if (!(key in patch)) continue;
      const value = patch[key];
      sets.push(`${key} = ?`);
      params.push(key === 'tags' ? JSON.stringify(value ?? []) : (value as string | null));
    }
    const now = new Date().toISOString();
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

    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO messages (id, ticketId, authorKind, authorId, kind, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(message.id, message.ticketId, message.authorKind, message.authorId, message.kind, message.body, message.at);
      db.prepare(
        'UPDATE tickets SET status = ?, updatedAt = ?, lastMessageAt = ?, lastMessagePreview = ? WHERE id = ?',
      ).run(nextStatus, now, now, nextPreview, id);
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
    };
    db.prepare(
      'INSERT INTO contacts (id, name, email, company, avatarHue, location, timezone, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(contact.id, contact.name, contact.email, contact.company, contact.avatarHue, contact.location, contact.timezone, contact.createdAt);
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
