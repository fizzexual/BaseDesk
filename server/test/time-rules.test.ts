import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-time-')));
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
type App = ReturnType<typeof makeApp>['app'];

// Start from an empty ticket set so `fired` counts only the tickets a test makes
// (the demo seed ships old open tickets that legitimately match escalation rules).
function clearTickets(db: ReturnType<typeof makeApp>['db']) {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM tickets');
}

async function newTicket(app: App, priority = 'low') {
  const boot = await (await app.request('/api/bootstrap')).json();
  return (await (await app.request('/api/tickets', json('POST', { subject: 'x', body: 'y', requesterId: boot.contacts[0].id, priority }))).json())
    .ticket as { id: string };
}

describe('time-based rules', () => {
  it('fires an escalation once when past the threshold, and never again', async () => {
    const { app, db } = makeApp();
    clearTickets(db);
    await app.request('/api/settings/time-rules', json('PUT', [
      { id: 'r1', name: 'Escalate', enabled: true, trigger: 'awaiting_first_response', hours: 4, actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_tag', value: 'escalated' }] },
    ]));
    const t = await newTicket(app);
    // Age the ticket past the 4h window (and ensure no first response is recorded).
    db.prepare('UPDATE tickets SET createdAt = ?, firstRespondedAt = NULL WHERE id = ?').run(new Date(Date.now() - 5 * 3_600_000).toISOString(), t.id);

    const r1 = await (await app.request('/api/settings/time-rules/run', { method: 'POST' })).json();
    expect(r1.fired).toBe(1);

    const fresh = (await (await app.request('/api/tickets')).json()).find((x: { id: string }) => x.id === t.id);
    expect(fresh.priority).toBe('high');
    expect(fresh.tags).toContain('escalated');

    const msgs = await (await app.request(`/api/tickets/${t.id}/messages`)).json();
    expect(msgs.some((m: { kind: string; body: string }) => m.kind === 'note' && /Automation/.test(m.body))).toBe(true);

    // Fires once per ticket — a second pass does nothing.
    expect((await (await app.request('/api/settings/time-rules/run', { method: 'POST' })).json()).fired).toBe(0);
  });

  it('does not fire before the threshold', async () => {
    const { app, db } = makeApp();
    clearTickets(db);
    await app.request('/api/settings/time-rules', json('PUT', [
      { id: 'r1', name: 'esc', enabled: true, trigger: 'awaiting_first_response', hours: 24, actions: [{ type: 'add_tag', value: 'x' }] },
    ]));
    await newTicket(app);
    expect((await (await app.request('/api/settings/time-rules/run', { method: 'POST' })).json()).fired).toBe(0);
  });

  it('ignores disabled rules', async () => {
    const { app, db } = makeApp();
    clearTickets(db);
    await app.request('/api/settings/time-rules', json('PUT', [
      { id: 'r1', name: 'esc', enabled: false, trigger: 'awaiting_first_response', hours: 1, actions: [{ type: 'add_tag', value: 'x' }] },
    ]));
    const t = await newTicket(app);
    db.prepare('UPDATE tickets SET createdAt = ? WHERE id = ?').run(new Date(Date.now() - 10 * 3_600_000).toISOString(), t.id);
    expect((await (await app.request('/api/settings/time-rules/run', { method: 'POST' })).json()).fired).toBe(0);
  });

  it('rejects an invalid rule', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/settings/time-rules', json('PUT', [{ id: 'r', name: 'n', enabled: true, trigger: 'bad', hours: 1, actions: [] }]))).status).toBe(400);
  });

  it('exposes the rules through bootstrap', async () => {
    const { app } = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(Array.isArray(boot.timeRules)).toBe(true);
    expect(boot.timeRules.length).toBeGreaterThan(0);
  });
});
