import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-inb-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function makeChannel(app: ReturnType<typeof makeApp>, extra: Record<string, unknown> = {}) {
  return (await app.request('/api/channels', json('POST', { type: 'discord', name: 'Guild', ...extra }))).json();
}
function inbound(app: ReturnType<typeof makeApp>, ch: { id: string; inboundToken: string }, payload: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}
function command(app: ReturnType<typeof makeApp>, ch: { id: string; inboundToken: string }, payload: unknown) {
  return app.request(`/api/channels/${ch.id}/command?token=${ch.inboundToken}`, json('POST', payload));
}
async function clearAgents(app: ReturnType<typeof makeApp>) {
  const boot = await (await app.request('/api/bootstrap')).json();
  for (const a of boot.aiAgents) await app.request(`/api/ai/agents/${a.id}`, { method: 'DELETE' });
}

describe('inbound threading', () => {
  it("threads a sender's messages into one open ticket", async () => {
    const app = makeApp();
    await clearAgents(app);
    const ch = await makeChannel(app);
    const a = await (await inbound(app, ch, { from: { externalId: 'user#42', name: 'Ada' }, body: 'my order is late' })).json();
    expect(a.threaded).toBe(false);
    const b = await (await inbound(app, ch, { from: { externalId: 'user#42' }, body: 'still waiting' })).json();
    expect(b.threaded).toBe(true);
    expect(b.ticketId).toBe(a.ticketId);
    const thread = await (await app.request(`/api/tickets/${a.ticketId}/messages`)).json();
    expect(thread.filter((m: { authorKind: string }) => m.authorKind === 'contact')).toHaveLength(2);
  });

  it('opens a fresh ticket once the previous one is solved', async () => {
    const app = makeApp();
    await clearAgents(app);
    const ch = await makeChannel(app);
    const a = await (await inbound(app, ch, { from: { externalId: 'u1' }, body: 'hi' })).json();
    await app.request(`/api/tickets/${a.ticketId}`, json('PATCH', { status: 'solved' }));
    const b = await (await inbound(app, ch, { from: { externalId: 'u1' }, body: 'a new problem' })).json();
    expect(b.ticketId).not.toBe(a.ticketId);
    expect(b.threaded).toBe(false);
  });

  it('requires an email or externalId', async () => {
    const app = makeApp();
    const ch = await makeChannel(app);
    expect((await inbound(app, ch, { body: 'anon' })).status).toBe(400);
  });
});

describe('inbound signing secret', () => {
  it('rejects unsigned requests when a secret is set, accepts a valid HMAC, and masks the secret', async () => {
    const app = makeApp();
    await clearAgents(app);
    const ch = await makeChannel(app, { inboundSecret: 's3cr3t' });

    expect((await inbound(app, ch, { from: { externalId: 'u1' }, body: 'hi' })).status).toBe(401);

    const raw = JSON.stringify({ from: { externalId: 'u1' }, body: 'hi' });
    const sig = createHmac('sha256', 's3cr3t').update(raw).digest('hex');
    const ok = await app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-basedesk-signature': sig },
      body: raw,
    });
    expect(ok.status).toBe(200);

    const boot = await (await app.request('/api/bootstrap')).json();
    const pub = boot.channels.find((x: { id: string }) => x.id === ch.id);
    expect(pub.hasInboundSecret).toBe(true);
    expect('inboundSecret' in pub).toBe(false);
  });
});

describe('channel command endpoint', () => {
  it('replies to a ticket by number and moves it to pending', async () => {
    const app = makeApp();
    await clearAgents(app);
    const ch = await makeChannel(app);
    const a = await (await inbound(app, ch, { from: { externalId: 'u1' }, body: 'help' })).json();
    const res = await (await command(app, ch, { action: 'reply', ticket: a.ticketNumber, text: 'On it!' })).json();
    expect(res.ok).toBe(true);
    expect(res.ticket.status).toBe('pending');
    const thread = await (await app.request(`/api/tickets/${a.ticketId}/messages`)).json();
    expect(thread.some((m: { authorKind: string; body: string }) => m.authorKind === 'agent' && m.body === 'On it!')).toBe(true);
  });

  it('solves, reopens, and reports status', async () => {
    const app = makeApp();
    await clearAgents(app);
    const ch = await makeChannel(app);
    const a = await (await inbound(app, ch, { from: { externalId: 'u1' }, body: 'help' })).json();
    expect((await (await command(app, ch, { action: 'solve', ticket: a.ticketNumber })).json()).ticket.status).toBe('solved');
    expect((await (await command(app, ch, { action: 'reopen', ticket: a.ticketNumber })).json()).ticket.status).toBe('open');
    expect((await (await command(app, ch, { action: 'status', ticket: a.ticketNumber })).json()).ticket.status).toBe('open');
  });

  it('404s a ticket that is not on this channel', async () => {
    const app = makeApp();
    const ch = await makeChannel(app);
    const boot = await (await app.request('/api/bootstrap')).json();
    const foreign = boot.tickets[0].number; // a seeded ticket on a different channel
    expect((await command(app, ch, { action: 'status', ticket: foreign })).status).toBe(404);
  });
});
