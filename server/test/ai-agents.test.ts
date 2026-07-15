import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-ai-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

it('bootstrap carries AI agents and seeded actions', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect(boot.aiAgents.length).toBeGreaterThan(0);
  expect(boot.aiActions.some((a: { kind: string; status: string }) => a.kind === 'draft' && a.status === 'pending')).toBe(true);
});

it('a resolve agent auto-resolves a ticket that matches a KB article', async () => {
  const app = makeApp();
  // Auto-run + auto-send are opt-in now — turn them on for this behavior.
  await app.request('/api/settings/ai-automation', json('PUT', { autoSuggest: true, autoResolve: true, autoTriage: false }));
  const boot = await (await app.request('/api/bootstrap')).json();
  const apiArticle = boot.kb.find((a: { category: string }) => a.category === 'API');
  const res = await app.request('/api/tickets', json('POST', {
    subject: apiArticle.title, body: apiArticle.body, requesterId: boot.contacts[0].id, priority: 'medium',
  }));
  const { ticket } = await res.json();
  expect(ticket.status).toBe('solved');
});

it('approves a pending draft action (sends a reply)', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const draft = boot.aiActions.find((a: { kind: string; status: string }) => a.kind === 'draft' && a.status === 'pending');
  const before = (await (await app.request(`/api/tickets/${draft.ticketId}/messages`)).json()).length;
  const res = await app.request(`/api/ai/actions/${draft.id}/approve`, { method: 'POST' });
  expect(res.status).toBe(200);
  const { action } = await res.json();
  expect(action.status).toBe('approved');
  const after = (await (await app.request(`/api/tickets/${draft.ticketId}/messages`)).json()).length;
  expect(after).toBe(before + 1);
});

it('dismisses a pending draft action', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  const draft = boot.aiActions.find((a: { kind: string; status: string }) => a.kind === 'draft' && a.status === 'pending');
  const res = await app.request(`/api/ai/actions/${draft.id}/dismiss`, { method: 'POST' });
  const { action } = await res.json();
  expect(action.status).toBe('dismissed');
});

it('creates, patches, and deletes an agent', async () => {
  const app = makeApp();
  const created = await (await app.request('/api/ai/agents', json('POST', { name: 'Test Bot', autonomy: 'draft' }))).json();
  expect(created.autonomy).toBe('draft');
  expect(created.enabled).toBe(true);
  const patched = await (await app.request(`/api/ai/agents/${created.id}`, json('PATCH', { enabled: false, autonomy: 'suggest' }))).json();
  expect(patched.enabled).toBe(false);
  expect(patched.autonomy).toBe('suggest');
  expect((await app.request(`/api/ai/agents/${created.id}`, { method: 'DELETE' })).status).toBe(200);
});

it('run endpoint returns a created count', async () => {
  const app = makeApp();
  const res = await app.request('/api/ai/run', { method: 'POST' });
  expect(res.status).toBe(200);
  expect(typeof (await res.json()).created).toBe('number');
});
