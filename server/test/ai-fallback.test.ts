import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-fallback-'))).app;
}
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const draft = async (app: ReturnType<typeof makeApp>) => {
  const tid = (await (await app.request('/api/bootstrap')).json()).tickets[0].id;
  return (await app.request('/api/ai/draft', json('POST', { ticketId: tid }))).json();
};

describe('AI fallback reason', () => {
  it("reports 'off' when no provider is configured (the default)", async () => {
    const app = makeApp();
    const r = await draft(app);
    expect(r.source).toBe('rules');
    expect(r.reason).toBe('off'); // the UI maps this to "set up AI in Settings"
  });

  it('reports the provider error when a configured call fails', async () => {
    const app = makeApp();
    // Point at an unreachable port so the call fails.
    await app.request('/api/ai/provider', json('PUT', { enabled: true, baseUrl: 'http://127.0.0.1:1/v1', model: 'm', apiKey: 'sk-x' }));
    const r = await draft(app);
    expect(r.source).toBe('rules');
    expect(typeof r.reason).toBe('string');
    expect(r.reason).not.toBe('off'); // a real error string, not the "not configured" sentinel
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('surfaces a triage fallback reason too', async () => {
    const app = makeApp();
    const tid = (await (await app.request('/api/bootstrap')).json()).tickets[0].id;
    const r = await (await app.request('/api/ai/triage', json('POST', { ticketId: tid }))).json();
    expect(r.source).toBe('rules');
    expect(r.fallbackReason).toBe('off');
  });
});
