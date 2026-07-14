import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-tasks-'))).app;
}
type App = ReturnType<typeof makeApp>;

const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function freshTicketId(app: App): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const res = await post(app, '/api/tickets', { subject: 'Task test', body: 'x', requesterId: boot.contacts[0].id, priority: 'medium' });
  const d = (await res.json()) as { ticket?: { id: string }; id?: string };
  return d.ticket?.id ?? (d.id as string);
}

type Task = { id: string; title: string; done: boolean; doneAt: string | null; position: number };

describe('ticket checklist', () => {
  it('adds, toggles, renames, and removes tasks', async () => {
    const app = makeApp();
    const tid = await freshTicketId(app);
    expect(await (await app.request(`/api/tickets/${tid}/tasks`)).json()).toEqual([]);

    await post(app, `/api/tickets/${tid}/tasks`, { title: 'Verify identity' });
    const list = (await (await post(app, `/api/tickets/${tid}/tasks`, { title: 'Issue refund' })).json()) as Task[];
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.position)).toEqual([0, 1]);
    expect(list[0].done).toBe(false);

    const first = list[0];
    const toggled = (await (await patch(app, `/api/tickets/${tid}/tasks/${first.id}`, { done: true })).json()) as Task[];
    const t1 = toggled.find((t) => t.id === first.id)!;
    expect(t1.done).toBe(true);
    expect(t1.doneAt).toBeTruthy();

    const renamed = (await (await patch(app, `/api/tickets/${tid}/tasks/${first.id}`, { title: 'Verify customer identity' })).json()) as Task[];
    expect(renamed.find((t) => t.id === first.id)!.title).toBe('Verify customer identity');

    const afterDelete = (await (await app.request(`/api/tickets/${tid}/tasks/${first.id}`, { method: 'DELETE' })).json()) as Task[];
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete.some((t) => t.id === first.id)).toBe(false);
  });

  it('rejects an empty title', async () => {
    const app = makeApp();
    const tid = await freshTicketId(app);
    expect((await post(app, `/api/tickets/${tid}/tasks`, { title: '   ' })).status).toBe(400);
  });

  it('404s when the task does not belong to the ticket', async () => {
    const app = makeApp();
    const tid = await freshTicketId(app);
    const list = (await (await post(app, `/api/tickets/${tid}/tasks`, { title: 'A' })).json()) as Task[];
    expect((await patch(app, `/api/tickets/nope/tasks/${list[0].id}`, { done: true })).status).toBe(404);
  });
});
