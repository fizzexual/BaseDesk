import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-handover-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Note = { id: string; body: string; authorName: string | null };

describe('shift handover', () => {
  it('starts empty', async () => {
    const app = makeApp();
    expect(await (await app.request('/api/handover')).json()).toEqual([]);
  });

  it('posts notes newest-first with the author resolved', async () => {
    const app = makeApp();
    await post(app, '/api/handover', { body: 'first note' });
    const list = (await (await post(app, '/api/handover', { body: 'second note' })).json()) as Note[];
    expect(list.map((n) => n.body)).toEqual(['second note', 'first note']);
    expect(list[0].authorName).toBeTruthy();
  });

  it('deletes a note', async () => {
    const app = makeApp();
    const list = (await (await post(app, '/api/handover', { body: 'x' })).json()) as Note[];
    const after = await (await app.request(`/api/handover/${list[0].id}`, { method: 'DELETE' })).json();
    expect(after).toEqual([]);
  });

  it('rejects an empty note', async () => {
    const app = makeApp();
    expect((await post(app, '/api/handover', { body: '  ' })).status).toBe(400);
  });
});
