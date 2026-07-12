import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-kb-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

it('bootstrap and /api/kb return seeded articles', async () => {
  const app = makeApp();
  const boot = await (await app.request('/api/bootstrap')).json();
  expect(boot.kb.length).toBeGreaterThan(0);
  const list = await (await app.request('/api/kb')).json();
  expect(list.length).toBe(boot.kb.length);
});

it('creates an article with a slug and draft default', async () => {
  const app = makeApp();
  const res = await app.request('/api/kb', json('POST', { title: 'How to Reset Your Password', category: 'Account', body: 'Steps...' }));
  expect(res.status).toBe(200);
  const a = await res.json();
  expect(a.slug).toBe('how-to-reset-your-password');
  expect(a.status).toBe('draft');
});

it('updates title (re-slugs) and publishes', async () => {
  const app = makeApp();
  const a = await (await app.request('/api/kb', json('POST', { title: 'Draft', category: 'X', body: 'b' }))).json();
  const up = await (await app.request(`/api/kb/${a.id}`, json('PATCH', { title: 'Now Published', status: 'published' }))).json();
  expect(up.slug).toBe('now-published');
  expect(up.status).toBe('published');
});

it('rejects an empty title and 404s unknown ids', async () => {
  const app = makeApp();
  expect((await app.request('/api/kb', json('POST', { title: '  ', category: 'X', body: 'b' }))).status).toBe(400);
  expect((await app.request('/api/kb/nope', json('PATCH', { body: 'x' }))).status).toBe(404);
  expect((await app.request('/api/kb/nope', { method: 'DELETE' })).status).toBe(404);
});

it('deletes an article', async () => {
  const app = makeApp();
  const a = await (await app.request('/api/kb', json('POST', { title: 'Temp', category: 'X', body: 'b' }))).json();
  expect((await app.request(`/api/kb/${a.id}`, { method: 'DELETE' })).status).toBe(200);
  expect((await app.request(`/api/kb/${a.id}`, json('PATCH', { body: 'x' }))).status).toBe(404);
});
