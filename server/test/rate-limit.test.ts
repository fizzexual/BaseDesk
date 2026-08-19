import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { RateLimiter } from '../src/rate-limit.js';

// `now` is injected everywhere, so none of these depend on wall-clock timing.
describe('RateLimiter', () => {
  it('allows up to the limit, then refuses', () => {
    const rl = new RateLimiter(3, 60_000);
    expect(rl.check('k', 0).ok).toBe(true);
    expect(rl.check('k', 0).ok).toBe(true);
    expect(rl.check('k', 0)).toMatchObject({ ok: true, remaining: 0 });
    const blocked = rl.check('k', 0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(60);
  });

  it('starts a fresh window once the old one expires', () => {
    const rl = new RateLimiter(1, 1_000);
    expect(rl.check('k', 0).ok).toBe(true);
    expect(rl.check('k', 500).ok).toBe(false);
    expect(rl.check('k', 1_000).ok).toBe(true);
  });

  it('keeps callers independent, so one address cannot lock out another', () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.check('a', 0).ok).toBe(true);
    expect(rl.check('a', 0).ok).toBe(false);
    expect(rl.check('b', 0).ok).toBe(true);
  });

  it('forgets a caller after a success, so typos do not accumulate', () => {
    const rl = new RateLimiter(2, 60_000);
    rl.check('k', 0);
    rl.check('k', 0);
    rl.reset('k');
    expect(rl.check('k', 0).ok).toBe(true);
  });

  it('does not retain expired windows, so the map cannot grow without bound', () => {
    const rl = new RateLimiter(1, 1_000);
    for (let i = 0; i < 500; i++) rl.check(`ip-${i}`, 0);
    rl.check('sweep', 2_000); // any later call sweeps the expired entries first
    expect((rl as unknown as { hits: Map<string, unknown> }).hits.size).toBe(1);
  });
});

describe('credential endpoints are throttled', () => {
  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });

  it('stops an unbounded run of admin sign-in attempts', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-rl-')));
    let sawTooMany = false;
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/api/auth/login', json({ email: 'admin@x.test', password: `guess-${i}` }));
      if (res.status === 429) {
        expect(res.headers.get('Retry-After')).toBeTruthy();
        sawTooMany = true;
        break;
      }
      expect(res.status).toBe(401); // still rejected on the merits until then
    }
    expect(sawTooMany).toBe(true);
  });

  it('throttles portal sign-in on its own budget, separate from admin', async () => {
    const { app } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-rl2-')));
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/api/portal/login', json({ email: 'c@x.test', password: `guess-${i}` }));
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    // Admin sign-in has its own bucket, so the portal burst must not have spent it.
    const admin = await app.request('/api/auth/login', json({ email: 'admin@x.test', password: 'nope' }));
    expect(admin.status).toBe(401);
  });
});
