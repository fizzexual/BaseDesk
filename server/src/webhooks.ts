// Outgoing event webhooks: BaseDesk POSTs a signed JSON body to an admin's URL when a
// ticket is created, changes status, changes assignee, or gets a public reply.
//
// Events are captured by SQLite triggers, not by the route handlers. Tickets and replies
// are written from more than a dozen places (agents, the portal, the widget, inbound
// email and webhooks, the bot, automation, imports, merge and split), and a trigger sees
// every one of them, including ones added later. The triggers only fire while at least
// one webhook is enabled, so a desk without webhooks never fills the outbox.
//
// Flow: trigger -> webhook_outbox -> fan-out (one delivery per subscribed webhook, with a
// snapshot of the ticket) -> deliverer (HMAC-signed POST, 5 s timeout, retries with
// backoff, then "failed"). Receivers should dedupe on X-BaseDesk-Delivery: a delivery
// whose response was lost is sent again.

import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { assertOutboundUrl, BlockedUrlError } from './net-guard.js';

export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.status_changed', 'ticket.assignee_changed', 'message.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const isWebhookEvent = (v: unknown): v is WebhookEvent => typeof v === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(v);

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent | 'ping';
  status: DeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
}
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
  lastDelivery: WebhookDelivery | null;
  /** Deliveries that gave up (all retries used) in the last 14 days. */
  failed: number;
}

/** Seconds to wait after the 1st, 2nd, ... failed attempt. Six attempts over about 7.5 hours. */
export const RETRY_BACKOFF_S = [30, 120, 600, 3600, 21_600];
export const MAX_ATTEMPTS = RETRY_BACKOFF_S.length + 1;
const KEEP_DAYS = 14;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ANY_ENABLED = 'EXISTS (SELECT 1 FROM webhooks WHERE enabled = 1)';

