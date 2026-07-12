import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-macro-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
type Canned = { id: string; title: string; body: string; actions: unknown };
const bootCanned = async (app: ReturnType<typeof makeApp>): Promise<Canned[]> =>
  (await (await app.request('/api/bootstrap')).json()).canned;

describe('macros (canned replies with actions)', () => {
  it('persists actions on create and returns them parsed in bootstrap', async () => {
    const app = makeApp();
    const created = await (
      await app.request('/api/canned', json('POST', {
        title: 'Escalate',
        body: 'Bumping this up.',
        actions: { status: 'pending', priority: 'urgent', assignToMe: true, addTags: ['vip', 'vip'] },
      }))
    ).json();
    expect(created.actions).toEqual({ status: 'pending', priority: 'urgent', assignToMe: true, addTags: ['vip'] });

    const canned = await bootCanned(app);
    const mine = canned.find((c) => c.id === created.id);
    expect(mine?.actions).toEqual({ status: 'pending', priority: 'urgent', assignToMe: true, addTags: ['vip'] });
  });

  it('drops unknown status/priority and keeps a plain reply as null actions', async () => {
    const app = makeApp();
    const bad = await (
      await app.request('/api/canned', json('POST', { title: 'Weird', body: 'x', actions: { status: 'wat', priority: 'nope' } }))
    ).json();
    expect(bad.actions).toBeNull();

    const plain = await (await app.request('/api/canned', json('POST', { title: 'Plain', body: 'y' }))).json();
    expect(plain.actions).toBeNull();
  });

  it('updates actions on edit and can clear them back to null', async () => {
    const app = makeApp();
    const created = await (
      await app.request('/api/canned', json('POST', { title: 'M', body: 'b', actions: { status: 'solved' } }))
    ).json();

    const edited = await (
      await app.request(`/api/canned/${created.id}`, json('PUT', { title: 'M', body: 'b', actions: { addTags: ['done'] } }))
    ).json();
    expect(edited.actions).toEqual({ addTags: ['done'] });

    const cleared = await (
      await app.request(`/api/canned/${created.id}`, json('PUT', { title: 'M', body: 'b' }))
    ).json();
    expect(cleared.actions).toBeNull();

    const canned = await bootCanned(app);
    expect(canned.find((c) => c.id === created.id)?.actions).toBeNull();
  });

  it('ships seeded macros with actions', async () => {
    const app = makeApp();
    const canned = await bootCanned(app);
    // The seed marks the closing reply as a solve-and-tag macro.
    const closing = canned.find((c) => c.title === 'Closing thanks');
    expect(closing?.actions).toEqual({ status: 'solved', addTags: ['resolved'] });
  });
});
