import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-portal-'))).app;
}
type App = ReturnType<typeof makeApp>;
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function register(app: App, name: string, email: string, password: string) {
  return (await app.request('/api/portal/register', json('POST', { name, email, password }))).json();
}

describe('portal auth', () => {
  it('registers, rejects duplicates, and signs in', async () => {
    const app = makeApp();
    const reg = await register(app, 'Dana Lux', 'dana@acme.com', 'sup3rsecret');
    expect(String(reg.token)).toMatch(/\./);
    expect(reg.contact.email).toBe('dana@acme.com');
    expect('passwordHash' in reg.contact).toBe(false);

    const dup = await app.request('/api/portal/register', json('POST', { name: 'X', email: 'dana@acme.com', password: 'anotherpass' }));
    expect(dup.status).toBe(409);

    expect((await app.request('/api/portal/login', json('POST', { email: 'dana@acme.com', password: 'wrong' }))).status).toBe(401);
    const ok = await (await app.request('/api/portal/login', json('POST', { email: 'dana@acme.com', password: 'sup3rsecret' }))).json();
    expect(ok.contact.id).toBe(reg.contact.id);
  });

  it('rejects weak passwords and bad emails', async () => {
    const app = makeApp();
    expect((await app.request('/api/portal/register', json('POST', { name: 'A', email: 'a@b.com', password: 'short' }))).status).toBe(400);
    expect((await app.request('/api/portal/register', json('POST', { name: 'A', email: 'not-an-email', password: 'longenough' }))).status).toBe(400);
  });

  it('requires a valid token for /me', async () => {
    const app = makeApp();
    expect((await app.request('/api/portal/me')).status).toBe(401);
    expect((await app.request('/api/portal/me', auth('garbage.token'))).status).toBe(401);
    const reg = await register(app, 'Dana', 'dana@acme.com', 'sup3rsecret');
    const me = await (await app.request('/api/portal/me', auth(reg.token))).json();
    expect(me.email).toBe('dana@acme.com');
  });
});

describe('portal tickets', () => {
  it('scopes tickets to the signed-in customer', async () => {
    const app = makeApp();
    const a = await register(app, 'Alice', 'alice@x.com', 'passwordone');
    const b = await register(app, 'Bob', 'bob@x.com', 'passwordtwo');
    const at = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Alice issue', body: 'help me' }, a.token))).json();
    await app.request('/api/portal/tickets', json('POST', { subject: 'Bob issue', body: 'help me too' }, b.token));

    const aList = await (await app.request('/api/portal/tickets', auth(a.token))).json();
    expect(aList).toHaveLength(1);
    expect(aList[0].subject).toBe('Alice issue');

    // Bob cannot read Alice's ticket.
    expect((await app.request(`/api/portal/tickets/${at.ticket.id}`, auth(b.token))).status).toBe(404);
    expect((await app.request(`/api/portal/tickets/${at.ticket.id}`, auth(a.token))).status).toBe(200);
  });

  it('hides internal notes from the customer', async () => {
    const app = makeApp();
    const a = await register(app, 'Alice', 'alice@x.com', 'passwordone');
    const { ticket } = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Question', body: 'my question' }, a.token))).json();
    // An agent adds an internal note and a public reply.
    await app.request(`/api/tickets/${ticket.id}/messages`, json('POST', { kind: 'note', body: 'internal only — do not show' }));
    await app.request(`/api/tickets/${ticket.id}/messages`, json('POST', { kind: 'reply', body: 'Here is our answer' }));

    const detail = await (await app.request(`/api/portal/tickets/${ticket.id}`, auth(a.token))).json();
    const bodies = detail.messages.map((m: { body: string }) => m.body);
    expect(bodies).toContain('my question');
    expect(bodies).toContain('Here is our answer');
    expect(bodies).not.toContain('internal only — do not show');
    // Attribution is a friendly name, never the raw author id.
    expect(detail.messages.every((m: { authorName?: string }) => typeof m.authorName === 'string')).toBe(true);
  });

  it('a customer reply reopens a solved ticket', async () => {
    const app = makeApp();
    const a = await register(app, 'Alice', 'alice@x.com', 'passwordone');
    const { ticket } = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Q', body: 'q' }, a.token))).json();
    await app.request(`/api/tickets/${ticket.id}`, json('PATCH', { status: 'solved' }));

    const after = await (await app.request(`/api/portal/tickets/${ticket.id}/messages`, json('POST', { body: 'actually still broken' }, a.token))).json();
    expect(after.ticket.status).toBe('open');
    expect(after.ticket.resolvedAt).toBeNull();
  });
});

describe('portal profile', () => {
  it('updates the profile and changes the password', async () => {
    const app = makeApp();
    const a = await register(app, 'Alice', 'alice@x.com', 'passwordone');
    const updated = await (await app.request('/api/portal/me', json('PATCH', { name: 'Alice Cooper', company: 'Acme' }, a.token))).json();
    expect(updated.name).toBe('Alice Cooper');
    expect(updated.company).toBe('Acme');

    expect((await app.request('/api/portal/password', json('POST', { current: 'wrong', next: 'brandnewpass' }, a.token))).status).toBe(401);
    expect((await app.request('/api/portal/password', json('POST', { current: 'passwordone', next: 'brandnewpass' }, a.token))).status).toBe(200);
    // The old password no longer works; the new one does.
    expect((await app.request('/api/portal/login', json('POST', { email: 'alice@x.com', password: 'passwordone' }))).status).toBe(401);
    expect((await app.request('/api/portal/login', json('POST', { email: 'alice@x.com', password: 'brandnewpass' }))).status).toBe(200);
  });

  it('does not hand an existing contact (and its tickets) to whoever types the address', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const seeded = boot.contacts[0];
    // No email set up, so there is no way to prove the address: refused, no session.
    const res = await app.request('/api/portal/register', json('POST', { name: 'Mallory', email: seeded.email, password: 'claimthisaccount' }));
    expect(res.status).toBe(409);
    expect((await res.json()).token).toBeUndefined();
  });
});

describe('portal help center', () => {
  it('serves only published articles without auth', async () => {
    const app = makeApp();
    const kb = await (await app.request('/api/portal/kb')).json();
    expect(Array.isArray(kb)).toBe(true);
    expect(kb.every((a: { status: string }) => a.status === 'published')).toBe(true);
  });
});