export function installWebhookSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      ticketId TEXT NOT NULL,
      messageId TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhookId TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastStatus INTEGER,
      lastError TEXT,
      nextAttemptAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      deliveredAt TEXT
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (status, nextAttemptAt);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_hook ON webhook_deliveries (webhookId, createdAt);

    CREATE TRIGGER IF NOT EXISTS webhook_ticket_created AFTER INSERT ON tickets
    WHEN ${ANY_ENABLED}
    BEGIN
      INSERT INTO webhook_outbox (event, ticketId, at) VALUES ('ticket.created', NEW.id, ${NOW_SQL});
    END;
    CREATE TRIGGER IF NOT EXISTS webhook_ticket_status AFTER UPDATE OF status ON tickets
    WHEN NEW.status IS NOT OLD.status AND ${ANY_ENABLED}
    BEGIN
      INSERT INTO webhook_outbox (event, ticketId, detail, at)
      VALUES ('ticket.status_changed', NEW.id, json_object('from', OLD.status, 'to', NEW.status), ${NOW_SQL});
    END;
    CREATE TRIGGER IF NOT EXISTS webhook_ticket_assignee AFTER UPDATE OF assigneeId ON tickets
    WHEN NEW.assigneeId IS NOT OLD.assigneeId AND ${ANY_ENABLED}
    BEGIN
      INSERT INTO webhook_outbox (event, ticketId, detail, at)
      VALUES ('ticket.assignee_changed', NEW.id, json_object('from', OLD.assigneeId, 'to', NEW.assigneeId), ${NOW_SQL});
    END;
    CREATE TRIGGER IF NOT EXISTS webhook_message_created AFTER INSERT ON messages
    WHEN NEW.kind = 'reply' AND ${ANY_ENABLED}
    BEGIN
      INSERT INTO webhook_outbox (event, ticketId, messageId, at) VALUES ('message.created', NEW.ticketId, NEW.id, ${NOW_SQL});
    END;
  `);
}

const newSecret = (): string => `whsec_${randomBytes(24).toString('base64url')}`;
const newId = (prefix: string): string => `${prefix}${randomBytes(9).toString('base64url')}`;

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

interface HookRow { id: string; url: string; secret: string; events: string; enabled: number; createdAt: string }
interface DeliveryRow extends Omit<WebhookDelivery, 'event'> { event: string; payload: string }

const toDelivery = (r: DeliveryRow): WebhookDelivery => ({
  id: r.id,
  webhookId: r.webhookId,
  event: r.event as WebhookDelivery['event'],
  status: r.status,
  attempts: r.attempts,
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  nextAttemptAt: r.nextAttemptAt,
  createdAt: r.createdAt,
  deliveredAt: r.deliveredAt,
});

const parseEvents = (raw: string): WebhookEvent[] => {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isWebhookEvent) : [];
  } catch {
    return [];
  }
};

export function getWebhook(db: DatabaseSync, id: string): Webhook | null {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as HookRow | undefined;
  if (row === undefined) return null;
  const last = db.prepare('SELECT * FROM webhook_deliveries WHERE webhookId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1').get(id) as DeliveryRow | undefined;
  const failed = db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE webhookId = ? AND status = 'failed'").get(id) as { n: number };
  return {
    id: row.id,
    url: row.url,
    events: parseEvents(row.events),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    lastDelivery: last === undefined ? null : toDelivery(last),
    failed: failed.n,
  };
}

export function listWebhooks(db: DatabaseSync): Webhook[] {
  const ids = db.prepare('SELECT id FROM webhooks ORDER BY createdAt, rowid').all() as { id: string }[];
  return ids.map(({ id }) => getWebhook(db, id)).filter((w): w is Webhook => w !== null);
}

export function listDeliveries(db: DatabaseSync, webhookId: string, limit = 25): WebhookDelivery[] {
  const rows = db.prepare('SELECT * FROM webhook_deliveries WHERE webhookId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?').all(webhookId, limit) as unknown as DeliveryRow[];
  return rows.map(toDelivery);
}

/** Validates a webhook URL the way it will be checked at send time. Returns an error message or null. */
export async function webhookUrlProblem(url: unknown): Promise<string | null> {
  if (typeof url !== 'string' || url.trim() === '') return 'A URL is required.';
  if (url.length > 2000) return 'That URL is too long.';
  try {
    await assertOutboundUrl(url.trim());
    return null;
  } catch (err) {
    return err instanceof BlockedUrlError ? err.message : 'That URL cannot be used.';
  }
}

export function normalizeEvents(raw: unknown): WebhookEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const events = WEBHOOK_EVENTS.filter((e) => raw.includes(e));
  return events.length === 0 ? null : events;
}

export function createWebhook(db: DatabaseSync, url: string, events: WebhookEvent[], now: string): { webhook: Webhook; secret: string } {
  const id = newId('wh_');
  const secret = newSecret();
  db.prepare('INSERT INTO webhooks (id, url, secret, events, enabled, createdAt) VALUES (?, ?, ?, ?, 1, ?)').run(id, url.trim(), secret, JSON.stringify(events), now);
  return { webhook: getWebhook(db, id) as Webhook, secret };
}

export function updateWebhook(
  db: DatabaseSync,
  id: string,
  patch: { url?: string; events?: WebhookEvent[]; enabled?: boolean; rotateSecret?: boolean },
): { webhook: Webhook; secret?: string } | null {
  if (getWebhook(db, id) === null) return null;
  if (patch.url !== undefined) db.prepare('UPDATE webhooks SET url = ? WHERE id = ?').run(patch.url.trim(), id);
  if (patch.events !== undefined) db.prepare('UPDATE webhooks SET events = ? WHERE id = ?').run(JSON.stringify(patch.events), id);
  if (patch.enabled !== undefined) db.prepare('UPDATE webhooks SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  let secret: string | undefined;
  if (patch.rotateSecret === true) {
    secret = newSecret();
    db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run(secret, id);
  }
  return { webhook: getWebhook(db, id) as Webhook, ...(secret !== undefined ? { secret } : {}) };
}

export function deleteWebhook(db: DatabaseSync, id: string): boolean {
  const res = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  db.prepare('DELETE FROM webhook_deliveries WHERE webhookId = ?').run(id);
  return Number(res.changes) > 0;
}

// --- payloads -----------------------------------------------------------------------

interface OutboxRow { seq: number; event: string; ticketId: string; messageId: string | null; detail: string; at: string }

function ticketSnapshot(db: DatabaseSync, ticketId: string): Record<string, unknown> | null {
  const t = db.prepare(
    'SELECT id, number, subject, status, priority, bucket, channel, category, assigneeId, requesterId, tags, createdAt, updatedAt FROM tickets WHERE id = ?',
  ).get(ticketId) as Record<string, unknown> | undefined;
  if (t === undefined) return null;
  const requester = db.prepare('SELECT id, name, email FROM contacts WHERE id = ?').get(t.requesterId as string) as Record<string, unknown> | undefined;
  let tags: unknown = [];
  try {
    tags = JSON.parse(String(t.tags));
  } catch {
    /* keep [] */
  }
  const { requesterId: _r, tags: _t, ...rest } = t;
  return { ...rest, tags, requester: requester ?? null };
}

function buildPayload(db: DatabaseSync, row: OutboxRow): Record<string, unknown> | null {
  const ticket = ticketSnapshot(db, row.ticketId);
  if (ticket === null) return null;
  const payload: Record<string, unknown> = { id: `evt_${row.seq}_${randomBytes(4).toString('hex')}`, event: row.event, occurredAt: row.at, ticket };
  if (row.event === 'ticket.status_changed' || row.event === 'ticket.assignee_changed') {
    try {
      payload.change = JSON.parse(row.detail);
    } catch {
      payload.change = null;
    }
  }
  if (row.messageId !== null) {
    const m = db.prepare('SELECT id, authorKind, authorId, body, at FROM messages WHERE id = ?').get(row.messageId) as Record<string, unknown> | undefined;
    if (m === undefined) return null;
    payload.message = m;
  }
  return payload;
}

/** Turns captured events into one pending delivery per subscribed, enabled webhook. */
export function fanOut(db: DatabaseSync, nowIso: string, batch = 500): number {
  const rows = db.prepare('SELECT * FROM webhook_outbox ORDER BY seq LIMIT ?').all(batch) as unknown as OutboxRow[];
  if (rows.length === 0) return 0;
  const hooks = (db.prepare('SELECT id, events FROM webhooks WHERE enabled = 1').all() as { id: string; events: string }[]).map((h) => ({
    id: h.id,
    events: parseEvents(h.events),
  }));
  const insert = db.prepare(
    "INSERT INTO webhook_deliveries (id, webhookId, event, payload, status, attempts, nextAttemptAt, createdAt) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
  );
  let created = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const subscribers = hooks.filter((h) => (h.events as string[]).includes(row.event));
      const payload = subscribers.length > 0 ? buildPayload(db, row) : null;
      if (payload !== null) {
        const body = JSON.stringify(payload);
        for (const h of subscribers) {
          insert.run(newId('whd_'), h.id, row.event, body, nowIso, nowIso);
          created++;
        }
      }
      db.prepare('DELETE FROM webhook_outbox WHERE seq = ?').run(row.seq);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return created;
}

export function queuePing(db: DatabaseSync, webhookId: string, nowIso: string): string {
  const id = newId('whd_');
  const body = JSON.stringify({ id: `evt_ping_${randomBytes(4).toString('hex')}`, event: 'ping', occurredAt: nowIso, webhookId });
  // A ping is a one-shot check from the settings screen: it is never retried.
  db.prepare(
    "INSERT INTO webhook_deliveries (id, webhookId, event, payload, status, attempts, nextAttemptAt, createdAt) VALUES (?, ?, 'ping', ?, 'pending', ?, ?, ?)",
  ).run(id, webhookId, body, MAX_ATTEMPTS - 1, nowIso, nowIso);
  return id;
}

export function retryDelivery(db: DatabaseSync, id: string, nowIso: string): boolean {
  const res = db.prepare(
    "UPDATE webhook_deliveries SET status = 'pending', nextAttemptAt = ?, attempts = MIN(attempts, ?) WHERE id = ? AND status = 'failed'",
  ).run(nowIso, MAX_ATTEMPTS - 1, id);
  return Number(res.changes) > 0;
}

export function getDelivery(db: DatabaseSync, id: string): WebhookDelivery | null {
  const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as DeliveryRow | undefined;
  return row === undefined ? null : toDelivery(row);
}

// --- delivery -----------------------------------------------------------------------

export interface DeliverOptions {
  timeoutMs?: number;
  limit?: number;
  /** Only this delivery (the settings screen's "Send test"). */
  onlyId?: string;
}

async function attempt(url: string, secret: string, d: DeliveryRow, timeoutMs: number): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    await assertOutboundUrl(url);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'BaseDesk-Webhooks/1',
        'x-basedesk-event': d.event,
        'x-basedesk-delivery': d.id,
        'x-basedesk-signature': signBody(secret, d.payload),
      },
      body: d.payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
    const redirect = res.status >= 300 && res.status < 400 ? ' (redirects are not followed)' : '';
    return { ok: false, status: res.status, error: `HTTP ${res.status}${redirect}` };
  } catch (err) {
    if (err instanceof BlockedUrlError) return { ok: false, status: null, error: err.message };
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, status: null, error: `no answer within ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`}` };
    return { ok: false, status: null, error: 'could not connect' };
  }
}

