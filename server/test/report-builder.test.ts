import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-report-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Report = { id: string; name: string; metric: string; dimension: string; range: string };

describe('custom reports', () => {
  it('creates, updates, deletes, and lists in bootstrap', async () => {
    const app = makeApp();
    const created = (await (await post(app, '/api/reports', { name: 'Volume by day', metric: 'volume', dimension: 'day', range: 'last_14' })).json()) as Report;
    expect(created.id).toBeTruthy();
    expect(created.metric).toBe('volume');

    const boot = await (await app.request('/api/bootstrap')).json();
    expect((boot.customReports as Report[]).find((r) => r.id === created.id)).toBeDefined();

    const updated = (await (await put(app, `/api/reports/${created.id}`, { name: 'Solved by agent', metric: 'solved', dimension: 'agent', range: 'last_30' })).json()) as Report;
    expect(updated.name).toBe('Solved by agent');
    expect(updated.dimension).toBe('agent');

    await app.request(`/api/reports/${created.id}`, { method: 'DELETE' });
    const boot2 = await (await app.request('/api/bootstrap')).json();
    expect((boot2.customReports as Report[]).find((r) => r.id === created.id)).toBeUndefined();
  });

  it('rejects invalid metric/dimension/range and missing name, and unknown updates', async () => {
    const app = makeApp();
    expect((await post(app, '/api/reports', { name: 'x', metric: 'bogus', dimension: 'day', range: 'all' })).status).toBe(400);
    expect((await post(app, '/api/reports', { name: 'x', metric: 'volume', dimension: 'bogus', range: 'all' })).status).toBe(400);
    expect((await post(app, '/api/reports', { name: 'x', metric: 'volume', dimension: 'day', range: 'bogus' })).status).toBe(400);
    expect((await post(app, '/api/reports', { name: '  ', metric: 'volume', dimension: 'day', range: 'all' })).status).toBe(400);
    expect((await put(app, '/api/reports/nope', { name: 'x', metric: 'volume', dimension: 'day', range: 'all' })).status).toBe(404);
  });
});
