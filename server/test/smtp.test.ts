import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { fakeSmtp, type FakeSmtp } from './fake-smtp.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-smtp-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

let smtp: FakeSmtp | null = null;
afterEach(() => {
  smtp?.close();
  smtp = null;
});

function configure(app: ReturnType<typeof makeApp>, port: number) {
  return app.request('/api/settings/smtp', json('PUT', {
    enabled: true, host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p',
    fromName: 'Acme Support', fromEmail: 'support@acme.com', publicUrl: 'https://help.acme.com',
  }));
}

describe('smtp config', () => {
  it('defaults to disabled and masks the password', async () => {
    const app = makeApp();
    const s = await (await app.request('/api/settings/smtp')).json();
    expect(s.enabled).toBe(false);
    expect(s.hasPass).toBe(false);
    expect('pass' in s).toBe(false);

    const saved = await (await app.request('/api/settings/smtp', json('PUT', { host: 'smtp.acme.com', pass: 'secret', fromEmail: 'a@b.com' }))).json();
    expect(saved.hasPass).toBe(true);
    expect('pass' in saved).toBe(false);

    // Omitting pass keeps it; sending '' clears it.
    const kept = await (await app.request('/api/settings/smtp', json('PUT', { fromName: 'Acme' }))).json();
    expect(kept.hasPass).toBe(true);
    const cleared = await (await app.request('/api/settings/smtp', json('PUT', { pass: '' }))).json();
    expect(cleared.hasPass).toBe(false);
  });
});

describe('smtp send', () => {
  it('delivers a test email through the SMTP server', async () => {
    const app = makeApp();
    smtp = await fakeSmtp();
    await configure(app, smtp.port);
    const res = await (await app.request('/api/settings/smtp/test', json('POST', { to: 'me@acme.com' }))).json();
    expect(res.ok).toBe(true);
    const msg = await smtp.received;
    expect(msg.to).toBe('me@acme.com');
    expect(msg.data).toContain('BaseDesk email test');
  });

  it('emails the customer when an agent replies, with a portal link', async () => {
    const app = makeApp();
    smtp = await fakeSmtp();
    await configure(app, smtp.port);
    const boot = await (await app.request('/api/bootstrap')).json();
    const { ticket } = await (await app.request('/api/tickets', json('POST', {
      subject: 'Cannot log in', body: 'help', requesterId: boot.contacts[0].id, priority: 'high',
    }))).json();

    await app.request(`/api/tickets/${ticket.id}/messages`, json('POST', { kind: 'reply', body: 'Try resetting your password.' }));
    const msg = await smtp.received;
    expect(msg.to).toBe(boot.contacts[0].email);
    expect(msg.data).toContain('Try resetting your password.');
    expect(msg.data).toContain(`https://help.acme.com/portal/ticket/${ticket.id}`);
  });

  it('does not email on an internal note', async () => {
    const app = makeApp();
    smtp = await fakeSmtp();
    await configure(app, smtp.port);
    const boot = await (await app.request('/api/bootstrap')).json();
    const { ticket } = await (await app.request('/api/tickets', json('POST', {
      subject: 'Q', body: 'q', requesterId: boot.contacts[0].id, priority: 'low',
    }))).json();

    await app.request(`/api/tickets/${ticket.id}/messages`, json('POST', { kind: 'note', body: 'internal only' }));
    const raced = await Promise.race([
      smtp.received.then(() => 'emailed'),
      new Promise((r) => setTimeout(() => r('no-email'), 400)),
    ]);
    expect(raced).toBe('no-email');
  });
});
