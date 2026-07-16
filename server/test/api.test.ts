import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import type { Agent, CannedReply, Contact, Message, StatsOverview, Ticket } from '../src/types.js';

interface Bootstrap {
  tickets: Ticket[];
  contacts: Contact[];
  agents: Agent[];
  canned: CannedReply[];
  currentAgentId: string;
}

const dir = mkdtempSync(path.join(tmpdir(), 'basedesk-test-'));
const { app, db } = createApp(dir);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function getBootstrap(): Promise<Bootstrap> {
  const res = await app.request('/api/bootstrap');
  expect(res.status).toBe(200);
  return (await res.json()) as Bootstrap;
}

function notSnoozed(t: Ticket, now: string): boolean {
  return t.snoozedUntil === null || t.snoozedUntil <= now;
}
function isAll(t: Ticket, now: string): boolean {
  return t.bucket === 'inbox' && notSnoozed(t, now) && t.status !== 'closed';
}

describe('health', () => {
  it('reports ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });
});

describe('bootstrap', () => {
  it('returns full dataset with currentAgentId = first admin agent', async () => {
    const body = await getBootstrap();
    expect(body.tickets.length).toBeGreaterThan(100);
    expect(body.contacts.length).toBeGreaterThan(10);
    expect(body.agents).toHaveLength(4);
    expect(body.canned.length).toBeGreaterThanOrEqual(6);
    const firstAdmin = body.agents.find((a) => a.role === 'admin');
    expect(firstAdmin).toBeDefined();
    expect(body.currentAgentId).toBe(firstAdmin!.id);

    const t = body.tickets[0]!;
    expect(typeof t.id).toBe('string');
    expect(typeof t.number).toBe('number');
    expect(Array.isArray(t.tags)).toBe(true);
    expect(typeof t.lastMessagePreview).toBe('string');
  });
});

describe('ticket views', () => {
  it('view=all excludes snoozed, closed and non-inbox tickets', async () => {
    const boot = await getBootstrap();
    const now = new Date().toISOString();
    const res = await app.request('/api/tickets?view=all');
    expect(res.status).toBe(200);
    const tickets = (await res.json()) as Ticket[];
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.bucket).toBe('inbox');
      expect(t.status).not.toBe('closed');
      expect(notSnoozed(t, now)).toBe(true);
    }
    const expected = boot.tickets.filter((t) => isAll(t, now));
    expect(tickets.length).toBe(expected.length);
  });

  it('view=mine returns inbox open/pending/on_hold tickets assigned to the current agent', async () => {
    const boot = await getBootstrap();
    const now = new Date().toISOString();
    const res = await app.request('/api/tickets?view=mine');
    expect(res.status).toBe(200);
    const tickets = (await res.json()) as Ticket[];
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.assigneeId).toBe(boot.currentAgentId);
      expect(['open', 'pending', 'on_hold']).toContain(t.status);
      expect(isAll(t, now)).toBe(true);
    }
    const expected = boot.tickets.filter(
      (t) =>
        isAll(t, now) &&
        t.assigneeId === boot.currentAgentId &&
        ['open', 'pending', 'on_hold'].includes(t.status),
    );
    expect(tickets.length).toBe(expected.length);
  });

  it('view=snoozed returns only inbox tickets snoozed into the future', async () => {
    const now = new Date().toISOString();
    const res = await app.request('/api/tickets?view=snoozed');
    expect(res.status).toBe(200);
    const tickets = (await res.json()) as Ticket[];
    for (const t of tickets) {
      expect(t.bucket).toBe('inbox');
      expect(t.snoozedUntil !== null && t.snoozedUntil > now).toBe(true);
    }
  });
});

