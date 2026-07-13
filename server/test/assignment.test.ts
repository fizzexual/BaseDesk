import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getTicket } from '../src/db.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-assign-')));
}
const put = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function inbound(app: ReturnType<typeof makeApp>['app'], chId: string, token: string, email: string): Promise<string> {
  const res = await (await app.request(`/api/channels/${chId}/inbound?token=${token}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: { email }, body: 'help please' }),
  })).json();
  return res.ticketId as string;
}

async function webchat(app: ReturnType<typeof makeApp>['app']): Promise<{ id: string; token: string; active: string[] }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const ch = boot.channels.find((c: { type: string }) => c.type === 'webchat');
  const active = boot.agents.filter((a: { status: string }) => a.status === 'active').map((a: { id: string }) => a.id);
  return { id: ch.id, token: 'tok_webchat_3f9a2c81', active };
}

describe('auto-assignment', () => {
  it('leaves new tickets unassigned when disabled (the default)', async () => {
    const { app, db } = makeApp();
    const { id, token } = await webchat(app);
    const tid = await inbound(app, id, token, 'off@example.com');
    expect(getTicket(db, tid)?.assigneeId).toBeNull();
  });

  it('round-robins new tickets across the active pool, then wraps', async () => {
    const { app, db } = makeApp();
    const { id, token, active } = await webchat(app);
    expect((await app.request('/api/settings/assignment', put({ enabled: true, strategy: 'round_robin' }))).status).toBe(200);

    const assignees: (string | null)[] = [];
    for (let i = 0; i <= active.length; i++) {
      const tid = await inbound(app, id, token, `rr${i}@example.com`);
      assignees.push(getTicket(db, tid)?.assigneeId ?? null);
    }
    expect(assignees).toEqual([...active, active[0]]); // cycles the pool, then wraps to the first
  });

  it('least-busy picks an active agent', async () => {
    const { app, db } = makeApp();
    const { id, token, active } = await webchat(app);
    await app.request('/api/settings/assignment', put({ enabled: true, strategy: 'least_busy' }));
    const tid = await inbound(app, id, token, 'lb@example.com');
    const assignee = getTicket(db, tid)?.assigneeId;
    expect(assignee).not.toBeNull();
    expect(active).toContain(assignee);
  });

  it('validates the settings payload and ships them in bootstrap', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/settings/assignment', put({ enabled: 'yes', strategy: 'round_robin' }))).status).toBe(400);
    expect((await app.request('/api/settings/assignment', put({ enabled: true, strategy: 'nope' }))).status).toBe(400);
    await app.request('/api/settings/assignment', put({ enabled: true, strategy: 'least_busy' }));
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.assignment).toEqual({ enabled: true, strategy: 'least_busy' });
  });
});
