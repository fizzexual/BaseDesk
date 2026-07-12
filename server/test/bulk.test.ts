import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-bulk-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const ticketsOf = async (app: ReturnType<typeof makeApp>) => (await (await app.request('/api/bootstrap')).json()).tickets;

interface T { id: string; status: string; assigneeId: string | null; tags: string[]; resolvedAt: string | null }

describe('bulk ticket patch', () => {
  it('applies a uniform patch to many tickets and stamps resolvedAt', async () => {
    const app = makeApp();
    const ids = (await ticketsOf(app)).slice(0, 3).map((t: T) => t.id);
    const res = await (await app.request('/api/tickets', json('PATCH', { ids, patch: { status: 'solved' } }))).json();
    expect(res.updated).toHaveLength(3);
    expect(res.updated.every((t: T) => t.status === 'solved' && t.resolvedAt !== null)).toBe(true);
  });

  it('assigns many tickets at once', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const agentId = boot.agents[0].id;
    const ids = boot.tickets.slice(0, 2).map((t: T) => t.id);
    const res = await (await app.request('/api/tickets', json('PATCH', { ids, patch: { assigneeId: agentId } }))).json();
    expect(res.updated.every((t: T) => t.assigneeId === agentId)).toBe(true);
  });

  it('unions addTags per ticket, keeping existing tags and avoiding duplicates', async () => {
    const app = makeApp();
    const all = await ticketsOf(app);
    const t: T = all.find((x: T) => x.tags.length > 0) ?? all[0];
    const existing = t.tags[0];
    const res = await (await app.request('/api/tickets', json('PATCH', { ids: [t.id], patch: {}, addTags: ['vip', ...(existing ? [existing] : [])] }))).json();
    const after: string[] = res.updated[0].tags;
    expect(after).toContain('vip');
    for (const tag of t.tags) expect(after).toContain(tag);
    expect(new Set(after).size).toBe(after.length);
  });

  it('rejects an invalid status and empty ids', async () => {
    const app = makeApp();
    const first = (await ticketsOf(app))[0].id;
    expect((await app.request('/api/tickets', json('PATCH', { ids: [first], patch: { status: 'wat' } }))).status).toBe(400);
    expect((await app.request('/api/tickets', json('PATCH', { ids: [], patch: { status: 'solved' } }))).status).toBe(400);
  });

  it('skips ids that do not exist without failing', async () => {
    const app = makeApp();
    const real = (await ticketsOf(app))[0].id;
    const res = await (await app.request('/api/tickets', json('PATCH', { ids: [real, 't_missing'], patch: { priority: 'high' } }))).json();
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0].id).toBe(real);
  });
});
