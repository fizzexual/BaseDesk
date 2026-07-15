import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-appr-'))).app;
}
type App = ReturnType<typeof makeApp>;
const post = (app: App, url: string, body?: unknown) =>
  app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

type Approval = { id: string; status: string; reason: string; requestedByName: string | null; approverName: string | null; decidedByName: string | null; decisionNote: string | null; decidedAt: string | null };

async function ticketAndAgent(app: App): Promise<{ t: { id: string }; approverId: string }> {
  const boot = await (await app.request('/api/bootstrap')).json();
  const c = boot.contacts[0].id;
  const t = (await (await post(app, '/api/tickets', { subject: 'A', body: 'b', requesterId: c, priority: 'medium' })).json()).ticket;
  const approver = boot.agents.find((a: { role: string }) => a.role !== 'admin') ?? boot.agents[1] ?? boot.agents[0];
  return { t, approverId: approver.id };
}

describe('ticket approvals', () => {
  it('requests, then approves an approval with the decider recorded', async () => {
    const app = makeApp();
    const { t, approverId } = await ticketAndAgent(app);
    const list = (await (await post(app, `/api/tickets/${t.id}/approvals`, { reason: 'Refund $200', approverId })).json()) as Approval[];
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('pending');
    expect(list[0].reason).toBe('Refund $200');
    expect(list[0].requestedByName).toBeTruthy();
    expect(list[0].approverName).toBeTruthy();

    const after = (await (await post(app, `/api/tickets/${t.id}/approvals/${list[0].id}/decide`, { decision: 'approved', note: 'ok' })).json()) as Approval[];
    expect(after[0].status).toBe('approved');
    expect(after[0].decidedByName).toBeTruthy();
    expect(after[0].decisionNote).toBe('ok');
    expect(after[0].decidedAt).not.toBeNull();
  });

  it('logs a requested and a decided approval event to the audit feed', async () => {
    const app = makeApp();
    const { t } = await ticketAndAgent(app);
    const list = (await (await post(app, `/api/tickets/${t.id}/approvals`, { reason: 'Comp the customer' })).json()) as Approval[];
    await post(app, `/api/tickets/${t.id}/approvals/${list[0].id}/decide`, { decision: 'rejected' });
    const feed = (await (await app.request('/api/events')).json()) as { ticketId: string; kind: string; detail: Record<string, unknown> }[];
    const evts = feed.filter((e) => e.ticketId === t.id && e.kind === 'approval');
    expect(evts.some((e) => e.detail.state === 'requested')).toBe(true);
    expect(evts.some((e) => e.detail.state === 'rejected')).toBe(true);
  });

  it('validates input and guards against deciding twice', async () => {
    const app = makeApp();
    const { t } = await ticketAndAgent(app);
    expect((await post(app, `/api/tickets/${t.id}/approvals`, { reason: '  ' })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/approvals`, { reason: 'x', approverId: 'nope' })).status).toBe(400);
    const list = (await (await post(app, `/api/tickets/${t.id}/approvals`, { reason: 'x' })).json()) as Approval[];
    expect((await post(app, `/api/tickets/${t.id}/approvals/${list[0].id}/decide`, { decision: 'maybe' })).status).toBe(400);
    expect((await post(app, `/api/tickets/${t.id}/approvals/nope/decide`, { decision: 'approved' })).status).toBe(404);
    await post(app, `/api/tickets/${t.id}/approvals/${list[0].id}/decide`, { decision: 'approved' });
    expect((await post(app, `/api/tickets/${t.id}/approvals/${list[0].id}/decide`, { decision: 'rejected' })).status).toBe(409);
  });
});
