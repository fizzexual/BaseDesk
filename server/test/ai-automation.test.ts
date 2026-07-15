import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-aiauto-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = (app: App, url: string, body: unknown) =>
  app.request(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type Action = { ticketId: string; kind: string; status: string };

async function newTicket(app: App, subject: string, body: string): Promise<{ id: string }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return (await (await post(app, '/api/tickets', { subject, body, requesterId: boot.contacts[0].id, priority: 'medium' })).json()).ticket;
}
async function actionsFor(app: App, ticketId: string): Promise<Action[]> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return (boot.aiActions as Action[]).filter((a) => a.ticketId === ticketId);
}
async function ticketStatus(app: App, id: string): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return (boot.tickets as { id: string; status: string }[]).find((t) => t.id === id)!.status;
}

describe('ai automation', () => {
  it('defaults every switch off and creates no AI action on a new ticket', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.aiAutomation).toEqual({ autoSuggest: false, autoResolve: false, autoTriage: false });
    // The seed ships enabled agents — but with auto-suggest off they must not fire.
    expect(boot.agents.length).toBeGreaterThan(0);
    const t = await newTicket(app, 'Help please', 'I need help with something in my account');
    expect(await actionsFor(app, t.id)).toHaveLength(0);
  });

  it('auto-suggests once enabled, but never auto-sends while auto-resolve is off', async () => {
    const app = makeApp();
    await put(app, '/api/settings/ai-automation', { autoSuggest: true, autoResolve: false, autoTriage: false });
    const t = await newTicket(app, 'Refund request', 'I would like a refund for my recent order please');
    const actions = await actionsFor(app, t.id);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    // A resolve downgrades to a pending draft — nothing is sent without auto-resolve.
    expect(actions.every((a) => a.status !== 'sent')).toBe(true);
    expect(await ticketStatus(app, t.id)).not.toBe('solved');
  });

  it('runs on demand via /api/ai/run even when auto-suggest is off', async () => {
    const app = makeApp();
    const t = await newTicket(app, 'A question', 'How do I change my plan');
    expect(await actionsFor(app, t.id)).toHaveLength(0); // no automatic action
    await post(app, '/api/ai/run', { ticketId: t.id }); // explicit "Suggest a reply"
    expect((await actionsFor(app, t.id)).length).toBeGreaterThanOrEqual(1);
  });
});
