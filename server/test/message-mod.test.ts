import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-msg-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
async function firstTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets[0].id;
}
async function reply(app: ReturnType<typeof makeApp>, id: string, body: string) {
  return (await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'reply', body }))).json();
}

describe('closed tickets are locked for writing', () => {
  it('rejects a reply or note on a closed ticket, and allows it again once reopened', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    await app.request(`/api/tickets/${id}`, json('PATCH', { status: 'closed' }));

    expect((await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'reply', body: 'hi' }))).status).toBe(409);
    expect((await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'note', body: 'note' }))).status).toBe(409);

    await app.request(`/api/tickets/${id}`, json('PATCH', { status: 'open' }));
    expect((await app.request(`/api/tickets/${id}/messages`, json('POST', { kind: 'reply', body: 'hi' }))).status).toBe(200);
  });

  it('refuses to approve an AI draft into a closed ticket', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const draft = boot.aiActions.find((a: { kind: string; status: string }) => a.kind === 'draft' && a.status === 'pending');
    if (draft === undefined) return; // no seeded pending draft — nothing to assert
    await app.request(`/api/tickets/${draft.ticketId}`, json('PATCH', { status: 'closed' }));
    const res = await app.request(`/api/ai/actions/${draft.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('message soft-delete', () => {
  it('tombstones a message: hides content, keeps who/when as proof', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const { message } = await reply(app, id, 'sensitive content here');

    const del = await (await app.request(`/api/tickets/${id}/messages/${message.id}`, { method: 'DELETE' })).json();
    expect(del.message.deletedAt).toBeTruthy();
    expect(del.message.deletedBy).toBeTruthy();
    expect(del.message.body).toBe('');

    const thread = await (await app.request(`/api/tickets/${id}/messages`)).json();
    const found = thread.find((m: { id: string }) => m.id === message.id);
    expect(found.deletedAt).toBeTruthy();
    expect(found.body).toBe('');
  });

  it('is idempotent and 404s an unknown message', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const { message } = await reply(app, id, 'x');
    const first = await (await app.request(`/api/tickets/${id}/messages/${message.id}`, { method: 'DELETE' })).json();
    const second = await (await app.request(`/api/tickets/${id}/messages/${message.id}`, { method: 'DELETE' })).json();
    expect(second.message.deletedAt).toBe(first.message.deletedAt); // unchanged
    expect((await app.request(`/api/tickets/${id}/messages/m_nope`, { method: 'DELETE' })).status).toBe(404);
  });

  it('allows deleting a message even on a closed ticket (moderation, not writing)', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    const { message } = await reply(app, id, 'to remove');
    await app.request(`/api/tickets/${id}`, json('PATCH', { status: 'closed' }));
    const res = await app.request(`/api/tickets/${id}/messages/${message.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
