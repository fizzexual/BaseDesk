import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-sla-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

it('bootstrap carries SLA targets and automation rules', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect(boot.sla.urgent.firstResponseMins).toBe(30);
  expect(Array.isArray(boot.automation)).toBe(true);
  expect(boot.automation.length).toBeGreaterThan(0);
});

it('applies automation on ticket create (refund → tag)', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const res = await app.request('/api/tickets', json('POST', {
    subject: 'A question', body: 'I would like a refund please', requesterId: boot.contacts[0].id, priority: 'low',
  }));
  const { ticket } = await res.json();
  expect(ticket.tags).toContain('refund');
});

it('escalates outages via automation (subject down → urgent)', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const res = await app.request('/api/tickets', json('POST', {
    subject: 'The site is down', body: 'nothing loads', requesterId: boot.contacts[0].id, priority: 'medium',
  }));
  const { ticket } = await res.json();
  expect(ticket.priority).toBe('urgent');
});

it('stamps firstRespondedAt on the first agent reply', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const { ticket } = await (await app.request('/api/tickets', json('POST', {
    subject: 'Hi', body: 'hello', requesterId: boot.contacts[0].id, priority: 'medium',
  }))).json();
  expect(ticket.firstRespondedAt).toBeNull();
  const after = await (await app.request(`/api/tickets/${ticket.id}/messages`, json('POST', { kind: 'reply', body: 'on it' }))).json();
  expect(after.ticket.firstRespondedAt).not.toBeNull();
});

it('sets resolvedAt on solve and clears it on reopen', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const { ticket } = await (await app.request('/api/tickets', json('POST', {
    subject: 'Hi', body: 'hello', requesterId: boot.contacts[0].id, priority: 'medium',
  }))).json();
  const solved = await (await app.request(`/api/tickets/${ticket.id}`, json('PATCH', { status: 'solved' }))).json();
  expect(solved.resolvedAt).not.toBeNull();
  const reopened = await (await app.request(`/api/tickets/${ticket.id}`, json('PATCH', { status: 'open' }))).json();
  expect(reopened.resolvedAt).toBeNull();
});

it('saves and rejects SLA targets', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const good = { ...boot.sla, urgent: { firstResponseMins: 15, resolutionMins: 120 } };
  expect((await app.request('/api/settings/sla', json('PUT', good))).status).toBe(200);
  expect((await app.request('/api/settings/sla', json('PUT', { urgent: { firstResponseMins: -1, resolutionMins: 1 } }))).status).toBe(400);
});
