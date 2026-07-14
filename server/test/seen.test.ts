import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-seen-'))).app;
}

async function openTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets.find((t: { status: string }) => t.status !== 'closed').id;
}

describe('read receipts (seen)', () => {
  it('records the current agent as having seen the thread when messages are fetched', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    expect(await (await app.request(`/api/tickets/${tid}/seen`)).json()).toEqual([]); // nobody yet

    await app.request(`/api/tickets/${tid}/messages`); // opening the thread marks it seen by a_1
    const seen = await (await app.request(`/api/tickets/${tid}/seen`)).json();
    expect(seen).toHaveLength(1);
    expect(seen[0].viewerId).toBe('a_1');
    expect(seen[0].viewerKind).toBe('agent');
  });

  it('keeps one row per viewer, updating the timestamp on re-view', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    await app.request(`/api/tickets/${tid}/messages`);
    const first = (await (await app.request(`/api/tickets/${tid}/seen`)).json())[0].at as string;

    await app.request(`/api/tickets/${tid}/messages`); // view again
    const seen = await (await app.request(`/api/tickets/${tid}/seen`)).json();
    expect(seen).toHaveLength(1); // upsert, not a second row
    expect(seen[0].at >= first).toBe(true);
  });
});
