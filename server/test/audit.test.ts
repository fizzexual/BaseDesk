import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-audit-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Audit = { id: string; ticketId: string; kind: string; actorName: string | null; detail: Record<string, unknown>; at: string; ticketNumber: number; ticketSubject: string };

async function newTicket(app: App, subject: string): Promise<{ id: string; number: number }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const c = boot.contacts[0].id;
  return (await (await post(app, '/api/tickets', { subject, body: 'body', requesterId: c, priority: 'medium' })).json()).ticket;
}
const feed = async (app: App, qs = ''): Promise<Audit[]> => (await (await app.request(`/api/events${qs}`)).json()) as Audit[];

describe('audit log', () => {
  it('records a created event carrying the ticket number, subject, and actor', async () => {
    const app = makeApp();
    const t = await newTicket(app, 'Audit me');
    const mine = (await feed(app)).filter((e) => e.ticketId === t.id);
    const created = mine.find((e) => e.kind === 'created');
    expect(created).toBeDefined();
    expect(created!.ticketNumber).toBe(t.number);
    expect(created!.ticketSubject).toBe('Audit me');
    expect(created!.actorName).toBeTruthy(); // resolved from the acting agent
  });

  it('is newest-first: a later status change sorts above the created event', async () => {
    const app = makeApp();
    const t = await newTicket(app, 'Order');
    await patch(app, `/api/tickets/${t.id}`, { status: 'solved' });
    const mine = (await feed(app)).filter((e) => e.ticketId === t.id);
    const statusIdx = mine.findIndex((e) => e.kind === 'status');
    const createdIdx = mine.findIndex((e) => e.kind === 'created');
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(createdIdx).toBeGreaterThan(statusIdx); // created is older → lower in the newest-first feed
    expect(mine[statusIdx].detail.to).toBe('solved');
  });

  it('records a link event with the target number and link type', async () => {
    const app = makeApp();
    const a = await newTicket(app, 'A');
    const b = await newTicket(app, 'B');
    await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: b.id, type: 'blocks' });
    const link = (await feed(app)).find((e) => e.ticketId === a.id && e.kind === 'link');
    expect(link).toBeDefined();
    expect(link!.detail.targetNumber).toBe(b.number);
    expect(link!.detail.linkType).toBe('blocks');
  });

  it('honors the limit query param', async () => {
    const app = makeApp();
    await newTicket(app, 'x');
    const two = await feed(app, '?limit=2');
    expect(two.length).toBeGreaterThanOrEqual(1);
    expect(two.length).toBeLessThanOrEqual(2);
  });
});
