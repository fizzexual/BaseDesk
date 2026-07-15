import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-ann-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Announcement = { id: string; body: string; level: string; active: boolean };
const portalList = async (app: App) => (await (await app.request('/api/portal/announcements')).json()) as Announcement[];
const bootList = async (app: App) => ((await (await app.request('/api/bootstrap')).json()).announcements) as Announcement[];

describe('announcements', () => {
  it('creates an announcement, serves it publicly, and lists it in bootstrap', async () => {
    const app = makeApp();
    expect(await portalList(app)).toHaveLength(0);
    const created = (await (await post(app, '/api/announcements', { body: 'Scheduled maintenance Saturday', level: 'warning' })).json()) as Announcement[];
    expect(created[0].active).toBe(true);
    expect(created[0].level).toBe('warning');
    expect(await portalList(app)).toHaveLength(1);
    expect(await bootList(app)).toHaveLength(1);
  });

  it('hides an inactive announcement from the public list but keeps it in bootstrap', async () => {
    const app = makeApp();
    const created = (await (await post(app, '/api/announcements', { body: 'Heads up', level: 'info' })).json()) as Announcement[];
    const id = created[0].id;
    await put(app, `/api/announcements/${id}`, { body: 'Heads up', level: 'info', active: false });
    expect(await portalList(app)).toHaveLength(0);
    expect((await bootList(app)).find((a) => a.id === id)?.active).toBe(false);

    await app.request(`/api/announcements/${id}`, { method: 'DELETE' });
    expect(await bootList(app)).toHaveLength(0);
  });

  it('rejects an empty body and an unknown update', async () => {
    const app = makeApp();
    expect((await post(app, '/api/announcements', { body: '  ', level: 'info' })).status).toBe(400);
    expect((await put(app, '/api/announcements/nope', { body: 'x', level: 'info', active: true })).status).toBe(404);
  });
});
