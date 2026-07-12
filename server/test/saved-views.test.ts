import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-sv-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('saved views', () => {
  it('creates a saved view, lists it in bootstrap, and deletes it', async () => {
    const app = makeApp();
    const sv = await (await app.request('/api/saved-views', json('POST', { name: 'Urgent unassigned', view: 'unassigned', priority: 'urgent', tag: 'billing' }))).json();
    expect(sv.id).toMatch(/^sv_/);
    expect(sv.priority).toBe('urgent');
    expect(sv.tag).toBe('billing');

    let boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.savedViews.map((v: { name: string }) => v.name)).toContain('Urgent unassigned');

    expect((await app.request(`/api/saved-views/${sv.id}`, { method: 'DELETE' })).status).toBe(200);
    boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.savedViews).toHaveLength(0);
  });

  it('requires a name and a view', async () => {
    const app = makeApp();
    expect((await app.request('/api/saved-views', json('POST', { view: 'all' }))).status).toBe(400);
    expect((await app.request('/api/saved-views', json('POST', { name: 'X' }))).status).toBe(400);
  });

  it('normalizes an unknown priority to null', async () => {
    const app = makeApp();
    const sv = await (await app.request('/api/saved-views', json('POST', { name: 'Mine', view: 'mine', priority: 'wat' }))).json();
    expect(sv.priority).toBeNull();
  });
});
