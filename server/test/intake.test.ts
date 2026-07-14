import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-intake-'))).app;
}
type App = ReturnType<typeof makeApp>;
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

async function portalToken(app: App, email: string): Promise<string> {
  const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Ada', email, password: 'hunter2!' }))).json();
  return reg.token;
}

describe('intake form', () => {
  it('ships a default decision tree and derives its categories', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.intakeForm.enabled).toBe(true);
    expect(boot.intakeForm.rootId).toBe('n_type');
    // The default tree assigns these categories via its options.
    expect(boot.categories).toEqual(['Abuse', 'Billing', 'Bug', 'Technical']);
  });

  it('saves an edited form, sanitizing bad nodes and re-pointing a dangling root', async () => {
    const app = makeApp();
    const res = await app.request('/api/intake-form', json('PUT', {
      enabled: true,
      rootId: 'missing',
      nodes: {
        q1: { id: 'q1', prompt: 'Type?', options: [{ id: 'a', label: 'Billing', next: null, category: 'Billing', tags: ['x'] }, 'garbage'] },
      },
    }));
    const saved = await res.json();
    expect(saved.rootId).toBe('q1'); // dangling root fell back to the only node
    expect(saved.nodes.q1.options).toHaveLength(1); // the non-object option was dropped
    expect(saved.nodes.q1.options[0].category).toBe('Billing');
    // Portal only sees the form while enabled.
    const pub = await (await app.request('/api/portal/intake-form')).json();
    expect(pub.rootId).toBe('q1');
  });

  it('routes a categorized ticket to an agent who covers that category', async () => {
    const app = makeApp();
    // Priya (a_2) covers Bug; turn on auto-assignment.
    await app.request('/api/agents/a_2', json('PATCH', { categories: ['Bug'] }));
    await app.request('/api/settings/assignment', json('PUT', { enabled: true, strategy: 'least_busy' }));

    const token = await portalToken(app, 'ada@example.com');
    const created = await (await app.request('/api/portal/tickets', json('POST', {
      subject: 'It broke', body: 'help', category: 'Bug', tags: ['skyblock'], answers: [{ prompt: 'Which server?', label: 'Skyblock' }],
    }, token))).json();

    expect(created.ticket.category).toBe('Bug');
    expect(created.ticket.assigneeId).toBe('a_2'); // routed to the Bug coverer
    expect(created.ticket.tags).toContain('skyblock');
    // The answer path is prepended to the opening message for the agent to see.
    const msgs = await (await app.request(`/api/tickets/${created.ticket.id}/messages`)).json();
    expect(msgs[0].body).toContain('Which server? — Skyblock');
  });

  it('falls back to any active agent when nobody covers the category', async () => {
    const app = makeApp();
    await app.request('/api/agents/a_2', json('PATCH', { categories: ['Bug'] }));
    await app.request('/api/settings/assignment', json('PUT', { enabled: true, strategy: 'round_robin' }));
    const token = await portalToken(app, 'ben@example.com');
    const created = await (await app.request('/api/portal/tickets', json('POST', { subject: 'x', body: 'y', category: 'Technical' }, token))).json();
    expect(created.ticket.assigneeId).not.toBeNull(); // still assigned, just not category-restricted
  });
});
