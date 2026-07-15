import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-split-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

type Msg = { id: string };
type Link = { ticketId: string; type: string };

async function setup(app: App): Promise<{ t: { id: string; number: number }; msgs: Msg[] }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const c = boot.contacts[0].id;
  const t = (await (await post(app, '/api/tickets', { subject: 'Two issues', body: 'first issue', requesterId: c, priority: 'high' })).json()).ticket;
  await post(app, `/api/tickets/${t.id}/messages`, { kind: 'reply', body: 'second issue detail' });
  await post(app, `/api/tickets/${t.id}/messages`, { kind: 'reply', body: 'more on the second issue' });
  const msgs = (await (await app.request(`/api/tickets/${t.id}/messages`)).json()) as Msg[];
  return { t, msgs };
}

describe('split ticket', () => {
  it('moves selected messages into a new related ticket', async () => {
    const app = makeApp();
    const { t, msgs } = await setup(app);
    const moveId = msgs[msgs.length - 1].id;

    const res = await post(app, `/api/tickets/${t.id}/split`, { subject: 'Second issue', messageIds: [moveId] });
    expect(res.status).toBe(200);
    const { source, created } = await res.json();
    expect(created.subject).toBe('Second issue');
    expect(created.number).toBeGreaterThan(t.number);
    expect(created.priority).toBe('high'); // inherited from the source
    expect(source.id).toBe(t.id);

    const createdMsgs = (await (await app.request(`/api/tickets/${created.id}/messages`)).json()) as Msg[];
    const sourceMsgs = (await (await app.request(`/api/tickets/${t.id}/messages`)).json()) as Msg[];
    expect(createdMsgs.map((m) => m.id)).toEqual([moveId]);
    expect(sourceMsgs).toHaveLength(msgs.length - 1);
    expect(sourceMsgs.find((m) => m.id === moveId)).toBeUndefined();
  });

  it('links the two halves as related, from both sides', async () => {
    const app = makeApp();
    const { t, msgs } = await setup(app);
    const { created } = await (await post(app, `/api/tickets/${t.id}/split`, { subject: 'X', messageIds: [msgs[0].id] })).json();
    const sLinks = (await (await app.request(`/api/tickets/${t.id}/links`)).json()) as Link[];
    const cLinks = (await (await app.request(`/api/tickets/${created.id}/links`)).json()) as Link[];
    expect(sLinks).toHaveLength(1);
    expect(sLinks[0]).toMatchObject({ ticketId: created.id, type: 'related' });
    expect(cLinks[0]).toMatchObject({ ticketId: t.id, type: 'related' });
  });

  it('logs a split event on the source and a created event on the new ticket', async () => {
    const app = makeApp();
    const { t, msgs } = await setup(app);
    const { created } = await (await post(app, `/api/tickets/${t.id}/split`, { subject: 'X', messageIds: [msgs[0].id] })).json();
    const feed = (await (await app.request('/api/events')).json()) as { ticketId: string; kind: string; detail: Record<string, unknown> }[];
    const split = feed.find((e) => e.ticketId === t.id && e.kind === 'split');
    expect(split).toBeDefined();
    expect(split!.detail.targetNumber).toBe(created.number);
    expect(split!.detail.count).toBe(1);
    expect(feed.find((e) => e.ticketId === created.id && e.kind === 'created')).toBeDefined();
  });

  it('rejects empty subject, no messages, foreign messages, splitting everything, and unknown tickets', async () => {
    const app = makeApp();
    const { t, msgs } = await setup(app);
    const allIds = msgs.map((m) => m.id);
    expect((await post(app, `/api/tickets/${t.id}/split`, { subject: '', messageIds: [msgs[0].id] })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/split`, { subject: 'x', messageIds: [] })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/split`, { subject: 'x', messageIds: ['nope'] })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/split`, { subject: 'x', messageIds: allIds })).status).toBe(400);
    expect((await post(app, '/api/tickets/unknown/split', { subject: 'x', messageIds: [msgs[0].id] })).status).toBe(404);
  });
});
