import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { fakeSmtp, type FakeSmtp } from './fake-smtp.js';

// Security finding #4: portal signup used to hand an existing contact's tickets to anyone
// who typed that contact's email. Now the claim completes only from a link sent to it.

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

let smtp: FakeSmtp | null = null;
afterEach(() => {
  smtp?.close();
  smtp = null;
});

async function setup() {
  const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-claim-')));
  smtp = await fakeSmtp();
  await app.request('/api/settings/smtp', { ...json({
    enabled: true, host: '127.0.0.1', port: smtp.port, secure: false, user: '', pass: '',
    fromName: 'Acme Support', fromEmail: 'support@acme.com', publicUrl: 'https://help.acme.com/',
  }), method: 'PUT' });
  const boot = await (await app.request('/api/bootstrap')).json();
  const victim = boot.contacts[0] as { id: string; email: string; name: string };
  return { app, victim, smtp };
}

describe('portal claim of an address that already has tickets', () => {
  it('signs nobody in at register time; the emailed link finishes it', async () => {
    const { app, victim, smtp } = await setup();
    const res = await app.request('/api/portal/register', json({ name: 'Me', email: victim.email, password: 'my new password' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ pending: true });

    const mail = await smtp.received;
    expect(mail.to).toBe(victim.email);
    const link = /https:\/\/help\.acme\.com\/portal\/login\?claim=([A-Za-z0-9_-]+)/.exec(mail.data);
    expect(link).not.toBeNull();

    const claimed = await app.request('/api/portal/claim', json({ token: link![1] }));
    expect(claimed.status).toBe(200);
    const { token, contact } = await claimed.json();
    expect(contact.id).toBe(victim.id);
    expect((await app.request('/api/portal/tickets', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    // The password chosen at register time is the one that now works.
    expect((await app.request('/api/portal/login', json({ email: victim.email, password: 'my new password' }))).status).toBe(200);

    // One use only.
    expect((await app.request('/api/portal/claim', json({ token: link![1] }))).status).toBe(400);
  });

  it('refuses a made-up or empty claim token', async () => {
    const { app } = await setup();
    expect((await app.request('/api/portal/claim', json({ token: 'nope' }))).status).toBe(400);
    expect((await app.request('/api/portal/claim', json({ token: '' }))).status).toBe(400);
  });

  it('refuses an expired link', async () => {
    const { app, victim, smtp } = await setup();
    await app.request('/api/portal/register', json({ name: 'Me', email: victim.email, password: 'my new password' }));
    const claim = /claim=([A-Za-z0-9_-]+)/.exec((await smtp.received).data)![1];
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 61 * 60_000;
      expect((await app.request('/api/portal/claim', json({ token: claim }))).status).toBe(400);
    } finally {
      Date.now = realNow;
    }
  });

  it('a brand-new address still signs up and in at once', async () => {
    const { app } = await setup();
    const res = await app.request('/api/portal/register', json({ name: 'New', email: 'new.person@example.com', password: 'password123' }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe('string');
  });
});
