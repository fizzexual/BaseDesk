import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-status-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Component = { id: string; name: string; status: string; position: number };
type Incident = { id: string; title: string; status: string; impact: string; resolvedAt: string | null; updates: { status: string; body: string }[] };

describe('status page', () => {
  it('seeds components + an incident and serves them publicly', async () => {
    const app = makeApp();
    const data = await (await app.request('/api/status')).json();
    expect((data.components as Component[]).length).toBeGreaterThanOrEqual(4);
    expect((data.components as Component[]).every((c) => c.status === 'operational')).toBe(true);
    expect((data.incidents as Incident[]).length).toBeGreaterThanOrEqual(1);
    expect((data.incidents as Incident[])[0].status).toBe('resolved');
  });

  it('adds, updates status, and removes a component', async () => {
    const app = makeApp();
    const created = (await (await post(app, '/api/status/components', { name: 'Search' })).json()) as Component[];
    const search = created.find((c) => c.name === 'Search')!;
    expect(search.status).toBe('operational');

    const afterUpdate = (await (await put(app, `/api/status/components/${search.id}`, { name: 'Search', status: 'degraded' })).json()) as Component[];
    expect(afterUpdate.find((c) => c.id === search.id)!.status).toBe('degraded');

    const afterDelete = (await (await app.request(`/api/status/components/${search.id}`, { method: 'DELETE' })).json()) as Component[];
    expect(afterDelete.find((c) => c.id === search.id)).toBeUndefined();
  });

  it('opens an incident, posts updates, and resolving stamps resolvedAt', async () => {
    const app = makeApp();
    const opened = (await (await post(app, '/api/status/incidents', { title: 'API errors', impact: 'major', body: 'Seeing elevated 500s.' })).json()) as Incident[];
    const inc = opened.find((i) => i.title === 'API errors')!;
    expect(inc.status).toBe('investigating');
    expect(inc.updates).toHaveLength(1);
    expect(inc.resolvedAt).toBeNull();

    const afterUpdate = (await (await post(app, `/api/status/incidents/${inc.id}/updates`, { status: 'monitoring', body: 'A fix is deployed; watching.' })).json()) as Incident[];
    const monitoring = afterUpdate.find((i) => i.id === inc.id)!;
    expect(monitoring.status).toBe('monitoring');
    expect(monitoring.updates).toHaveLength(2);
    expect(monitoring.resolvedAt).toBeNull();

    const afterResolve = (await (await post(app, `/api/status/incidents/${inc.id}/updates`, { status: 'resolved', body: 'Recovered.' })).json()) as Incident[];
    const resolved = afterResolve.find((i) => i.id === inc.id)!;
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('rejects invalid statuses and empty update bodies', async () => {
    const app = makeApp();
    expect((await post(app, '/api/status/components', { name: '' })).status).toBe(400);
    const c = (await (await post(app, '/api/status/components', { name: 'Uploads' })).json()) as Component[];
    const id = c.find((x) => x.name === 'Uploads')!.id;
    expect((await put(app, `/api/status/components/${id}`, { name: 'Uploads', status: 'bogus' })).status).toBe(400);
    const inc = (await (await post(app, '/api/status/incidents', { title: 'X', impact: 'minor', body: 'y' })).json()) as Incident[];
    const incId = inc[0].id;
    expect((await post(app, `/api/status/incidents/${incId}/updates`, { status: 'monitoring', body: '' })).status).toBe(400);
    expect((await post(app, `/api/status/incidents/${incId}/updates`, { status: 'bogus', body: 'hi' })).status).toBe(400);
  });
});
