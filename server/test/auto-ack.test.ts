import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-ack-'))).app;
}
type App = ReturnType<typeof makeApp>;
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

type Msg = { authorKind: string; body: string };

async function firstContactId(app: App): Promise<{ id: string; name: string }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.contacts[0];
}
async function createTicket(app: App, requesterId: string) {
  return (await (await app.request('/api/tickets', json('POST', { subject: 'Hi', body: 'help', requesterId, priority: 'medium' }))).json()).ticket as {
    id: string;
    number: number;
    firstRespondedAt: string | null;
  };
}

describe('auto-acknowledgement', () => {
  it('sends no auto-reply when disabled (default)', async () => {
    const app = makeApp();
    const c = await firstContactId(app);
    const t = await createTicket(app, c.id);
    const msgs = (await (await app.request(`/api/tickets/${t.id}/messages`)).json()) as Msg[];
    expect(msgs.filter((m) => m.authorKind === 'agent')).toHaveLength(0);
  });

  it('fires an auto-reply on create when enabled, without stamping the SLA first response', async () => {
    const app = makeApp();
    await app.request('/api/settings/auto-ack', json('PUT', { enabled: true, message: 'Got it {{name}} — ticket #{{number}} is open.' }));
    const c = await firstContactId(app);
    const t = await createTicket(app, c.id);

    const msgs = (await (await app.request(`/api/tickets/${t.id}/messages`)).json()) as Msg[];
    const agentMsgs = msgs.filter((m) => m.authorKind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].body).toContain(`#${t.number}`);
    expect(agentMsgs[0].body).toContain(c.name.split(' ')[0]);
    // The auto-ack is a bot reply — it must NOT satisfy the human first-response SLA.
    expect(t.firstRespondedAt).toBeNull();
  });

  it('persists the setting through bootstrap', async () => {
    const app = makeApp();
    await app.request('/api/settings/auto-ack', json('PUT', { enabled: true, message: 'Hello' }));
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.autoAck).toEqual({ enabled: true, message: 'Hello' });
  });

  it('rejects a malformed setting', async () => {
    const app = makeApp();
    expect((await app.request('/api/settings/auto-ack', json('PUT', { enabled: 'yes' }))).status).toBe(400);
  });
});
