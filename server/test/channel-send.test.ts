import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { sendToChannel } from '../src/channel-send.js';
import type { ChannelConn } from '../src/types.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-chan-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface Captured {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
interface FakeHttp {
  url: string;
  requests: Captured[];
  waitFor: (match: (c: Captured) => boolean, ms?: number) => Promise<Captured | null>;
  close: () => void;
}

/** A tiny in-process HTTP endpoint that records every outbound POST it receives. */
function fakeHttp(opts: { status?: number } = {}): Promise<FakeHttp> {
  const requests: Captured[] = [];
  const waiters: Array<{ match: (c: Captured) => boolean; resolve: (c: Captured) => void }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const cap: Captured = { method: req.method ?? '', headers: req.headers, body };
      requests.push(cap);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(cap)) {
          waiters[i].resolve(cap);
          waiters.splice(i, 1);
        }
      }
      res.writeHead(opts.status ?? 200);
      res.end('ok');
    });
  });
  const waitFor = (match: (c: Captured) => boolean, ms = 1500) =>
    new Promise<Captured | null>((resolve) => {
      const existing = requests.find(match);
      if (existing) return resolve(existing);
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => {
        const idx = waiters.indexOf(w);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve(null);
      }, ms);
    });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/hook`, requests, waitFor, close: () => server.close() });
    });
  });
}

let fake: FakeHttp | null = null;
afterEach(() => {
  fake?.close();
  fake = null;
});

function channel(partial: Partial<ChannelConn>): ChannelConn {
  return {
    id: 'ch_test', type: 'webhook', name: 'Test', enabled: true, inboundToken: 'tok', address: null,
    createdAt: '2026-01-01T00:00:00.000Z', outboundUrl: null, outboundSecret: null, ...partial,
  };
}

/** Remove seeded AI agents so inbound tickets don't auto-reply during a test. */
async function clearAgents(app: ReturnType<typeof makeApp>) {
  const boot = await (await app.request('/api/bootstrap')).json();
  for (const a of boot.aiAgents) await app.request(`/api/ai/agents/${a.id}`, { method: 'DELETE' });
}

describe('sendToChannel payload shaping', () => {
  it('sends Discord content, not text', async () => {
    fake = await fakeHttp();
    const r = await sendToChannel(channel({ type: 'discord', outboundUrl: fake.url }), {
      ticketNumber: 12, subject: 'Login help', body: 'Try resetting.', toName: 'Ada', fromName: 'Support',
    });
    expect(r.ok).toBe(true);
    const payload = JSON.parse(fake.requests[0].body);
    expect(payload.content).toContain('Login help');
    expect(payload.content).toContain('Try resetting.');
    expect(payload.text).toBeUndefined();
  });

  it('sends Slack text, not content', async () => {
    fake = await fakeHttp();
    await sendToChannel(channel({ type: 'slack', outboundUrl: fake.url }), {
      ticketNumber: 1, subject: 'Hi', body: 'Hello there', toName: null, fromName: 'Support',
    });
    const payload = JSON.parse(fake.requests[0].body);
    expect(payload.text).toContain('Hello there');
    expect(payload.content).toBeUndefined();
  });

  it('sends a generic relay envelope with a Bearer token', async () => {
    fake = await fakeHttp();
    await sendToChannel(channel({ type: 'telegram', outboundUrl: fake.url, outboundSecret: 's3cr3t' }), {
      ticketNumber: 7, subject: 'Order', body: 'Shipped today', toName: 'Ada', fromName: 'Support',
    });
    const cap = fake.requests[0];
    expect(cap.headers.authorization).toBe('Bearer s3cr3t');
    const payload = JSON.parse(cap.body);
    expect(payload.channel).toBe('telegram');
    expect(payload.ticketNumber).toBe(7);
    expect(payload.text).toBe('Shipped today');
    expect(payload.to).toBe('Ada');
    expect(payload.from).toBe('Support');
  });

  it('fails cleanly when no outbound URL is set', async () => {
    const r = await sendToChannel(channel({ type: 'discord' }), {
      ticketNumber: 1, subject: 's', body: 'b', toName: null, fromName: 'S',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/outbound URL/);
  });

  it('reports a non-2xx response as an error', async () => {
    fake = await fakeHttp({ status: 500 });
    const r = await sendToChannel(channel({ type: 'slack', outboundUrl: fake.url }), {
      ticketNumber: 1, subject: 's', body: 'b', toName: null, fromName: 'S',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
  });
});

describe('channel outbound config + wiring', () => {
  it('stores an outbound URL but masks the secret', async () => {
    const app = makeApp();
    const created = await (await app.request('/api/channels', json('POST', {
      type: 'discord', name: 'Guild', outboundUrl: 'https://discord.com/api/webhooks/x', outboundSecret: 'nope',
    }))).json();
    expect(created.outboundUrl).toBe('https://discord.com/api/webhooks/x');
    expect(created.hasOutboundSecret).toBe(true);
    expect('outboundSecret' in created).toBe(false);

    const boot = await (await app.request('/api/bootstrap')).json();
    for (const ch of boot.channels) expect('outboundSecret' in ch).toBe(false);
  });

  it('delivers an agent reply out to the ticket channel', async () => {
    const app = makeApp();
    await clearAgents(app);
    fake = await fakeHttp();
    const ch = await (await app.request('/api/channels', json('POST', {
      type: 'slack', name: 'Slack', outboundUrl: fake.url,
    }))).json();
    const inbound = await (await app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, json('POST', {
      from: { name: 'Ada', email: 'ada@example.com' }, subject: 'Order', body: 'my order is late',
    }))).json();

    await app.request(`/api/tickets/${inbound.ticketId}/messages`, json('POST', { kind: 'reply', body: 'On its way!' }));
    const cap = await fake.waitFor((c) => c.body.includes('On its way!'));
    expect(cap).not.toBeNull();
    expect(JSON.parse(cap!.body).text).toContain('On its way!');
  });

  it('does not deliver outbound on an internal note', async () => {
    const app = makeApp();
    await clearAgents(app);
    fake = await fakeHttp();
    const ch = await (await app.request('/api/channels', json('POST', {
      type: 'slack', name: 'Slack', outboundUrl: fake.url,
    }))).json();
    const inbound = await (await app.request(`/api/channels/${ch.id}/inbound?token=${ch.inboundToken}`, json('POST', {
      from: { email: 'ada@example.com' }, body: 'hello',
    }))).json();

    await app.request(`/api/tickets/${inbound.ticketId}/messages`, json('POST', { kind: 'note', body: 'internal only' }));
    const cap = await fake.waitFor(() => true, 400);
    expect(cap).toBeNull();
  });

  it('sends a canned message through the test route', async () => {
    const app = makeApp();
    fake = await fakeHttp();
    const ch = await (await app.request('/api/channels', json('POST', {
      type: 'discord', name: 'D', outboundUrl: fake.url,
    }))).json();
    const res = await (await app.request(`/api/channels/${ch.id}/test`, { method: 'POST' })).json();
    expect(res.ok).toBe(true);
    const cap = await fake.waitFor((c) => c.body.includes('test'));
    expect(cap).not.toBeNull();
  });

  it('rejects a test when no outbound URL is configured', async () => {
    const app = makeApp();
    const ch = await (await app.request('/api/channels', json('POST', { type: 'discord', name: 'D' }))).json();
    const res = await (await app.request(`/api/channels/${ch.id}/test`, { method: 'POST' })).json();
    expect(res.ok).toBe(false);
  });
});
