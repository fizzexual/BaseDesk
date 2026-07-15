import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-side-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

type Convo = { id: string; subject: string; participant: string | null; messages: { body: string; authorName: string | null }[] };

async function ticket(app: App): Promise<{ id: string }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const c = boot.contacts[0].id;
  return (await (await post(app, '/api/tickets', { subject: 'A', body: 'b', requesterId: c, priority: 'medium' })).json()).ticket;
}

describe('side conversations', () => {
  it('creates a side conversation with a first message and resolved author', async () => {
    const app = makeApp();
    const t = await ticket(app);
    const list = (await (await post(app, `/api/tickets/${t.id}/side-conversations`, {
      subject: 'Ask engineering', participant: 'Engineering', body: 'Is the DB migration done?',
    })).json()) as Convo[];
    expect(list).toHaveLength(1);
    expect(list[0].subject).toBe('Ask engineering');
    expect(list[0].participant).toBe('Engineering');
    expect(list[0].messages).toHaveLength(1);
    expect(list[0].messages[0].body).toBe('Is the DB migration done?');
    expect(list[0].messages[0].authorName).toBeTruthy();
  });

  it('appends messages in order', async () => {
    const app = makeApp();
    const t = await ticket(app);
    const list = (await (await post(app, `/api/tickets/${t.id}/side-conversations`, { subject: 'Vendor', body: 'first' })).json()) as Convo[];
    const after = (await (await post(app, `/api/tickets/${t.id}/side-conversations/${list[0].id}/messages`, { body: 'second' })).json()) as Convo[];
    expect(after[0].messages.map((m) => m.body)).toEqual(['first', 'second']);
  });

  it('allows a conversation with no opening message', async () => {
    const app = makeApp();
    const t = await ticket(app);
    const list = (await (await post(app, `/api/tickets/${t.id}/side-conversations`, { subject: 'Later' })).json()) as Convo[];
    expect(list[0].messages).toHaveLength(0);
  });

  it('validates input and unknown targets', async () => {
    const app = makeApp();
    const t = await ticket(app);
    expect((await post(app, `/api/tickets/${t.id}/side-conversations`, { subject: '  ' })).status).toBe(400);
    const list = (await (await post(app, `/api/tickets/${t.id}/side-conversations`, { subject: 'X' })).json()) as Convo[];
    expect((await post(app, `/api/tickets/${t.id}/side-conversations/${list[0].id}/messages`, { body: '' })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/side-conversations/nope/messages`, { body: 'x' })).status).toBe(404);
    expect((await post(app, '/api/tickets/unknown/side-conversations', { subject: 'x' })).status).toBe(404);
  });
});
