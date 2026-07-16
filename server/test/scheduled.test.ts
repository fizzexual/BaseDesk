import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getMessages } from '../src/db.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-sched-')));
}
type App = ReturnType<typeof makeApp>['app'];

async function firstOpenTicket(app: App): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets.find((t: { status: string; mergedIntoId: string | null }) => t.status !== 'closed' && t.mergedIntoId === null).id;
}
const schedule = (app: App, id: string, body: string, sendAt: string) =>
  app.request(`/api/tickets/${id}/schedule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'reply', body, sendAt }),
  });

describe('scheduled send', () => {
  it('queues, holds until due, then fires and empties the queue', async () => {
    const { app, db, flushScheduled } = makeApp();
    const id = await firstOpenTicket(app);
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const row = await (await schedule(app, id, 'Following up as promised', future)).json();
    expect(row.id).toMatch(/^sm_/);
    expect((await (await app.request(`/api/tickets/${id}/scheduled`)).json())).toHaveLength(1);

    // Not fired before its time.
    const before = getMessages(db, id).length;
    expect(flushScheduled(Date.now())).toBe(0);
    expect(getMessages(db, id).length).toBe(before);

    // Fired once the time passes; the row is gone.
    expect(flushScheduled(Date.parse(future) + 1_000)).toBe(1);
    expect(getMessages(db, id).some((m) => m.body === 'Following up as promised')).toBe(true);
    expect((await (await app.request(`/api/tickets/${id}/scheduled`)).json())).toHaveLength(0);
  });

  it('rejects a sendAt in the past', async () => {
    const { app } = makeApp();
    const id = await firstOpenTicket(app);
    expect((await schedule(app, id, 'x', new Date(Date.now() - 1_000).toISOString())).status).toBe(400);
  });

  it('cancels a scheduled message', async () => {
    const { app } = makeApp();
    const id = await firstOpenTicket(app);
    const row = await (await schedule(app, id, 'x', new Date(Date.now() + 3_600_000).toISOString())).json();
    await app.request(`/api/scheduled/${row.id}`, { method: 'DELETE' });
    expect((await (await app.request(`/api/tickets/${id}/scheduled`)).json())).toHaveLength(0);
  });
});
