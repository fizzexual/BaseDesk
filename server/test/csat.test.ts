import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-csat-'))).app;
}
// Aggregate-stats tests need a clean CSAT baseline; the demo seed now ships
// ratings, so this returns an app whose seeded ratings have been cleared.
function makeAppNoRatings() {
  const { app, db } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-csat-')));
  db.exec('UPDATE tickets SET satisfactionScore = NULL, satisfactionComment = NULL, satisfactionAt = NULL');
  return app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const authed = (method: string, token: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function portalToken(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
  const r = await (await app.request('/api/portal/register', json('POST', { name: 'Ada', email, password: 'password123' }))).json();
  return r.token as string;
}
async function solvedTicket(app: ReturnType<typeof makeApp>, token: string): Promise<string> {
  const { ticket } = await (await app.request('/api/portal/tickets', authed('POST', token, { subject: 'Help', body: 'hi', priority: 'medium' }))).json();
  await app.request(`/api/tickets/${ticket.id}`, json('PATCH', { status: 'solved' }));
  return ticket.id;
}

describe('CSAT rating', () => {
  it('records a rating on a solved ticket and reports it in stats', async () => {
    const app = makeAppNoRatings();
    const token = await portalToken(app, 'ada@example.com');
    const id = await solvedTicket(app, token);

    const rated = await (await app.request(`/api/portal/tickets/${id}/rating`, authed('POST', token, { score: 5, comment: 'Fast and kind!' }))).json();
    expect(rated.ticket.satisfactionScore).toBe(5);
    expect(rated.ticket.satisfactionComment).toBe('Fast and kind!');
    expect(rated.ticket.satisfactionAt).toBeTruthy();

    const stats = await (await app.request('/api/stats')).json();
    expect(stats.csat.count).toBe(1);
    expect(stats.csat.average).toBe(5);
    expect(stats.csat.positivePct).toBe(100);
  });

  it('refuses a rating until the ticket is solved', async () => {
    const app = makeApp();
    const token = await portalToken(app, 'ada@example.com');
    const { ticket } = await (await app.request('/api/portal/tickets', authed('POST', token, { subject: 'Open one', body: 'hi', priority: 'low' }))).json();
    const res = await app.request(`/api/portal/tickets/${ticket.id}/rating`, authed('POST', token, { score: 4 }));
    expect(res.status).toBe(409);
  });

  it('rejects an out-of-range or fractional score', async () => {
    const app = makeApp();
    const token = await portalToken(app, 'ada@example.com');
    const id = await solvedTicket(app, token);
    for (const score of [0, 6, 3.5, -1]) {
      expect((await app.request(`/api/portal/tickets/${id}/rating`, authed('POST', token, { score }))).status).toBe(400);
    }
  });

  it("won't let a customer rate someone else's ticket", async () => {
    const app = makeApp();
    const owner = await portalToken(app, 'owner@example.com');
    const id = await solvedTicket(app, owner);
    const other = await portalToken(app, 'other@example.com');
    const res = await app.request(`/api/portal/tickets/${id}/rating`, authed('POST', other, { score: 1 }));
    expect(res.status).toBe(404);
  });

  it('averages mixed ratings and computes the positive share', async () => {
    const app = makeAppNoRatings();
    const token = await portalToken(app, 'ada@example.com');
    for (const score of [5, 4, 2]) {
      const id = await solvedTicket(app, token);
      await app.request(`/api/portal/tickets/${id}/rating`, authed('POST', token, { score }));
    }
    const stats = await (await app.request('/api/stats')).json();
    expect(stats.csat.count).toBe(3);
    expect(stats.csat.average).toBeCloseTo(3.7, 1); // (5+4+2)/3
    expect(stats.csat.positivePct).toBe(67); // 2 of 3 are >= 4
  });
});
