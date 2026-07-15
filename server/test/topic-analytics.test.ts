import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  const { app, db } = createApp(mkdtempSync(path.join(tmpdir(), 'bd-topic-')));
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM tickets');
  return app;
}
type App = ReturnType<typeof createApp>['app'];
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

type Count<K extends string> = Record<K, string> & { count: number };

describe('topic analytics', () => {
  it('tallies top tags and category volume across tickets', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const c = boot.contacts[0].id;
    await post(app, '/api/tickets', { subject: 'a', body: 'a', requesterId: c, priority: 'medium', category: 'ZZBilling', tags: ['zzrefund', 'zzvip'] });
    await post(app, '/api/tickets', { subject: 'b', body: 'b', requesterId: c, priority: 'low', category: 'ZZBilling', tags: ['zzrefund'] });
    await post(app, '/api/tickets', { subject: 'd', body: 'd', requesterId: c, priority: 'high', category: 'ZZTech', tags: [] });

    const stats = await (await app.request('/api/stats')).json();
    const tag = (name: string) => (stats.topTags as Count<'tag'>[]).find((t) => t.tag === name);
    expect(tag('zzrefund')?.count).toBe(2);
    expect(tag('zzvip')?.count).toBe(1);

    const cat = (name: string) => (stats.byCategory as Count<'category'>[]).find((c) => c.category === name);
    expect(cat('ZZBilling')?.count).toBe(2);
    expect(cat('ZZTech')?.count).toBe(1);
    // Sorted by volume, most common first.
    expect((stats.topTags as Count<'tag'>[])[0].tag).toBe('zzrefund');
  });
});
