import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-settings-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('team management', () => {
  it('creates an invited teammate with a token', async () => {
    const app = makeApp();
    const res = await app.request('/api/agents', json('POST', { name: 'Dana Lux', email: 'dana@acme.com', role: 'agent' }));
    expect(res.status).toBe(200);
    const agent = await res.json();
    expect(agent.status).toBe('invited');
    expect(agent.role).toBe('agent');
    expect(String(agent.inviteToken)).toMatch(/^inv_/);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.agents.some((a: { id: string }) => a.id === agent.id)).toBe(true);
  });

  it('rejects an invite with a blank name', async () => {
    const app = makeApp();
    const res = await app.request('/api/agents', json('POST', { name: '  ', email: 'x@y.com', role: 'agent' }));
    expect(res.status).toBe(400);
  });

  it('updates a role and a signature', async () => {
    const app = makeApp();
    const agent = await (await app.request('/api/agents', json('POST', { name: 'Dana Lux', email: 'dana@acme.com', role: 'agent' }))).json();
    const promoted = await (await app.request(`/api/agents/${agent.id}`, json('PATCH', { role: 'admin' }))).json();
    expect(promoted.role).toBe('admin');
    const signed = await (await app.request(`/api/agents/${agent.id}`, json('PATCH', { signature: '— Dana, Support' }))).json();
    expect(signed.signature).toBe('— Dana, Support');
    expect((await app.request(`/api/agents/${agent.id}`, json('PATCH', { role: 'wizard' }))).status).toBe(400);
  });

  it('refuses to remove the last active admin but allows other removals', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const admins = boot.agents.filter((a: { role: string; status: string }) => a.role === 'admin' && a.status === 'active');
    expect(admins.length).toBe(1);
    expect((await app.request(`/api/agents/${admins[0].id}`, { method: 'DELETE' })).status).toBe(400);

    const agent = boot.agents.find((a: { role: string }) => a.role === 'agent');
    expect((await app.request(`/api/agents/${agent.id}`, { method: 'DELETE' })).status).toBe(200);
    const after = await (await app.request('/api/bootstrap')).json();
    expect(after.agents.some((a: { id: string }) => a.id === agent.id)).toBe(false);
  });
});

describe('business hours', () => {
  it('saves valid business hours and rejects bad input', async () => {
    const app = makeApp();
    const good = { enabled: true, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
    expect((await app.request('/api/settings/sla-hours', json('PUT', good))).status).toBe(200);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.slaHours.enabled).toBe(true);
    expect(boot.slaHours.days).toEqual([1, 2, 3, 4, 5]);

    expect((await app.request('/api/settings/sla-hours', json('PUT', { ...good, days: [7] }))).status).toBe(400);
    expect((await app.request('/api/settings/sla-hours', json('PUT', { ...good, start: '9:00' }))).status).toBe(400);
  });
});

describe('multi-condition automation', () => {
  const rule = (over: Record<string, unknown>) => ({
    id: 'r1', name: 'Rule', enabled: true, match: 'all', runOn: 'create',
    conditions: [], actions: [], ...over,
  });

  it('applies every action when All conditions match, and skips when one fails', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const contact = boot.contacts[0].id;
    await app.request('/api/settings/automation', json('PUT', [
      rule({
        match: 'all',
        conditions: [{ type: 'subject_contains', value: 'vpn' }, { type: 'priority_is', value: 'high' }],
        actions: [{ type: 'add_tag', value: 'network' }, { type: 'set_status', value: 'pending' }],
      }),
    ]));

    const hit = await (await app.request('/api/tickets', json('POST', {
      subject: 'VPN keeps dropping', body: 'since this morning', requesterId: contact, priority: 'high',
    }))).json();
    expect(hit.ticket.tags).toContain('network');
    expect(hit.ticket.status).toBe('pending');

    const miss = await (await app.request('/api/tickets', json('POST', {
      subject: 'VPN question', body: 'quick one', requesterId: contact, priority: 'low',
    }))).json();
    expect(miss.ticket.tags).not.toContain('network');
    expect(miss.ticket.status).toBe('open');
  });

  it('fires on Any matching condition', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    await app.request('/api/settings/automation', json('PUT', [
      rule({
        match: 'any',
        conditions: [{ type: 'subject_contains', value: 'zzz' }, { type: 'body_contains', value: 'wire transfer' }],
        actions: [{ type: 'set_priority', value: 'urgent' }],
      }),
    ]));
    const t = await (await app.request('/api/tickets', json('POST', {
      subject: 'Billing help', body: 'a wire transfer failed', requesterId: boot.contacts[0].id, priority: 'low',
    }))).json();
    expect(t.ticket.priority).toBe('urgent');
  });

  it('rejects a rule with an unknown condition type', async () => {
    const app = makeApp();
    const res = await app.request('/api/settings/automation', json('PUT', [
      rule({ conditions: [{ type: 'phase_of_moon', value: 'full' }], actions: [{ type: 'add_tag', value: 'x' }] }),
    ]));
    expect(res.status).toBe(400);
  });
});
