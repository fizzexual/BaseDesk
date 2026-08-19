// Regression guards for the security audit. Each case below reproduced a real hole
// before it was fixed; the comments record what the vulnerable behaviour was so a
// future refactor that reopens one fails loudly here.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-sec-')));
}
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
type App = ReturnType<typeof makeApp>['app'];
async function adminEmail(app: App): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.agents.find((a: { role: string }) => a.role === 'admin').email;
}
/** An app with admin login switched on and the first admin's password set. */
async function locked(): Promise<{ app: App; email: string; token: string }> {
  const { app } = makeApp();
  const email = await adminEmail(app);
  await app.request('/api/auth/password', json('POST', { password: 'hunter2!!' }));
  await app.request('/api/settings/auth', json('PUT', { enabled: true }));
  expect((await app.request('/api/bootstrap')).status).toBe(401);
  const { token } = await (await app.request('/api/auth/login', json('POST', { email, password: 'hunter2!!' }))).json();
  return { app, email, token };
}

describe('admin auth cannot be bypassed through /api/auth/*', () => {
  it('refuses an unauthenticated password reset', async () => {
    // Was: /api/auth/* was blanket-public and currentAgentId() fell back to the first
    // admin, so this call rewrote that admin's password and handed over the account.
    const { app, email } = await locked();
    expect((await app.request('/api/auth/password', json('POST', { password: 'attacker99' }))).status).toBe(401);
    expect((await app.request('/api/auth/login', json('POST', { email, password: 'attacker99' }))).status).toBe(401);
  });

  it('refuses an unauthenticated 2FA disable', async () => {
    const { app } = await locked();
    expect((await app.request('/api/auth/2fa/disable', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/auth/2fa/setup', { method: 'POST' })).status).toBe(401);
  });

  it('still lets the signed-in admin change their own password', async () => {
    const { app, email, token } = await locked();
    expect((await app.request('/api/auth/password', json('POST', { password: 'newpass123' }, token))).status).toBe(200);
    expect((await app.request('/api/auth/login', json('POST', { email, password: 'newpass123' }))).status).toBe(200);
  });
});

describe('the portal and chat widget keep working once admin login is on', () => {
  it('serves attachments without an admin session', async () => {
    // Was: /api/attachments/:id sat behind the admin gate, so every image in the
    // customer portal and the chat widget broke the moment login was enabled.
    const { app } = makeApp();
    const fd = new FormData();
    fd.append('file', new File(['png-bytes'], 'shot.png', { type: 'image/png' }));
    const att = await (await app.request('/api/uploads', { method: 'POST', body: fd })).json();

    await app.request('/api/auth/password', json('POST', { password: 'hunter2!!' }));
    await app.request('/api/settings/auth', json('PUT', { enabled: true }));

    expect((await app.request(`/api/attachments/${att.id}`)).status).toBe(200);
  });
});

describe('the public web-chat token is scoped to its channel, not to people', () => {
  async function webchat(): Promise<{ app: App; id: string; token: string }> {
    const { app } = makeApp();
    const ch = await (await app.request('/api/channels', json('POST', { type: 'webchat', name: 'Site chat' }))).json();
    return { app, id: ch.id, token: ch.inboundToken }; // this token ships in the public <script> tag
  }

  it('cannot post agent replies or change ticket state', async () => {
    // Was: /command accepted the widget's public token, so any site visitor could
    // speak as support staff and solve, close or reopen tickets.
    const { app, id, token } = await webchat();
    const opened = await (
      await app.request(`/api/channels/${id}/inbound?token=${token}`, json('POST', { from: { email: 'real@customer.com' }, body: 'help' }))
    ).json();

    const reply = await app.request(
      `/api/channels/${id}/command?token=${token}`,
      json('POST', { action: 'reply', ticket: opened.ticketNumber, text: 'Official support: send us your password' }),
    );
    expect(reply.status).toBe(403);

    const closed = await app.request(`/api/channels/${id}/command?token=${token}`, json('POST', { action: 'close', ticket: opened.ticketNumber }));
    expect(closed.status).toBe(403);
  });

  it('cannot read a thread by naming someone else’s email', async () => {
    // Was: /thread took ?contact=<email>, so anyone holding the public token could
    // read any customer's conversation by guessing their address.
    const { app, id, token } = await webchat();
    await app.request(`/api/channels/${id}/inbound?token=${token}`, json('POST', { from: { email: 'victim@corp.com' }, body: 'my card is 4111' }));
    expect((await app.request(`/api/channels/${id}/thread?token=${token}&contact=victim@corp.com`)).status).toBe(401);
  });

  it('reads only the conversation its own visitor token was issued for', async () => {
    const { app, id, token } = await webchat();
    const mine = await (
      await app.request(`/api/channels/${id}/inbound?token=${token}`, json('POST', { from: { email: 'me@corp.com' }, body: 'my own message' }))
    ).json();
    const other = await (
      await app.request(`/api/channels/${id}/inbound?token=${token}`, json('POST', { from: { email: 'victim@corp.com' }, body: 'my card is 4111' }))
    ).json();
    expect(typeof mine.visitorToken).toBe('string');

    const seen = await (await app.request(`/api/channels/${id}/thread?token=${token}&visitor=${encodeURIComponent(mine.visitorToken)}`)).json();
    expect(seen.map((m: { body: string }) => m.body)).toEqual(['my own message']);
    expect(JSON.stringify(seen)).not.toContain('4111');
    expect(other.visitorToken).not.toBe(mine.visitorToken);
  });

  it('will not accept a visitor token as a portal session', async () => {
    // The two are signed with the same secret, so the `visitor:` subject prefix is what
    // stops a widget token from impersonating that contact in the customer portal.
    const { app, id, token } = await webchat();
    const opened = await (
      await app.request(`/api/channels/${id}/inbound?token=${token}`, json('POST', { from: { email: 'me@corp.com' }, body: 'hi' }))
    ).json();
    const res = await app.request('/api/portal/me', { headers: { authorization: `Bearer ${opened.visitorToken}` } });
    expect(res.status).toBe(401);
  });
});

describe('customer-supplied text cannot escape its context', () => {
  it('neutralises a spreadsheet formula in the CSV export', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const made = await app.request(
      '/api/tickets',
      json('POST', { subject: '=1+1', body: 'hi', requesterId: boot.contacts[0].id, priority: 'medium' }),
    );
    expect(made.status).toBe(200);
    const csv = await (await app.request('/api/export?type=tickets')).text();
    expect(csv).not.toMatch(/,=1\+1,/);
    expect(csv).toContain(",'=1+1,"); // literal text, not a live formula
  });

  it('treats a LIKE wildcard in search as a literal character', async () => {
    const { app } = makeApp();
    const all = await (await app.request('/api/search?q=%25')).json(); // q = "%"
    expect(all.ticketIds).toEqual([]);
  });
});

describe('identifiers have enough entropy to be primary keys', () => {
  it('mints ids wide enough that collisions are not a scaling limit', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const made = await (
      await app.request('/api/tickets', json('POST', { subject: 'hello', body: 'hi', requesterId: boot.contacts[0].id, priority: 'medium' }))
    ).json();
    // Was 8 hex chars (32 bits): even odds of a collision near 77k rows.
    expect(made.ticket.id.replace(/^t_/, '')).toHaveLength(32);
    expect(made.message.id.replace(/^m_/, '')).toHaveLength(32);
  });
});
