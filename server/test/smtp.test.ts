import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-smtp-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

interface FakeSmtp {
  port: number;
  received: Promise<{ to: string; data: string }>;
  close: () => void;
}

/** A tiny in-process SMTP server that speaks just enough to capture one message. */
function fakeSmtp(): Promise<FakeSmtp> {
  let resolveReceived: (v: { to: string; data: string }) => void;
  const received = new Promise<{ to: string; data: string }>((r) => (resolveReceived = r));
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 fake ESMTP\r\n');
    let buf = '';
    let state: 'normal' | 'auth-user' | 'auth-pass' | 'data' = 'normal';
    let to = '';
    const data: string[] = [];
    sock.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (state === 'data') {
          if (line === '.') {
            state = 'normal';
            sock.write('250 queued\r\n');
            resolveReceived({ to, data: data.join('\n') });
          } else data.push(line);
          continue;
        }
        if (state === 'auth-user') { state = 'auth-pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (state === 'auth-pass') { state = 'normal'; sock.write('235 authenticated\r\n'); continue; }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (up.startsWith('AUTH LOGIN')) { state = 'auth-user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (up.startsWith('RCPT TO')) { to = line.match(/<([^>]+)>/)?.[1] ?? ''; sock.write('250 ok\r\n'); }
        else if (up === 'DATA') { state = 'data'; sock.write('354 go ahead\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() });
    });
  });
}

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
