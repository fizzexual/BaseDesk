import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { getTicket } from '../src/db.js';

// Security finding #10 (no role checks), the invite flow that never activated anyone, and
// the agent-management bugs the correctness review reproduced.

const dir = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const req = (method: string, body?: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

async function desk() {
  const { app, db, setupToken, sweepOrphanUploads } = createApp(dir('bd-roles-'), { production: true, demo: true });
  const admin = await (await app.request('/api/setup', req('POST', { token: setupToken, name: 'Ann Admin', email: 'ann@example.com', password: 'admin password' }))).json();
  const invited = await (await app.request('/api/agents', req('POST', { name: 'Bob Agent', email: 'bob@example.com', role: 'agent' }, admin.token))).json();
  return { app, db, sweepOrphanUploads, adminToken: admin.token as string, adminId: admin.agent.id as string, invited };
}

describe('invites', () => {
  it('an invited teammate accepts with a password, becomes active and can sign in', async () => {
    const { app, invited } = await desk();
    expect(invited.status).toBe('invited');
    expect((await app.request('/api/auth/accept-invite', req('POST', { token: invited.inviteToken, password: 'short' }))).status).toBe(400);
    const res = await app.request('/api/auth/accept-invite', req('POST', { token: invited.inviteToken, password: 'bob password' }));
    expect(res.status).toBe(200);
    const { token, agent } = await res.json();
    expect(agent).toMatchObject({ id: invited.id, status: 'active' });
    expect((await app.request('/api/bootstrap', req('GET', undefined, token))).status).toBe(200);
    // The link works once.
    expect((await app.request('/api/auth/accept-invite', req('POST', { token: invited.inviteToken, password: 'bob password' }))).status).toBe(404);
    expect((await app.request('/api/auth/login', req('POST', { email: 'bob@example.com', password: 'bob password' }))).status).toBe(200);
  });

  it('a made-up invite token is refused', async () => {
    const { app } = await desk();
    expect((await app.request('/api/auth/accept-invite', req('POST', { token: 'inv_nope', password: 'whatever123' }))).status).toBe(404);
  });
});

describe('admin-only configuration', () => {
  async function withAgent() {
    const d = await desk();
    const { token } = await (await d.app.request('/api/auth/accept-invite', req('POST', { token: d.invited.inviteToken, password: 'bob password' }))).json();
    return { ...d, agentToken: token as string };
  }

  it('an agent cannot change settings, the team, channels, the AI provider, or export', async () => {
    const { app, agentToken, adminId } = await withAgent();
    const denied: [string, string, unknown?][] = [
      ['PUT', '/api/settings/sla-hours', { enabled: false }],
      ['PUT', '/api/settings/auth', { enabled: true }],
      ['POST', '/api/agents', { name: 'Eve', email: 'eve@example.com', role: 'admin' }],
      ['DELETE', `/api/agents/${adminId}`],
      ['PATCH', `/api/agents/${adminId}`, { name: 'Hacked' }],
      ['POST', '/api/channels', { type: 'webhook', name: 'x' }],
      ['PUT', '/api/ai/provider', { baseUrl: 'http://127.0.0.1:1' }],
      ['POST', '/api/ai/models', {}],
      ['GET', '/api/export?type=tickets'],
    ];
    for (const [method, url, body] of denied) {
      expect((await app.request(url, req(method, body, agentToken))).status, `${method} ${url}`).toBe(403);
    }
  });

  it('an agent still works tickets and edits their own profile, but not their role', async () => {
    const { app, agentToken, invited } = await withAgent();
    const boot = await (await app.request('/api/bootstrap', req('GET', undefined, agentToken))).json();
    const t = boot.tickets[0];
    expect((await app.request(`/api/tickets/${t.id}`, req('PATCH', { priority: 'high' }, agentToken))).status).toBe(200);
    expect((await app.request(`/api/agents/${invited.id}`, req('PATCH', { name: 'Bobby', signature: '— Bobby' }, agentToken))).status).toBe(200);
    expect((await app.request(`/api/agents/${invited.id}`, req('PATCH', { role: 'admin' }, agentToken))).status).toBe(403);
  });

  it('an admin can do all of it', async () => {
    const { app, adminToken } = await withAgent();
    expect((await app.request('/api/settings/assignment', req('PUT', { enabled: true, strategy: 'round_robin' }, adminToken))).status).toBe(200);
    expect((await app.request('/api/export?type=tickets', req('GET', undefined, adminToken))).status).toBe(200);
  });
});

describe('team management bugs', () => {
  it('refuses to demote the last admin (it used to 500 every request after)', async () => {
    const { app, adminId, adminToken } = await desk();
    expect((await app.request(`/api/agents/${adminId}`, req('PATCH', { role: 'agent' }, adminToken))).status).toBe(400);
    expect((await app.request('/api/bootstrap', req('GET', undefined, adminToken))).status).toBe(200);
  });

  it('removing an agent returns their tickets to the unassigned pool and kills their sessions', async () => {
    const { app, db, adminToken, invited } = await desk();
    const { token: bobToken } = await (await app.request('/api/auth/accept-invite', req('POST', { token: invited.inviteToken, password: 'bob password' }))).json();
    const boot = await (await app.request('/api/bootstrap', req('GET', undefined, adminToken))).json();
    const ids = boot.tickets.slice(0, 3).map((t: { id: string }) => t.id);
    for (const id of ids) await app.request(`/api/tickets/${id}`, req('PATCH', { assigneeId: invited.id }, adminToken));
    expect(getTicket(db, ids[0])?.assigneeId).toBe(invited.id);

    expect((await app.request(`/api/agents/${invited.id}`, req('DELETE', undefined, adminToken))).status).toBe(200);
    for (const id of ids) expect(getTicket(db, id)?.assigneeId).toBeNull();
    expect((await app.request('/api/bootstrap', req('GET', undefined, bobToken))).status).toBe(401);
  });
});

describe('request hardening (findings #11, #15)', () => {
  it('refuses an oversized JSON body with 413', async () => {
    const { app, adminToken } = await desk();
    const res = await app.request('/api/tickets', req('POST', { subject: 'x', body: 'y'.repeat(1_100_000) }, adminToken));
    expect(res.status).toBe(413);
  });

  it('sends nosniff and refuses framing, except for the chat widget page', async () => {
    const { app } = await desk();
    const res = await app.request('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect((await app.request('/widget.html')).headers.get('x-frame-options')).toBeNull();
  });

  it('throttles anonymous uploads and sweeps orphan uploads after a day', async () => {
    const { app, db, sweepOrphanUploads } = await desk();
    const up = () => {
      const form = new FormData();
      form.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }));
      return app.request('/api/uploads', { method: 'POST', body: form });
    };
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await up()).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[31]).toBe(429);

    const orphans = (db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE messageId IS NULL').get() as { n: number }).n;
    expect(orphans).toBeGreaterThanOrEqual(30);
    expect(sweepOrphanUploads(Date.now())).toBe(0); // too fresh
    expect(sweepOrphanUploads(Date.now() + 25 * 60 * 60_000)).toBe(orphans);
  });
});
