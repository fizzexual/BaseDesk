import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getTicket } from '../src/db.js';
import { normalizeBusinessHours } from '../src/business-hours.js';

// Correctness findings #4 and #5: a customer reply reopened tickets into places no agent
// looks, and a mistyped business-hours zone 500'd the next inbound ticket.

const req = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

async function customerWithTicket() {
  const { app, db } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-reopen-')));
  const reg = await (await app.request('/api/portal/register', req('POST', { name: 'Cara', email: 'cara@example.com', password: 'password123' }))).json();
  const created = await (await app.request('/api/portal/tickets', req('POST', { subject: 'Help', body: 'it broke' }, reg.token))).json();
  const reply = (id: string) => app.request(`/api/portal/tickets/${id}/messages`, req('POST', { body: 'still broken' }, reg.token));
  return { app, db, token: reg.token as string, ticketId: created.ticket.id as string, reply };
}

describe('a customer reply lands where agents look', () => {
  it('brings an archived, solved ticket back to the inbox as open', async () => {
    const { app, db, ticketId, reply } = await customerWithTicket();
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { status: 'solved', bucket: 'archive' }));
    expect((await reply(ticketId)).status).toBe(200);
    expect(getTicket(db, ticketId)).toMatchObject({ status: 'open', bucket: 'inbox' });
  });

  it('wakes a snoozed ticket', async () => {
    const { app, db, ticketId, reply } = await customerWithTicket();
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { snoozedUntil: '2099-01-01T00:00:00.000Z' }));
    await reply(ticketId);
    expect(getTicket(db, ticketId)?.snoozedUntil).toBeNull();
  });

  it('leaves spam where it is', async () => {
    const { app, db, ticketId, reply } = await customerWithTicket();
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { bucket: 'spam' }));
    await reply(ticketId);
    expect(getTicket(db, ticketId)?.bucket).toBe('spam');
  });

  it('a reply on a merged ticket goes to the ticket it was merged into', async () => {
    const { app, db, token, ticketId, reply } = await customerWithTicket();
    const second = await (await app.request('/api/portal/tickets', req('POST', { subject: 'Again', body: 'same issue' }, token))).json();
    const merged = await app.request(`/api/tickets/${ticketId}/merge`, req('POST', { into: second.ticket.id }));
    expect(merged.status).toBe(200);
    expect((await reply(ticketId)).status).toBe(200);
    expect(getTicket(db, ticketId)?.status).not.toBe('open'); // the tombstone stays shut
    const msgs = await (await app.request(`/api/tickets/${second.ticket.id}/messages`)).json();
    expect(msgs.some((m: { body: string }) => m.body === 'still broken')).toBe(true);
  });
});

describe('business-hours time zone', () => {
  const fallback = { enabled: false, timezone: 'UTC', message: 'm', days: Array(7).fill(null) };
  it('keeps a valid zone (trimmed) and refuses an unknown one', () => {
    expect(normalizeBusinessHours({ timezone: 'Europe/Sofia ' }, fallback).timezone).toBe('Europe/Sofia');
    expect(normalizeBusinessHours({ timezone: 'Mars/Olympus' }, fallback).timezone).toBe('UTC');
  });

  it('a bad zone no longer 500s the next portal ticket', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-bh-')));
    await app.request('/api/settings/business-hours', req('PUT', { enabled: true, timezone: 'Not/AZone', days: Array(7).fill(null) }));
    const reg = await (await app.request('/api/portal/register', req('POST', { name: 'D', email: 'd@example.com', password: 'password123' }))).json();
    expect((await app.request('/api/portal/tickets', req('POST', { subject: 's', body: 'b' }, reg.token))).status).toBe(200);
  });
});
