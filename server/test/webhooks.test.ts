import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { deliverDue, MAX_ATTEMPTS, RETRY_BACKOFF_S } from '../src/webhooks.js';

// Outgoing webhooks: every way a ticket or reply is written reaches the receiver, signed,
// and a receiver that is down gets retries and then a visible "failed".

interface Hit { headers: http.IncomingHttpHeaders; body: string; json: Record<string, any> }

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

/** A local receiver. `reply` decides the status code per hit (default 200). */
async function receiver(reply: (n: number) => number | 'hang' = () => 200) {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      hits.push({ headers: req.headers, body, json: JSON.parse(body) });
      const code = reply(hits.length);
      if (code === 'hang') return; // never answers
      res.writeHead(code, code >= 300 && code < 400 ? { location: 'http://169.254.169.254/' } : {});
      res.end('ok');
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, hits };
}

const req = (method: string, body?: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const ALL = ['ticket.created', 'ticket.status_changed', 'ticket.assignee_changed', 'message.created'];

async function deskWithHook(url: string, events = ALL) {
  const d = createApp(mkdtempSync(path.join(tmpdir(), 'bd-wh-')));
  const res = await d.app.request('/api/webhooks', req('POST', { url, events }));
  expect(res.status).toBe(201);
  const { webhook, secret } = await res.json();
  return { ...d, webhook, secret: secret as string };
}

async function portalTicket(app: ReturnType<typeof createApp>['app']) {
  const reg = await (await app.request('/api/portal/register', req('POST', { name: 'Cara', email: 'cara@example.com', password: 'password123' }))).json();
  const created = await (await app.request('/api/portal/tickets', req('POST', { subject: 'Printer on fire', body: 'help' }, reg.token))).json();
  return created.ticket.id as string;
}

describe('webhook events', () => {
  it('a portal ticket, a status change, an assignment and a reply each arrive, signed', async () => {
    const rx = await receiver();
    const { app, db, secret, deliverWebhooks } = await deskWithHook(rx.url);
    const ticketId = await portalTicket(app);
    const agent = (db.prepare("SELECT id FROM agents WHERE status = 'active' LIMIT 1").get() as { id: string }).id;
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { status: 'pending', assigneeId: agent }));
    await app.request(`/api/tickets/${ticketId}/messages`, req('POST', { kind: 'reply', body: 'On it' }));
    await app.request(`/api/tickets/${ticketId}/messages`, req('POST', { kind: 'note', body: 'internal only' }));
    expect(await deliverWebhooks(Date.now())).toBeGreaterThanOrEqual(5);

    const events = rx.hits.map((h) => h.json.event);
    expect(events).toEqual(expect.arrayContaining(['ticket.created', 'message.created', 'ticket.status_changed', 'ticket.assignee_changed']));
    // Internal notes never leave the desk.
    expect(rx.hits.some((h) => h.json.message?.body === 'internal only')).toBe(false);
    expect(rx.hits.filter((h) => h.json.event === 'message.created').map((h) => h.json.message.body)).toEqual(['help', 'On it']);

    const created = rx.hits.find((h) => h.json.event === 'ticket.created')!;
    expect(created.json.ticket).toMatchObject({ id: ticketId, subject: 'Printer on fire', requester: { email: 'cara@example.com' } });
    const status = rx.hits.find((h) => h.json.event === 'ticket.status_changed')!;
    expect(status.json.change).toMatchObject({ to: 'pending' });
    expect(rx.hits.find((h) => h.json.event === 'ticket.assignee_changed')!.json.change).toEqual({ from: null, to: agent });

    for (const h of rx.hits) {
      const expected = `sha256=${createHmac('sha256', secret).update(h.body).digest('hex')}`;
      expect(h.headers['x-basedesk-signature']).toBe(expected);
      expect(h.headers['x-basedesk-event']).toBe(h.json.event);
      expect(String(h.headers['x-basedesk-delivery'])).toMatch(/^whd_/);
    }
    // Nothing is sent twice.
    expect(await deliverWebhooks(Date.now())).toBe(0);
  });

  it('sends only the events a webhook subscribed to, and nothing while it is off', async () => {
    const rx = await receiver();
    const { app, webhook, deliverWebhooks } = await deskWithHook(rx.url, ['ticket.status_changed']);
    const ticketId = await portalTicket(app);
    await deliverWebhooks(Date.now());
    expect(rx.hits).toHaveLength(0);

    await app.request(`/api/webhooks/${webhook.id}`, req('PATCH', { enabled: false }));
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { status: 'solved' }));
    await deliverWebhooks(Date.now());
    expect(rx.hits).toHaveLength(0);

    await app.request(`/api/webhooks/${webhook.id}`, req('PATCH', { enabled: true }));
    await app.request(`/api/tickets/${ticketId}`, req('PATCH', { status: 'open' }));
    await deliverWebhooks(Date.now());
    expect(rx.hits.map((h) => h.json.change)).toEqual([{ from: 'solved', to: 'open' }]);
  });

  it('a desk without webhooks records nothing (the triggers stay quiet)', async () => {
    const { app, db } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-wh-none-')));
    await portalTicket(app);
    expect((db.prepare('SELECT COUNT(*) AS n FROM webhook_outbox').get() as { n: number }).n).toBe(0);
  });
});