/** Sends every delivery that is due. Returns how many were attempted. */
export async function deliverDue(db: DatabaseSync, nowMs: number, opts: DeliverOptions = {}): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  fanOut(db, nowIso);
  const rows = (
    opts.onlyId !== undefined
      ? db.prepare("SELECT * FROM webhook_deliveries WHERE id = ? AND status = 'pending'").all(opts.onlyId)
      : db.prepare("SELECT * FROM webhook_deliveries WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY nextAttemptAt LIMIT ?").all(nowIso, opts.limit ?? 20)
  ) as unknown as DeliveryRow[];
  const timeoutMs = opts.timeoutMs ?? 5000;
  for (const d of rows) {
    const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(d.webhookId) as HookRow | undefined;
    if (hook === undefined) {
      db.prepare('DELETE FROM webhook_deliveries WHERE id = ?').run(d.id);
      continue;
    }
    const r = await attempt(hook.url, hook.secret, d, timeoutMs);
    const attempts = d.attempts + 1;
    const doneAt = new Date().toISOString();
    if (r.ok) {
      db.prepare("UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, lastStatus = ?, lastError = NULL, deliveredAt = ? WHERE id = ?").run(
        attempts, r.status, doneAt, d.id,
      );
    } else if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE webhook_deliveries SET status = 'failed', attempts = ?, lastStatus = ?, lastError = ? WHERE id = ?").run(attempts, r.status, r.error, d.id);
    } else {
      const next = new Date(nowMs + RETRY_BACKOFF_S[attempts - 1] * 1000).toISOString();
      db.prepare('UPDATE webhook_deliveries SET attempts = ?, lastStatus = ?, lastError = ?, nextAttemptAt = ? WHERE id = ?').run(
        attempts, r.status, r.error, next, d.id,
      );
    }
  }
  const cutoff = new Date(nowMs - KEEP_DAYS * 86_400_000).toISOString();
  db.prepare("DELETE FROM webhook_deliveries WHERE status != 'pending' AND createdAt < ?").run(cutoff);
  return rows.length;
}
