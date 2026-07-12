import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-cf-'))).app;
}
const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function firstTicketId(app: ReturnType<typeof makeApp>): Promise<string> {
  const boot = await (await app.request('/api/bootstrap')).json();
  return boot.tickets[0].id;
}

describe('custom field definitions', () => {
  it('creates fields, assigns positions, and lists them in bootstrap', async () => {
    const app = makeApp();
    const a = await (await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'Order #', type: 'text' }))).json();
    const b = await (await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'Tier', type: 'select', options: ['Free', 'Pro'], required: true }))).json();
    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(b.options).toEqual(['Free', 'Pro']);
    expect(b.required).toBe(true);

    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.customFields.map((f: { label: string }) => f.label)).toEqual(['Order #', 'Tier']);
  });

  it('rejects a select field with no options', async () => {
    const app = makeApp();
    const res = await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'X', type: 'select' }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown type or entity', async () => {
    const app = makeApp();
    expect((await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'X', type: 'wat' }))).status).toBe(400);
    expect((await app.request('/api/custom-fields', json('POST', { entity: 'planet', label: 'X', type: 'text' }))).status).toBe(400);
  });

  it('renames and re-requires a field, then deletes it', async () => {
    const app = makeApp();
    const f = await (await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'Old', type: 'text' }))).json();
    const patched = await (await app.request(`/api/custom-fields/${f.id}`, json('PATCH', { label: 'New', required: true }))).json();
    expect(patched.label).toBe('New');
    expect(patched.required).toBe(true);

    expect((await app.request(`/api/custom-fields/${f.id}`, { method: 'DELETE' })).status).toBe(200);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.customFields).toHaveLength(0);
  });
});

describe('custom field values on tickets', () => {
  it('stores and returns a ticket custom-field value', async () => {
    const app = makeApp();
    const field = await (await app.request('/api/custom-fields', json('POST', { entity: 'ticket', label: 'Order #', type: 'text' }))).json();
    const id = await firstTicketId(app);

    const updated = await (await app.request(`/api/tickets/${id}`, json('PATCH', { customFields: { [field.id]: 'ORD-42' } }))).json();
    expect(updated.customFields[field.id]).toBe('ORD-42');

    // Value survives a re-read and shows up in bootstrap.
    const reread = await (await app.request(`/api/tickets/${id}`, json('PATCH', { priority: 'high' }))).json();
    expect(reread.customFields[field.id]).toBe('ORD-42');
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.tickets.find((t: { id: string }) => t.id === id).customFields[field.id]).toBe('ORD-42');
  });

  it('rejects a non-object customFields patch', async () => {
    const app = makeApp();
    const id = await firstTicketId(app);
    expect((await app.request(`/api/tickets/${id}`, json('PATCH', { customFields: ['nope'] }))).status).toBe(400);
    expect((await app.request(`/api/tickets/${id}`, json('PATCH', { customFields: 'nope' }))).status).toBe(400);
  });

  it('defaults new tickets to an empty custom-field map', async () => {
    const app = makeApp();
    const boot = await (await app.request('/api/bootstrap')).json();
    const { ticket } = await (await app.request('/api/tickets', json('POST', {
      subject: 'Hi', body: 'there', requesterId: boot.contacts[0].id, priority: 'low',
    }))).json();
    expect(ticket.customFields).toEqual({});
  });
});
