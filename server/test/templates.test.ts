import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-tpl-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Template = { id: string; name: string; subject: string; body: string; priority: string; category: string | null; tags: string[] };

describe('ticket templates', () => {
  it('seeds default templates into the bootstrap', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(Array.isArray(boot.templates)).toBe(true);
    expect(boot.templates.length).toBeGreaterThanOrEqual(3);
    const bug = (boot.templates as Template[]).find((t) => t.name === 'Bug report');
    expect(bug).toBeDefined();
    expect(bug!.priority).toBe('high');
    expect(bug!.tags).toContain('bug');
  });

  it('creates, updates, and deletes a template', async () => {
    const app = makeApp();
    const created = (await (await post(app, '/api/templates', {
      name: 'Onboarding', subject: 'Welcome', body: 'Hi', priority: 'low', category: 'Billing', tags: ['welcome', 'welcome'],
    })).json()) as Template;
    expect(created.id).toBeTruthy();
    expect(created.tags).toEqual(['welcome']); // deduped
    expect(created.category).toBe('Billing');

    const updated = (await (await put(app, `/api/templates/${created.id}`, {
      name: 'Onboarding v2', subject: '', body: 'Hello', priority: 'urgent', category: '', tags: [],
    })).json()) as Template;
    expect(updated.name).toBe('Onboarding v2');
    expect(updated.priority).toBe('urgent');
    expect(updated.category).toBeNull();

    const boot = await (await app.request('/api/bootstrap')).json();
    expect((boot.templates as Template[]).find((t) => t.id === created.id)!.name).toBe('Onboarding v2');

    await app.request(`/api/templates/${created.id}`, { method: 'DELETE' });
    const boot2 = await (await app.request('/api/bootstrap')).json();
    expect((boot2.templates as Template[]).find((t) => t.id === created.id)).toBeUndefined();
  });

  it('rejects a nameless template and an unknown update', async () => {
    const app = makeApp();
    expect((await post(app, '/api/templates', { name: '  ', body: 'x' })).status).toBe(400);
    expect((await put(app, '/api/templates/nope', { name: 'X' })).status).toBe(404);
  });

  it('applies a template category and tags when creating a ticket', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const c = boot.contacts[0].id;
    const { ticket } = await (await post(app, '/api/tickets', {
      subject: 'From template', body: 'body', requesterId: c, priority: 'medium', category: 'ZZTest', tags: ['zztag', 'zztag'],
    })).json();
    expect(ticket.category).toBe('ZZTest');
    expect(ticket.tags).toContain('zztag');
  });
});
