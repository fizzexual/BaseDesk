import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  const { app, db } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-perf-')));
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM tickets');
  return { app, db };
}
type App = ReturnType<typeof createApp>['app'];
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Perf = { agentId: string; solved: number; openLoad: number; firstReplyCount: number; medianFirstReplyMinutes: number; csatCount: number };

describe('agent performance', () => {
  it('attributes solved counts, open load, first replies, and CSAT per agent', async () => {
    const { app, db } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const me = boot.currentAgentId as string;
    const c = boot.contacts[0].id;

    // Ticket 1: assigned to me, I reply first, then it's solved and rated 5.
    const t1 = (await (await post(app, '/api/tickets', { subject: 'One', body: 'help', requesterId: c, priority: 'medium' })).json()).ticket;
    await patch(app, `/api/tickets/${t1.id}`, { assigneeId: me });
    await post(app, `/api/tickets/${t1.id}/messages`, { kind: 'reply', body: 'on it' });
    await patch(app, `/api/tickets/${t1.id}`, { status: 'solved' });
    db.prepare('UPDATE tickets SET satisfactionScore = 5 WHERE id = ?').run(t1.id);

    // Ticket 2: assigned to me but left open — counts toward open load, not solved.
    const t2 = (await (await post(app, '/api/tickets', { subject: 'Two', body: 'also help', requesterId: c, priority: 'high' })).json()).ticket;
    await patch(app, `/api/tickets/${t2.id}`, { assigneeId: me });

    const stats = await (await app.request('/api/stats')).json();
    const perf = (stats.perAgentPerformance as Perf[]).find((p) => p.agentId === me);
    expect(perf).toBeDefined();
    expect(perf!.solved).toBe(1);
    expect(perf!.openLoad).toBe(1);
    expect(perf!.firstReplyCount).toBe(1);
    expect(perf!.medianFirstReplyMinutes).toBeGreaterThanOrEqual(0);
    expect(perf!.csatCount).toBe(1);
    expect(perf!.csatAverage).toBe(5);
    // The most productive agent leads the sorted board.
    expect((stats.perAgentPerformance as Perf[])[0].agentId).toBe(me);
  });

  it('includes an entry for every agent, defaulting to zeros', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const stats = await (await app.request('/api/stats')).json();
    const perf = stats.perAgentPerformance as Perf[];
    expect(perf.length).toBe(boot.agents.length);
    // With no activity, everyone is at zero.
    expect(perf.every((p) => p.solved === 0 && p.openLoad === 0 && p.firstReplyCount === 0 && p.csatCount === 0)).toBe(true);
  });
});
