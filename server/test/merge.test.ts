import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getMessages } from '../src/db.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-merge-')));
}
const post = (into: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ into }),
});

async function twoOpenTickets(app: ReturnType<typeof makeApp>['app']): Promise<[string, string]> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const open = boot.tickets.filter((t: { status: string }) => t.status !== 'closed');
  return [open[0].id, open[1].id];
}

describe('merge tickets', () => {
  it('moves messages onto the target, drops a note, and closes the source as a pointer', async () => {
    const { app, db } = makeApp();
    const [src, dst] = await twoOpenTickets(app);
    const srcCount = getMessages(db, src).length;
    const dstCount = getMessages(db, dst).length;

    const res = await (await app.request(`/api/tickets/${src}/merge`, post(dst))).json();
    expect(res.source.mergedIntoId).toBe(dst);
    expect(res.source.status).toBe('closed');
    expect(res.target.mergedIntoId).toBeNull();

    // Source thread is emptied; target absorbed those messages + a merge note.
    expect(getMessages(db, src).length).toBe(0);
    const dstMsgs = getMessages(db, dst);
    expect(dstMsgs.length).toBe(srcCount + dstCount + 1);
    expect(dstMsgs.some((m) => m.kind === 'note' && m.body.startsWith('Merged ticket #'))).toBe(true);
  });

  it('locks the merged source against new messages', async () => {
    const { app } = makeApp();
    const [src, dst] = await twoOpenTickets(app);
    await app.request(`/api/tickets/${src}/merge`, post(dst));
    const res = await app.request(`/api/tickets/${src}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'note', body: 'x' }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects self-merge, re-merge, and unknown targets', async () => {
    const { app } = makeApp();
    const [src, dst] = await twoOpenTickets(app);
    expect((await app.request(`/api/tickets/${src}/merge`, post(src))).status).toBe(400);
    expect((await app.request(`/api/tickets/${src}/merge`, post('t_nope'))).status).toBe(404);

    await app.request(`/api/tickets/${src}/merge`, post(dst)); // first merge OK
    expect((await app.request(`/api/tickets/${src}/merge`, post(dst))).status).toBe(409); // already merged
  });
});
