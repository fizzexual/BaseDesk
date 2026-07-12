import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-ch-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

it('bootstrap carries seeded channels and tickets have channelId', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect(boot.channels.length).toBeGreaterThan(0);
  expect(boot.tickets.some((t: { channelId: string | null }) => t.channelId !== null)).toBe(true);
});

it('inbound webhook creates a ticket and upserts the contact', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat');
  const res = await app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, json('POST', {
    from: { name: 'New Visitor', email: 'visitor@example.com' }, body: 'Hi, I have a question about pricing',
  }));
  expect(res.status).toBe(200);
  const { ticketId } = await res.json();
  const ticket = await (await app.request('/api/tickets?view=all')).json();
  expect(ticket.some((t: { id: string; channelId: string }) => t.id === ticketId && t.channelId === ch.id)).toBe(true);
});

it('rejects inbound with a bad token', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const ch = boot.channels[0];
  const res = await app.request(`/api/channels/${ch.id}/inbound?token=wrong`, json('POST', {
    from: { email: 'x@example.com' }, body: 'hello',
  }));
  expect(res.status).toBe(401);
});

it('serves the widget thread for a contact', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat');
  await app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, json('POST', {
    from: { email: 'threaduser@example.com' }, body: 'first message',
  }));
  const thread = await (await app.request(`/api/channels/${ch.id}/thread?token=${ch.inboundToken}&contact=threaduser@example.com`)).json();
  expect(Array.isArray(thread)).toBe(true);
  expect(thread.length).toBeGreaterThanOrEqual(1);
});

it('creates, patches, and deletes a channel', async () => {
  const app = makeApp();
  const created = await (await app.request('/api/channels', json('POST', { type: 'discord', name: 'Community' }))).json();
  expect(created.inboundToken).toMatch(/^tok_/);
  const patched = await (await app.request(`/api/channels/${created.id}`, json('PATCH', { enabled: false }))).json();
  expect(patched.enabled).toBe(false);
  expect((await app.request(`/api/channels/${created.id}`, { method: 'DELETE' })).status).toBe(200);
});
