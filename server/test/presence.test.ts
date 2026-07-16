import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-presence-')));
}

describe('ticket presence', () => {
  async function firstTicketId(app: ReturnType<typeof makeApp>['app']): Promise<string> {
    const boot = await (await app.request('/api/bootstrap')).json();
    return boot.tickets[0].id;
  }
  const beat = (app: ReturnType<typeof makeApp>['app'], id: string, sessionId: string, agentId: string) =>
    app.request(`/api/tickets/${id}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, agentId }),
    });

  it('reports the other sessions viewing the same ticket', async () => {
    const { app } = makeApp();
    const id = await firstTicketId(app);
    expect((await (await beat(app, id, 'sess-a', 'a_1')).json()).present).toEqual([]); // alone
    expect((await (await beat(app, id, 'sess-b', 'a_2')).json()).present).toContain('a_1'); // b sees a
    expect((await (await beat(app, id, 'sess-a', 'a_1')).json()).present).toContain('a_2'); // a now sees b
  });

  it('dedupes one agent open in several tabs', async () => {
    const { app } = makeApp();
    const id = await firstTicketId(app);
    await beat(app, id, 'tab-1', 'a_1');
    await beat(app, id, 'tab-2', 'a_1');
    const seen = (await (await beat(app, id, 'tab-3', 'a_9')).json()).present;
    expect(seen).toEqual(['a_1']); // two a_1 tabs collapse to one entry
  });

  it('keeps presence separate per ticket', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const [t1, t2] = [boot.tickets[0].id, boot.tickets[1].id];
    await beat(app, t1, 'sess-a', 'a_1');
    expect((await (await beat(app, t2, 'sess-b', 'a_2')).json()).present).toEqual([]); // different ticket
  });
});