describe('webhook delivery failures', () => {
  it('retries with backoff, then marks the delivery failed; a manual retry sends it again', async () => {
    let up = false;
    const rx = await receiver(() => (up ? 200 : 500));
    const { app, db, webhook, deliverWebhooks } = await deskWithHook(rx.url, ['ticket.created']);
    await portalTicket(app);

    let now = Date.now();
    await deliverWebhooks(now);
    const row = () => db.prepare('SELECT * FROM webhook_deliveries').get() as { id: string; status: string; attempts: number; lastError: string; nextAttemptAt: string };
    expect(row()).toMatchObject({ status: 'pending', attempts: 1, lastError: 'HTTP 500' });
    expect(Date.parse(row().nextAttemptAt) - now).toBe(RETRY_BACKOFF_S[0] * 1000);

    await deliverWebhooks(now + 1000); // not due yet
    expect(row().attempts).toBe(1);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      now = Date.parse(row().nextAttemptAt);
      await deliverWebhooks(now);
    }
    expect(row()).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(rx.hits).toHaveLength(MAX_ATTEMPTS);
    const listed = await (await app.request('/api/webhooks')).json();
    expect(listed[0]).toMatchObject({ id: webhook.id, failed: 1 });

    up = true;
    const retried = await (await app.request(`/api/webhooks/deliveries/${row().id}/retry`, req('POST'))).json();
    expect(retried).toMatchObject({ status: 'delivered', lastStatus: 200 });
  });

  it('does not follow a redirect (it could point into the cloud metadata range)', async () => {
    const rx = await receiver(() => 302);
    const { app, webhook } = await deskWithHook(rx.url);
    const ping = await (await app.request(`/api/webhooks/${webhook.id}/test`, req('POST'))).json();
    expect(ping).toMatchObject({ status: 'failed', lastStatus: 302 });
    expect(ping.lastError).toContain('redirects are not followed');
    expect(rx.hits).toHaveLength(1);
  });

  it('gives up on a receiver that never answers', async () => {
    const rx = await receiver(() => 'hang');
    const { app, db } = await deskWithHook(rx.url, ['ticket.created']);
    await portalTicket(app);
    await deliverDue(db, Date.now(), { timeoutMs: 300 });
    expect(db.prepare('SELECT attempts, lastError FROM webhook_deliveries').get()).toMatchObject({ attempts: 1, lastError: 'no answer within 300 ms' });
  });
});

describe('webhook settings API', () => {
  it('"Send test" delivers a ping and reports it', async () => {
    const rx = await receiver();
    const { app, webhook } = await deskWithHook(rx.url);
    const ping = await (await app.request(`/api/webhooks/${webhook.id}/test`, req('POST'))).json();
    expect(ping).toMatchObject({ event: 'ping', status: 'delivered', lastStatus: 200 });
    expect(rx.hits[0].json).toMatchObject({ event: 'ping', webhookId: webhook.id });
  });

  it('refuses metadata addresses, bad schemes and empty event lists; never lists the secret', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-wh-api-')));
    expect((await app.request('/api/webhooks', req('POST', { url: 'http://169.254.169.254/latest', events: ALL }))).status).toBe(400);
    expect((await app.request('/api/webhooks', req('POST', { url: 'file:///etc/passwd', events: ALL }))).status).toBe(400);
    expect((await app.request('/api/webhooks', req('POST', { url: 'http://127.0.0.1:9/x', events: [] }))).status).toBe(400);
    expect((await app.request('/api/webhooks', req('POST', { url: 'http://127.0.0.1:9/x', events: ['ticket.deleted'] }))).status).toBe(400);
    const ok = await (await app.request('/api/webhooks', req('POST', { url: 'http://127.0.0.1:9/x', events: ALL }))).json();
    expect(ok.secret).toMatch(/^whsec_/);
    const listed = await (await app.request('/api/webhooks')).text();
    expect(listed).not.toContain(ok.secret);
    const rotated = await (await app.request(`/api/webhooks/${ok.webhook.id}`, req('PATCH', { rotateSecret: true }))).json();
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(ok.secret);
    expect((await app.request(`/api/webhooks/${ok.webhook.id}`, req('DELETE'))).status).toBe(200);
    expect(await (await app.request('/api/webhooks')).json()).toEqual([]);
  });

  it('is for admins only when login is on', async () => {
    const { app, setupToken } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-wh-roles-')), { production: true, demo: true });
    const admin = await (await app.request('/api/setup', req('POST', { token: setupToken, name: 'Ann', email: 'ann@example.com', password: 'admin password' }))).json();
    const invited = await (await app.request('/api/agents', req('POST', { name: 'Bob', email: 'bob@example.com', role: 'agent' }, admin.token))).json();
    const bob = await (await app.request('/api/auth/accept-invite', req('POST', { token: invited.inviteToken, password: 'bob password' }))).json();
    expect((await app.request('/api/webhooks', req('GET', undefined, bob.token))).status).toBe(403);
    expect((await app.request('/api/webhooks', req('POST', { url: 'http://127.0.0.1:9/x', events: ALL }, bob.token))).status).toBe(403);
    expect((await app.request('/api/webhooks', req('GET', undefined, admin.token))).status).toBe(200);
    expect((await app.request('/api/webhooks', req('GET'))).status).toBe(401);
  });
});
