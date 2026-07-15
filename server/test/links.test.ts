import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-links-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

type Link = { linkId: string; ticketId: string; type: string };

async function twoTickets(app: App) {
  const boot = await (await app.request('/api/bootstrap')).json();
  const c = boot.contacts[0].id;
  const a = (await (await post(app, '/api/tickets', { subject: 'A', body: 'a', requesterId: c, priority: 'medium' })).json()).ticket;
  const b = (await (await post(app, '/api/tickets', { subject: 'B', body: 'b', requesterId: c, priority: 'medium' })).json()).ticket;
  return { a, b } as { a: { id: string }; b: { id: string } };
}

describe('ticket links', () => {
  it('links two tickets and shows the inverse from the other side, then removes', async () => {
    const app = makeApp();
    const { a, b } = await twoTickets(app);

    const aLinks = (await (await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: b.id, type: 'blocks' })).json()) as Link[];
    expect(aLinks).toHaveLength(1);
    expect(aLinks[0].type).toBe('blocks');
    expect(aLinks[0].ticketId).toBe(b.id);

    // The inverse is visible on B.
    const bLinks = (await (await app.request(`/api/tickets/${b.id}/links`)).json()) as Link[];
    expect(bLinks).toHaveLength(1);
    expect(bLinks[0].type).toBe('blocked_by');
    expect(bLinks[0].ticketId).toBe(a.id);

    const after = (await (await app.request(`/api/tickets/${a.id}/links/${aLinks[0].linkId}`, { method: 'DELETE' })).json()) as Link[];
    expect(after).toHaveLength(0);
    expect((await (await app.request(`/api/tickets/${b.id}/links`)).json()) as Link[]).toHaveLength(0);
  });

  it('normalizes blocked_by from the adding ticket', async () => {
    const app = makeApp();
    const { a, b } = await twoTickets(app);
    const aLinks = (await (await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: b.id, type: 'blocked_by' })).json()) as Link[];
    expect(aLinks[0].type).toBe('blocked_by');
    const bLinks = (await (await app.request(`/api/tickets/${b.id}/links`)).json()) as Link[];
    expect(bLinks[0].type).toBe('blocks');
  });

  it('rejects self-links, unknown tickets, and duplicates', async () => {
    const app = makeApp();
    const { a, b } = await twoTickets(app);
    expect((await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: a.id, type: 'related' })).status).toBe(400);
    expect((await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: 'nope', type: 'related' })).status).toBe(400);
    expect((await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: b.id, type: 'bogus' })).status).toBe(400);
    await post(app, `/api/tickets/${a.id}/links`, { linkedTicketId: b.id, type: 'related' });
    // Already linked (either direction) → 409.
    expect((await post(app, `/api/tickets/${b.id}/links`, { linkedTicketId: a.id, type: 'related' })).status).toBe(409);
  });
});
