import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getNotifications } from '../src/db.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-notif-')));
}
const note = (body: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'note', body }),
});
const reply = (body: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'reply', body }),
});

async function openTicketId(app: ReturnType<typeof makeApp>['app']): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets.find((t: { status: string }) => t.status !== 'closed').id;
}

type App = ReturnType<typeof makeApp>['app'];
const authJson = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

/** A customer opens a ticket via the portal (a "web" channel), returning its id + the auth token. */
async function portalTicket(app: App, email: string): Promise<{ id: string; token: string }> {
  const reg = await (await app.request('/api/portal/register', authJson({ name: 'Ada Lovelace', email, password: 'hunter2!' }))).json();
  const created = await (await app.request('/api/portal/tickets', authJson({ subject: 'Broken', body: 'It broke' }, reg.token))).json();
  return { id: created.ticket.id, token: reg.token };
}
const assign = (id: string) => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assigneeId: id }) });

describe('@mention notifications', () => {
  it('creates a notification for a teammate mentioned in a note', async () => {
    const { app, db } = makeApp();
    const tid = await openTicketId(app);
    await app.request(`/api/tickets/${tid}/messages`, note('Hey @Priya, can you take this one?'));

    // Priya is a_2; the author (admin Sam, a_1) is never notified of their own note.
    const forPriya = getNotifications(db, 'a_2');
    expect(forPriya.length).toBeGreaterThanOrEqual(1);
    const n = forPriya[0];
    expect(n.actorId).toBe('a_1');
    expect(n.actorName).toBe('Sam Reed');
    expect(n.ticketId).toBe(tid);
    expect(n.snippet).toContain('@Priya');
    expect(n.readAt).toBeNull();
  });

  it('does not notify on a public reply, only on notes', async () => {
    const { app, db } = makeApp();
    const tid = await openTicketId(app);
    const before = getNotifications(db, 'a_2').length;
    await app.request(`/api/tickets/${tid}/messages`, reply('Thanks @Priya!'));
    expect(getNotifications(db, 'a_2').length).toBe(before);
  });

  it('never notifies the author of their own mention', async () => {
    const { app, db } = makeApp();
    const tid = await openTicketId(app);
    const before = getNotifications(db, 'a_1').length;
    await app.request(`/api/tickets/${tid}/messages`, note('Note to self @Sam — follow up tomorrow.'));
    expect(getNotifications(db, 'a_1').length).toBe(before);
  });

  it("notifies a ticket's assignee when their customer replies, tagged with the source channel", async () => {
    const { app, db } = makeApp();
    const { id, token } = await portalTicket(app, 'ada@example.com');
    await app.request(`/api/tickets/${id}`, assign('a_2')); // assign to Priya

    const before = getNotifications(db, 'a_2').length;
    await app.request(`/api/portal/tickets/${id}/messages`, authJson({ body: 'Any update on this?' }, token));

    const after = getNotifications(db, 'a_2');
    expect(after.length).toBe(before + 1);
    const n = after[0];
    expect(n.kind).toBe('reply');
    expect(n.actorName).toBe('Ada Lovelace'); // the customer, not an agent
    expect(n.channel).toBe('web');
    expect(n.ticketId).toBe(id);
    expect(n.snippet).toContain('Any update');
    expect(n.readAt).toBeNull();
  });

  it('does not notify on a customer reply to an unassigned ticket', async () => {
    const { app, db } = makeApp();
    const { id, token } = await portalTicket(app, 'ada@example.com');
    await app.request(`/api/tickets/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assigneeId: null }) });

    const a1 = getNotifications(db, 'a_1').length;
    const a2 = getNotifications(db, 'a_2').length;
    await app.request(`/api/portal/tickets/${id}/messages`, authJson({ body: 'Still waiting.' }, token));
    expect(getNotifications(db, 'a_1').length).toBe(a1);
    expect(getNotifications(db, 'a_2').length).toBe(a2);
  });

  it('serves the current agent their notifications and marks them read', async () => {
    const { app } = makeApp();
    // The seed ships two mention notifications for the admin (one unread, one read).
    let list = await (await app.request('/api/notifications')).json();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const unread = () => list.filter((n: { readAt: string | null }) => n.readAt === null);
    const firstUnread = unread()[0];
    expect(firstUnread).toBeDefined();

    // Mark just that one read.
    list = await (
      await app.request('/api/notifications/read', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: firstUnread.id }),
      })
    ).json();
    expect(list.find((n: { id: string }) => n.id === firstUnread.id).readAt).not.toBeNull();

    // Mark all read (empty body).
    list = await (await app.request('/api/notifications/read', { method: 'POST' })).json();
    expect(list.every((n: { readAt: string | null }) => n.readAt !== null)).toBe(true);
  });
});
