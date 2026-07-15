import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-oncall-'))).app;
}
type App = ReturnType<typeof makeApp>;
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('on-call settings', () => {
  it('defaults to a disabled weekly rotation', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.onCall).toMatchObject({ enabled: false, cadence: 'weekly', rotation: [] });
  });

  it('saves a rotation, keeping only real agents in order', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const [a1, a2] = boot.agents;
    const res = await put(app, '/api/settings/on-call', {
      enabled: true, cadence: 'daily', startDate: '2024-01-01T00:00:00.000Z', rotation: [a2.id, 'ghost', a1.id],
    });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.enabled).toBe(true);
    expect(saved.cadence).toBe('daily');
    expect(saved.rotation).toEqual([a2.id, a1.id]); // unknown id filtered, order preserved

    const boot2 = await (await app.request('/api/bootstrap')).json();
    expect(boot2.onCall.rotation).toEqual([a2.id, a1.id]);
  });

  it('rejects invalid settings', async () => {
    const app = makeApp();
    expect((await put(app, '/api/settings/on-call', { enabled: 'yes', cadence: 'weekly', startDate: 'x' })).status).toBe(400);
    expect((await put(app, '/api/settings/on-call', { enabled: true, cadence: 'monthly', startDate: 'x' })).status).toBe(400);
  });
});
