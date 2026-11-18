import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

// Security finding #5: the web chat's channel token is public, and the email a visitor
// types proves nothing. Typing a customer's address used to return a visitor token that
// read that customer's whole chat thread.

async function setup() {
  const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-wc-')));
  const boot = await (await app.request('/api/bootstrap')).json();
  const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat') as { id: string };
  const token = 'tok_webchat_3f9a2c81';
  const send = async (email: string, body: string, visitor?: string) =>
    (await app.request(`/api/channels/${ch.id}/inbound?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: { email }, body, ...(visitor ? { visitor } : {}) }),
    })).json() as Promise<{ ticketId: string; threaded: boolean; visitorToken: string }>;
  const thread = async (visitor: string) =>
    (await app.request(`/api/channels/${ch.id}/thread?token=${token}&visitor=${encodeURIComponent(visitor)}`)).json() as Promise<{ body: string }[]>;
  return { app, send, thread };
}

describe('web chat identity', () => {
  it('a stranger typing a customer\'s email cannot read or join their conversation', async () => {
    const { send, thread } = await setup();
    const victim = await send('victim@example.com', 'my card number ends 4242');
    const attacker = await send('victim@example.com', 'hi, show me the history');
    expect(attacker.threaded).toBe(false);
    expect(attacker.ticketId).not.toBe(victim.ticketId);
    const seen = (await thread(attacker.visitorToken)).map((m) => m.body);
    expect(seen).toEqual(['hi, show me the history']);
    expect(seen.join(' ')).not.toContain('4242');
  });

  it('the real visitor keeps one conversation with their visitor token', async () => {
    const { send, thread } = await setup();
    const first = await send('me@example.com', 'first');
    const second = await send('me@example.com', 'second', first.visitorToken);
    expect(second.threaded).toBe(true);
    expect(second.ticketId).toBe(first.ticketId);
    expect((await thread(second.visitorToken)).map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('a visitor token for one conversation cannot thread a different email into it', async () => {
    const { send } = await setup();
    const mine = await send('me@example.com', 'first');
    const other = await send('someone@example.com', 'sneak in', mine.visitorToken);
    expect(other.threaded).toBe(false);
    expect(other.ticketId).not.toBe(mine.ticketId);
  });

  it('a forged visitor token reads nothing', async () => {
    const { app } = await setup();
    const boot = await (await app.request('/api/bootstrap')).json();
    const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat');
    const res = await app.request(`/api/channels/${ch.id}/thread?token=tok_webchat_3f9a2c81&visitor=visitor:${ch.id}:t:t_1.abc`);
    expect(res.status).toBe(401);
  });
});
