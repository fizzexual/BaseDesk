import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-followers-'))).app;
}

type App = ReturnType<typeof makeApp>;

async function openTicketId(app: App): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets.find((t: { status: string }) => t.status !== 'closed' && t.status !== 'solved').id;
}

const post = (app: App, url: string, body?: unknown) =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe('ticket followers', () => {
  it('follows and unfollows the current agent', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    expect(await (await app.request(`/api/tickets/${tid}/followers`)).json()).toEqual([]);

    const afterFollow = await (await post(app, `/api/tickets/${tid}/followers`)).json();
    expect(afterFollow).toHaveLength(1);
    expect(afterFollow[0].agentId).toBe('a_1');
    expect(typeof afterFollow[0].name).toBe('string');
    expect(afterFollow[0].name.length).toBeGreaterThan(0);

    // Following again is idempotent — still one row.
    expect(await (await post(app, `/api/tickets/${tid}/followers`)).json()).toHaveLength(1);

    const afterUnfollow = await (await app.request(`/api/tickets/${tid}/followers/a_1`, { method: 'DELETE' })).json();
    expect(afterUnfollow).toEqual([]);
  });

  it('adds a named teammate as a watcher', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    const list = await (await post(app, `/api/tickets/${tid}/followers`, { agentId: 'a_2' })).json();
    expect(list.some((f: { agentId: string }) => f.agentId === 'a_2')).toBe(true);
  });

  it('ignores an unknown agent id and follows the current agent instead', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    const list = await (await post(app, `/api/tickets/${tid}/followers`, { agentId: 'nope' })).json();
    expect(list.map((f: { agentId: string }) => f.agentId)).toEqual(['a_1']);
  });

  it('auto-follows the agent who replies to a ticket', async () => {
    const app = makeApp();
    const tid = await openTicketId(app);
    await post(app, `/api/tickets/${tid}/messages`, { kind: 'reply', body: 'Looking into it now.' });
    const followers = await (await app.request(`/api/tickets/${tid}/followers`)).json();
    expect(followers.some((f: { agentId: string }) => f.agentId === 'a_1')).toBe(true);
  });

  it('404s for a ticket that does not exist', async () => {
    const app = makeApp();
    expect((await app.request('/api/tickets/nope/followers')).status).toBe(404);
  });
});