describe('messages', () => {
  it('lists messages for a ticket ordered by at ascending', async () => {
    const boot = await getBootstrap();
    const ticket = boot.tickets[0]!;
    const res = await app.request(`/api/tickets/${ticket.id}/messages`);
    expect(res.status).toBe(200);
    const messages = (await res.json()) as Message[];
    expect(messages.length).toBeGreaterThan(0);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i]!.at >= messages[i - 1]!.at).toBe(true);
    }
    for (const m of messages) expect(m.ticketId).toBe(ticket.id);
  });

  it('reply flips open ticket to pending and updates preview and timestamps', async () => {
    const boot = await getBootstrap();
    const now = new Date().toISOString();
    const open = boot.tickets.find((t) => t.status === 'open' && isAll(t, now));
    expect(open).toBeDefined();
    const body = '  Thanks   for the   details.\nWe have shipped a replacement and it should arrive within three business days. Tracking follows shortly.';
    const res = await app.request(`/api/tickets/${open!.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'reply', body }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { message: Message; ticket: Ticket };
    expect(out.ticket.status).toBe('pending');
    expect(out.message.authorKind).toBe('agent');
    expect(out.message.authorId).toBe(boot.currentAgentId);
    expect(out.message.kind).toBe('reply');
    const expectedPreview = body.replace(/\s+/g, ' ').trim().slice(0, 90);
    expect(out.ticket.lastMessagePreview).toBe(expectedPreview);
    expect(out.ticket.lastMessageAt).toBe(out.message.at);
    expect(out.ticket.updatedAt).toBe(out.message.at);
    expect(out.ticket.updatedAt >= open!.updatedAt).toBe(true);

    const listRes = await app.request(`/api/tickets/${open!.id}/messages`);
    const messages = (await listRes.json()) as Message[];
    expect(messages[messages.length - 1]!.id).toBe(out.message.id);
  });

  it('note updates timestamps but does NOT change preview or status', async () => {
    const boot = await getBootstrap();
    const now = new Date().toISOString();
    const open = boot.tickets.find((t) => t.status === 'open' && isAll(t, now));
    expect(open).toBeDefined();
    const res = await app.request(`/api/tickets/${open!.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'note', body: 'Internal: waiting on warehouse confirmation before promising a date.' }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { message: Message; ticket: Ticket };
    expect(out.message.kind).toBe('note');
    expect(out.ticket.status).toBe('open');
    expect(out.ticket.lastMessagePreview).toBe(open!.lastMessagePreview);
    expect(out.ticket.lastMessageAt).toBe(out.message.at);
    expect(out.ticket.updatedAt).toBe(out.message.at);
  });
});

describe('ticket mutations', () => {
  it('creates a ticket with number = max+1, status open, bucket inbox, channel web', async () => {
    const boot = await getBootstrap();
    const maxNumber = Math.max(...boot.tickets.map((t) => t.number));
    const requesterId = boot.contacts[0]!.id;
    const res = await app.request('/api/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Cannot export my invoices',
        body: 'The export button on the billing page spins forever and never downloads anything.',
        requesterId,
        priority: 'high',
      }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ticket: Ticket; message: Message };
    expect(out.ticket.number).toBe(maxNumber + 1);
    expect(out.ticket.status).toBe('open');
    expect(out.ticket.bucket).toBe('inbox');
    expect(out.ticket.channel).toBe('web');
    expect(out.ticket.requesterId).toBe(requesterId);
    expect(out.ticket.priority).toBe('high');
    expect(out.ticket.id.startsWith('t_')).toBe(true);
    expect(out.message.ticketId).toBe(out.ticket.id);
    expect(out.message.authorKind).toBe('contact');
    expect(out.ticket.lastMessagePreview.startsWith('The export button')).toBe(true);
  });

  it('patches a ticket and bumps updatedAt', async () => {
    const boot = await getBootstrap();
    const target = boot.tickets.find((t) => t.status === 'pending' && t.bucket === 'inbox');
    expect(target).toBeDefined();
    const res = await app.request(`/api/tickets/${target!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'solved', tags: ['refund', 'billing'] }),
    });
    expect(res.status).toBe(200);
    const ticket = (await res.json()) as Ticket;
    expect(ticket.status).toBe('solved');
    expect(ticket.tags).toEqual(['refund', 'billing']);
    expect(ticket.updatedAt >= target!.updatedAt).toBe(true);
  });

  it('patch with an unknown id returns 404 with an error body', async () => {
    const res = await app.request('/api/tickets/t_nothere', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'solved' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

describe('contacts', () => {
  it('creates a contact with a deterministic avatarHue in [0, 360)', async () => {
    const res = await app.request('/api/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Dana Voss', email: 'dana.voss@example.test', company: 'Voss & Sons' }),
    });
    expect(res.status).toBe(200);
    const contact = (await res.json()) as Contact;
    expect(contact.id.startsWith('c_')).toBe(true);
    expect(contact.name).toBe('Dana Voss');
    expect(contact.company).toBe('Voss & Sons');
    expect(contact.avatarHue).toBeGreaterThanOrEqual(0);
    expect(contact.avatarHue).toBeLessThan(360);
    expect(Number.isInteger(contact.avatarHue)).toBe(true);
  });
});

describe('search', () => {
  it('finds a ticket by a substring of a message body', async () => {
    // Derive the query from a real message so the test survives seed changes.
    const boot = (await (await app.request('/api/bootstrap')).json()) as { tickets: { id: string }[] };
    const ticketId = boot.tickets[0]!.id;
    const messages = (await (await app.request(`/api/tickets/${ticketId}/messages`)).json()) as { body: string }[];
    const phrase = messages[0]!.body.split(/\s+/).slice(0, 6).join(' ');

    const res = await app.request(`/api/search?q=${encodeURIComponent(phrase)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticketIds: string[] };
    expect(body.ticketIds).toContain(ticketId);
    expect(body.ticketIds.length).toBeLessThanOrEqual(30);
  });

  it('returns no ids for an empty query', async () => {
    const res = await app.request('/api/search?q=');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticketIds: string[] };
    expect(body.ticketIds).toEqual([]);
  });
});

