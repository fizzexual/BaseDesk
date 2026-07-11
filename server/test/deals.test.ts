import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-deals-'))).app;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

it('bootstrap includes seeded deals and contacts carry mrr', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect(Array.isArray(boot.deals)).toBe(true);
  expect(boot.deals.length).toBeGreaterThan(0);
  expect(boot.contacts.some((c: { mrr: number | null }) => typeof c.mrr === 'number')).toBe(true);
});

it('creates a deal with defaults', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const res = await app.request('/api/deals', json({ title: 'Test', type: 'expansion', value: 50000, contactId: boot.contacts[0].id }));
  expect(res.status).toBe(200);
  const deal = await res.json();
  expect(deal.stage).toBe('open');
  expect(deal.closedAt).toBeNull();
  expect(deal.currency).toBe('USD');
  expect(deal.ownerId).toBe(boot.currentAgentId);
});

it('won sets closedAt; reopening clears it', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const created = await (await app.request('/api/deals', json({ title: 'T', type: 'inbound', value: 1000, contactId: boot.contacts[0].id }))).json();
  const won = await (await app.request(`/api/deals/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'won' }) })).json();
  expect(won.closedAt).not.toBeNull();
  const reopened = await (await app.request(`/api/deals/${created.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'open' }) })).json();
  expect(reopened.closedAt).toBeNull();
});

it('rejects unknown contact and negative value', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect((await app.request('/api/deals', json({ title: 'X', type: 'inbound', value: 100, contactId: 'nope' }))).status).toBe(400);
  expect((await app.request('/api/deals', json({ title: 'X', type: 'inbound', value: -1, contactId: boot.contacts[0].id }))).status).toBe(400);
  expect((await app.request('/api/deals', json({ title: 'X', type: 'bogus', value: 100, contactId: boot.contacts[0].id }))).status).toBe(400);
});

it('deletes a deal', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const d = await (await app.request('/api/deals', json({ title: 'Z', type: 'inbound', value: 1000, contactId: boot.contacts[0].id }))).json();
  expect((await app.request(`/api/deals/${d.id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await app.request(`/api/deals/${d.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'won' }) })).status).toBe(404);
});

it('filters deals by stage', async () => {
  const app = makeApp();
  const open = await (await app.request('/api/deals?stage=open')).json();
  expect(open.every((d: { stage: string }) => d.stage === 'open')).toBe(true);
});

it('rejects invalid ticket patch values', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const id = boot.tickets[0].id;
  const patch = (b: unknown) =>
    app.request(`/api/tickets/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  expect((await patch({ status: 'bogus' })).status).toBe(400);
  expect((await patch({ priority: 'critical' })).status).toBe(400);
  expect((await patch({ bucket: 'void' })).status).toBe(400);
  expect((await patch({ subject: '   ' })).status).toBe(400);
  expect((await patch({ status: 'solved' })).status).toBe(200);
});

it('revenue stats present and coherent', async () => {
  const app = makeApp();
  const stats = await (await app.request('/api/stats')).json();
  expect(stats.revenue).toBeDefined();
  expect(stats.revenue.winRate).toBeGreaterThanOrEqual(0);
  expect(stats.revenue.winRate).toBeLessThanOrEqual(1);
  expect(stats.revenue.wonByType).toHaveProperty('expansion');
  expect(stats.revenue.wonLast14Days).toHaveLength(14);
  expect(stats.revenue.openPipeline).toBeGreaterThanOrEqual(0);
});
