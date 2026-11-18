import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { buildMessage, isSafeAddress, sendMail, SmtpError } from '../src/smtp.js';

// Security finding #7: an address or a header value that carries CR/LF lets the
// sender write their own SMTP commands or mail headers.

const mail = (over: Partial<Parameters<typeof buildMessage>[0]> = {}) => ({
  from: { name: 'Acme Support', email: 'support@acme.test' },
  to: 'customer@example.com',
  subject: 'Re: your ticket',
  text: 'hello',
  html: '<p>hello</p>',
  ...over,
});

describe('SMTP sink refuses injected addresses and headers', () => {
  it('accepts plain addresses and refuses anything with CR/LF, spaces or brackets', () => {
    expect(isSafeAddress('a.b+c@example.com')).toBe(true);
    for (const bad of ['a@b.c>\r\nRCPT TO:<x@y.z', 'a@b.c\n', 'a b@c.d', '<a@b.c>', 'a"@b.c', 'no-at-sign', 'a@b@c']) {
      expect(isSafeAddress(bad)).toBe(false);
    }
  });

  it('sendMail rejects an injected recipient before it opens a connection', async () => {
    let connected = false;
    const server = net.createServer((s) => { connected = true; s.destroy(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const transport = { host: '127.0.0.1', port, secure: false, user: '', pass: '' };
      await expect(sendMail(transport, mail({ to: 'a@b.c>\r\nRCPT TO:<victim@y.z' }))).rejects.toThrow(SmtpError);
      await expect(sendMail(transport, mail({ from: { name: 'x', email: 'x@y.z>\r\nDATA' } }))).rejects.toThrow(/sender/);
      expect(connected).toBe(false);
    } finally {
      server.close();
    }
  });

  it('flattens CR/LF in the subject and sender name so no header can be added', () => {
    const msg = buildMessage(mail({ subject: 'hi\r\nBcc: everyone@example.com', from: { name: 'A\nX-Evil: 1', email: 'support@acme.test' } }));
    const headers = msg.split('\r\n\r\n')[0].split('\r\n');
    expect(headers.some((h) => h.startsWith('Bcc:'))).toBe(false);
    expect(headers.some((h) => h.startsWith('X-Evil:'))).toBe(false);
    expect(headers).toContain('Subject: hi Bcc: everyone@example.com');
  });

  it('turns a lone CR or LF in the body into CRLF, so "\\n.\\n" cannot end DATA early', () => {
    const msg = buildMessage(mail({ text: 'one\n.\nMAIL FROM:<x@y.z>\rtwo' }));
    expect(msg).not.toMatch(/\r\n\.\r\n/); // the line "." is dot-stuffed to ".."
    expect(msg).toContain('one\r\n..\r\nMAIL FROM:<x@y.z>\r\ntwo');
    expect(msg.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // no bare CR or LF left
  });
});

describe('inbound channel API refuses identities that would reach RCPT TO', () => {
  const token = 'tok_webchat_3f9a2c81';
  async function setup() {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-inj-')));
    const boot = await (await app.request('/api/bootstrap')).json();
    const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat');
    const send = (from: unknown) =>
      app.request(`/api/channels/${ch.id}/inbound?token=${token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, body: 'hi' }),
      });
    return { app, send };
  }

  it('400 for an email with CRLF', async () => {
    const { send } = await setup();
    expect((await send({ email: 'a@b.c>\r\nRCPT TO:<x@y.z' })).status).toBe(400);
  });

  it('400 for an externalId with CRLF or brackets', async () => {
    const { send } = await setup();
    expect((await send({ externalId: 'u1\r\nDATA' })).status).toBe(400);
    expect((await send({ externalId: 'u1>' })).status).toBe(400);
  });

  it('still accepts a normal email and a normal externalId', async () => {
    const { send } = await setup();
    expect((await send({ email: 'ok@example.com' })).status).toBe(200);
    expect((await send({ externalId: 'tg:12345' })).status).toBe(200);
    expect((await send({ externalId: 'user#42' })).status).toBe(200); // Discord tags carry a '#'
  });

  it('admin create-contact refuses an invalid email', async () => {
    const { app } = await setup();
    const res = await app.request('/api/contacts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', email: 'x@y.z\r\nBcc: a@b.c' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('SMTP deadline (correctness finding #12)', () => {
  it('gives up on a server that accepts the connection and never answers', async () => {
    const server = net.createServer(() => { /* accept, say nothing */ });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const started = Date.now();
      await expect(sendMail({ host: '127.0.0.1', port, secure: false, user: '', pass: '' }, mail(), { deadlineMs: 300 })).rejects.toThrow(/stopped answering|closed/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      server.close();
    }
  });
});