describe('stats', () => {
  it('has every StatsOverview key and openNow consistent with bootstrap counts', async () => {
    const boot = await getBootstrap();
    const now = new Date().toISOString();
    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const stats = (await res.json()) as StatsOverview;

    expect(stats.createdLast14Days).toHaveLength(14);
    expect(stats.solvedLast14Days).toHaveLength(14);
    for (const d of stats.createdLast14Days) {
      expect(typeof d.date).toBe('string');
      expect(typeof d.count).toBe('number');
    }
    expect(Object.keys(stats.byPriority).sort()).toEqual(['high', 'low', 'medium', 'urgent']);
    expect(Object.keys(stats.byStatus).sort()).toEqual(['closed', 'on_hold', 'open', 'pending', 'solved']);
    expect(Array.isArray(stats.perAgentOpen)).toBe(true);
    expect(typeof stats.medianFirstReplyMinutes).toBe('number');
    expect(typeof stats.medianResolutionHours).toBe('number');
    expect(stats.medianFirstReplyMinutes).toBeGreaterThan(0);
    expect(stats.medianResolutionHours).toBeGreaterThan(0);
    expect(typeof stats.createdLast7Days).toBe('number');
    expect(typeof stats.solvedLast7Days).toBe('number');

    const expectedOpen = boot.tickets.filter((t) => isAll(t, now) && t.status === 'open').length;
    expect(stats.openNow).toBe(expectedOpen);
  });
});

describe('canned replies', () => {
  it('supports create, update, delete roundtrip', async () => {
    const createRes = await app.request('/api/canned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Out of office', body: 'We are away until Monday and will reply then.' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as CannedReply;
    expect(created.id.startsWith('cr_')).toBe(true);
    expect(created.title).toBe('Out of office');

    const putRes = await app.request(`/api/canned/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Away notice', body: 'We are away until Monday and will reply then.' }),
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as CannedReply;
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Away notice');

    let boot = await getBootstrap();
    expect(boot.canned.find((c) => c.id === created.id)?.title).toBe('Away notice');

    const delRes = await app.request(`/api/canned/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    expect((await delRes.json()) as { ok: boolean }).toEqual({ ok: true });

    boot = await getBootstrap();
    expect(boot.canned.find((c) => c.id === created.id)).toBeUndefined();
  });
});

describe('seed-on-boot', () => {
  it('seeds only when the tickets table is empty', () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'basedesk-reseed-'));
    const first = createApp(dir2);
    const n1 = (first.db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n;
    first.db.close();
    const second = createApp(dir2);
    const n2 = (second.db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n;
    expect(n1).toBeGreaterThan(100); // the seed populated the fresh DB
    expect(n2).toBe(n1); // re-opening a non-empty DB does NOT re-seed
    second.db.close();
    rmSync(dir2, { recursive: true, force: true });
  });
});
