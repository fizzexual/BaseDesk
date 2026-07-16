import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { randomTotpSecret, totpCode, verifyTotp } from '../src/auth.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-auth-')));
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

describe('TOTP', () => {
  it('accepts a fresh code and rejects a wrong one', () => {
    const secret = randomTotpSecret();
    expect(verifyTotp(secret, totpCode(secret, Date.now()), Date.now())).toBe(true);
    expect(verifyTotp(secret, '000000', Date.now())).toBe(false);
  });
});

describe('admin auth (opt-in)', () => {
  it('is off by default — the app is open, and bootstrap reports it', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.auth.enabled).toBe(false);
    expect(boot.auth.hasPassword).toBe(false);
  });

  it('refuses to enable login until a password is set (no lockout)', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/settings/auth', json('PUT', { enabled: true }))).status).toBe(400);
  });

  it('gates admin endpoints once enabled, and a valid login opens them', async () => {
    const { app } = makeApp();
    const email = await adminEmail(app);
    await app.request('/api/auth/password', json('POST', { password: 'hunter2!!' })); // sets the current (first admin) password
    expect((await app.request('/api/settings/auth', json('PUT', { enabled: true }))).status).toBe(200);

    // Now bootstrap is protected.
    expect((await app.request('/api/bootstrap')).status).toBe(401);

    // Wrong password is rejected.
    expect((await app.request('/api/auth/login', json('POST', { email, password: 'nope' }))).status).toBe(401);

    // Correct login yields a token that opens the gate.
    const login = await (await app.request('/api/auth/login', json('POST', { email, password: 'hunter2!!' }))).json();
    expect(typeof login.token).toBe('string');
    const boot = await app.request('/api/bootstrap', { headers: { authorization: `Bearer ${login.token}` } });
    expect(boot.status).toBe(200);
  });

  it('enforces two-factor when enabled', async () => {
    const { app } = makeApp();
    const email = await adminEmail(app);
    await app.request('/api/auth/password', json('POST', { password: 'hunter2!!' }));
    const setup = await (await app.request('/api/auth/2fa/setup', json('POST', {}))).json();
    await app.request('/api/auth/2fa/enable', json('POST', { code: totpCode(setup.secret, Date.now()) }));
    await app.request('/api/settings/auth', json('PUT', { enabled: true }));

    // Password alone is refused with a 2FA hint.
    const noCode = await app.request('/api/auth/login', json('POST', { email, password: 'hunter2!!' }));
    expect(noCode.status).toBe(401);
    expect((await noCode.json()).needs2fa).toBe(true);

    // Password + a valid code succeeds.
    const ok = await app.request('/api/auth/login', json('POST', { email, password: 'hunter2!!', code: totpCode(setup.secret, Date.now()) }));
    expect(ok.status).toBe(200);
  });
});
