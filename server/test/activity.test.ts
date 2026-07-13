import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-activity-'))).app;
}
const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
type App = ReturnType<typeof makeApp>;
type Ev = { kind: string; actorId: string | null; actorName: string | null; detail: Record<string, unknown>; at: string };

async function aTicket(app: App): Promise<{ id: string; status: string; priority: string }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const t = boot.tickets.find((x: { status: string }) => x.status === 'open');
  return { id: t.id, status: t.status, priority: t.priority };
}
const events = async (app: App, id: string): Promise<Ev[]> => (await app.request(`/api/tickets/${id}/events`)).json();

describe('ticket activity log', () => {
  it('logs an event only for fields that actually change', async () => {
    const app = makeApp();
    const t = await aTicket(app);
    const newPriority = t.priority === 'low' ? 'high' : 'low'; // guaranteed to differ
    await app.request(`/api/tickets/${t.id}`, json('PATCH', { status: 'pending', priority: newPriority, tags: ['vip'] }));

    const evs = await events(app, t.id);
    const kinds = evs.map((e) => e.kind).sort();
    expect(kinds).toEqual(['priority', 'status', 'tags']);
    const status = evs.find((e) => e.kind === 'status')!;
    expect(status.detail).toEqual({ from: t.status, to: 'pending' });
    expect(status.actorName).toBe('Sam Reed'); // the admin actor, resolved live
    expect(evs.find((e) => e.kind === 'priority')!.detail).toEqual({ from: t.priority, to: newPriority });
    expect(evs.find((e) => e.kind === 'tags')!.detail.added).toEqual(['vip']);

    // A no-op patch (same status) adds nothing.
    await app.request(`/api/tickets/${t.id}`, json('PATCH', { status: 'pending' }));
    expect((await events(app, t.id)).length).toBe(evs.length);
  });

  it('records a merge on the source ticket', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const open = boot.tickets.filter((x: { status: string; mergedIntoId: string | null }) => x.status !== 'closed' && x.mergedIntoId === null);
    const src = open[0], dst = open[1];
    await app.request(`/api/tickets/${src.id}/merge`, json('POST', { into: dst.id }));
    const evs = await events(app, src.id);
    const merged = evs.find((e) => e.kind === 'merged');
    expect(merged).toBeDefined();
    expect(merged!.detail.targetNumber).toBe(dst.number);
  });

  it('records auto-assignment as a system (null-actor) event', async () => {
    const app = makeApp();
    await app.request('/api/settings/assignment', json('PUT', { enabled: true, strategy: 'round_robin' }));
    const boot = await (await app.request('/api/bootstrap')).json();
    const chat = boot.channels.find((c: { type: string }) => c.type === 'webchat');
    const res = await (await app.request(`/api/channels/${chat.id}/inbound?token=tok_webchat_3f9a2c81`, json('POST', { from: { email: 'act@example.com' }, body: 'hi' }))).json();
    const evs = await events(app, res.ticketId);
    const assign = evs.find((e) => e.kind === 'assignee');
    expect(assign).toBeDefined();
    expect(assign!.actorId).toBeNull(); // automation, not a person
    expect(assign!.detail.auto).toBe(true);
  });
});
