import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

// Security finding #1: a fresh install used to run with login off and a fixed, public
// demo seed, so the first stranger to reach it could set the admin password and lock the
// owner out. Production mode must be closed from the first request.

const dir = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const post = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const admin = { name: 'Owner', email: 'owner@example.com', password: 'correct horse battery' };

describe('production first run', () => {
  it('needs login from the first request and refuses the old takeover route', async () => {
    const { app, setupToken } = createApp(dir('bd-fr1-'), { production: true });
    expect(setupToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect((await app.request('/api/bootstrap')).status).toBe(401);
    // The pre-fix takeover: set a password as "the first admin", then turn login on.
    expect((await app.request('/api/auth/password', post({ password: 'attacker-pass' }))).status).toBe(401);
    expect((await app.request('/api/settings/auth', { ...post({ enabled: false }), method: 'PUT' })).status).toBe(401);
    expect(await (await app.request('/api/setup')).json()).toEqual({ needed: true });
  });

  it('loads no demo data unless asked', async () => {
    const { db } = createApp(dir('bd-fr2-'), { production: true });
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(n('tickets')).toBe(0);
    expect(n('contacts')).toBe(0);
    expect(n('channels')).toBe(0);
    expect(n('agents')).toBe(1); // the admin seat setup claims
  });

  it('refuses a wrong setup token, then lets the operator claim the admin with the right one', async () => {
    const { app, setupToken } = createApp(dir('bd-fr3-'), { production: true });
    expect((await app.request('/api/setup', post({ ...admin, token: 'wrong' }))).status).toBe(401);
    expect((await app.request('/api/setup', post({ ...admin, token: setupToken, password: 'short' }))).status).toBe(400);
    const res = await app.request('/api/setup', post({ ...admin, token: setupToken }));
    expect(res.status).toBe(200);
    const { token, agent } = await res.json();
    expect(agent).toMatchObject({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    expect((await app.request('/api/bootstrap', auth(token))).status).toBe(200);
    // Done once: a second claim (someone else who saw the token) is refused.
    expect((await app.request('/api/setup', post({ ...admin, email: 'x@example.com', token: setupToken }))).status).toBe(409);
    expect(await (await app.request('/api/setup')).json()).toEqual({ needed: false });
    // And sign-in works with the new account.
    expect((await app.request('/api/auth/login', post({ email: admin.email, password: admin.password }))).status).toBe(200);
  });

  it('cannot switch login off in production', async () => {
    const { app, setupToken } = createApp(dir('bd-fr4-'), { production: true });
    const { token } = await (await app.request('/api/setup', post({ ...admin, token: setupToken }))).json();
    const res = await app.request('/api/settings/auth', { ...post({ enabled: false }, token), method: 'PUT' });
    expect(res.status).toBe(400);
    expect((await app.request('/api/bootstrap')).status).toBe(401);
  });

  it('a production demo gets fresh channel tokens, never the published seed ones', async () => {
    const { db } = createApp(dir('bd-fr5-'), { production: true, demo: true });
    const tokens = (db.prepare('SELECT inboundToken FROM channels').all() as { inboundToken: string }[]).map((r) => r.inboundToken);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).not.toContain('tok_webchat_3f9a2c81');
    for (const t of tokens) expect(t).toMatch(/^tok_[0-9a-f]{32}$/);
  });

  it('restarting a set-up desk does not offer setup again or re-seed', async () => {
    const d = dir('bd-fr6-');
    const first = createApp(d, { production: true });
    await first.app.request('/api/setup', post({ ...admin, token: first.setupToken }));
    first.db.close();
    const second = createApp(d, { production: true });
    expect(second.setupToken).toBeNull();
    expect((second.db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n).toBe(1);
  });

  it('dev and test mode keep the open demo desk (no setup)', async () => {
    const { app, setupToken } = createApp(dir('bd-fr7-'));
    expect(setupToken).toBeNull();
    expect((await app.request('/api/bootstrap')).status).toBe(200);
  });
});

describe('admin sessions expire and can be revoked (finding #9)', () => {
  async function signedIn() {
    const { app, setupToken } = createApp(dir('bd-sess-'), { production: true });
    const { token } = await (await app.request('/api/setup', post({ ...admin, token: setupToken }))).json();
    return { app, token: token as string };
  }

  it('sign-out kills the token on every device', async () => {
    const { app, token } = await signedIn();
    const other = (await (await app.request('/api/auth/login', post({ email: admin.email, password: admin.password }))).json()).token;
    expect((await app.request('/api/auth/logout', post({}, token))).status).toBe(200);
    expect((await app.request('/api/bootstrap', auth(token))).status).toBe(401);
    expect((await app.request('/api/bootstrap', auth(other))).status).toBe(401);
  });

  it('a password change revokes older tokens and hands this tab a fresh one', async () => {
    const { app, token } = await signedIn();
    const res = await app.request('/api/auth/password', post({ password: 'a brand new password' }, token));
    expect(res.status).toBe(200);
    const fresh = (await res.json()).token;
    expect((await app.request('/api/bootstrap', auth(token))).status).toBe(401);
    expect((await app.request('/api/bootstrap', auth(fresh))).status).toBe(200);
  });

  it('a token past its expiry is refused', async () => {
    const { app, token } = await signedIn();
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 15 * 24 * 60 * 60 * 1000; // 15 days later; sessions last 14
      expect((await app.request('/api/bootstrap', auth(token))).status).toBe(401);
    } finally {
      Date.now = realNow;
    }
  });

  it('a forged or old-format token (bare agent id) is refused', async () => {
    const { app } = await signedIn();
    expect((await app.request('/api/bootstrap', auth('a_1.deadbeef'))).status).toBe(401);
  });
});
