import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-awaiting-'))).app;
}
type App = ReturnType<typeof makeApp>;
const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

async function openPortalTicket(app: App, email: string): Promise<{ id: string; token: string }> {
  const reg = await (await app.request('/api/portal/register', json({ name: 'Ada', email, password: 'hunter2!' }))).json();
  const created = await (await app.request('/api/portal/tickets', json({ subject: 'Help', body: 'It broke' }, reg.token))).json();
  return { id: created.ticket.id, token: reg.token };
}

describe('awaiting-reply indicator', () => {
  it('flips as the customer and team take turns', async () => {
    const app = makeApp();
    const { id, token } = await openPortalTicket(app, 'ada@example.com');

    // readOne exercises getTicket → awaitingReplyFor; readList exercises awaitingReplyMap.
    const readOne = async () => (await (await app.request(`/api/portal/tickets/${id}`, { headers: { authorization: `Bearer ${token}` } })).json()).ticket.awaitingReply;
    const readList = async () => {
      const boot = await (await app.request('/api/bootstrap')).json();
      return boot.tickets.find((t: { id: string }) => t.id === id).awaitingReply;
    };

    // A fresh customer message with no team response yet — awaiting on every read path.
    expect(await readOne()).toBe(true);
    expect(await readList()).toBe(true);

    // The team replies — no longer awaiting.
    await app.request(`/api/tickets/${id}/messages`, json({ kind: 'reply', body: 'On it' }));
    expect(await readOne()).toBe(false);
    expect(await readList()).toBe(false);

    // The customer writes back — awaiting again.
    await app.request(`/api/portal/tickets/${id}/messages`, json({ body: 'Still broken' }, token));
    expect(await readOne()).toBe(true);
    expect(await readList()).toBe(true);
  });

  it('ignores internal notes — only public replies clear the flag', async () => {
    const app = makeApp();
    const { id, token } = await openPortalTicket(app, 'ben@example.com');

    // An internal agent note is not a reply to the customer, so it stays awaiting.
    await app.request(`/api/tickets/${id}/messages`, json({ kind: 'note', body: 'FYI team' }));
    const read = await (await app.request(`/api/portal/tickets/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(read.ticket.awaitingReply).toBe(true);
  });
});
