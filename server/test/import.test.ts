import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-import-'))).app;
}
const imp = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const boot = async (app: ReturnType<typeof makeApp>) => (await app.request('/api/bootstrap')).json();

describe('CSV import — contacts', () => {
  const csv = 'Name,Email,Company\nAda Lovelace,ada@example.com,Analytical\nGrace Hopper,GRACE@example.com,Navy\n';

  it('imports contacts, auto-mapping columns by header', async () => {
    const app = makeApp();
    const before = (await boot(app)).contacts.length;
    const res = await (await app.request('/api/import', imp({ type: 'contacts', csv }))).json();
    expect(res.created).toBe(2);
    expect(res.mapping).toMatchObject({ name: 'Name', email: 'Email', company: 'Company' });
    const after = await boot(app);
    expect(after.contacts.length).toBe(before + 2);
    expect(after.contacts.some((c: { email: string }) => c.email === 'grace@example.com')).toBe(true); // lowercased
  });

  it('skips duplicates (existing + within the file) and errors invalid emails', async () => {
    const app = makeApp();
    await app.request('/api/import', imp({ type: 'contacts', csv }));
    const again = await (await app.request('/api/import', imp({ type: 'contacts', csv }))).json();
    expect(again.created).toBe(0);
    expect(again.skippedCount).toBe(2);

    const bad = await (await app.request('/api/import', imp({ type: 'contacts', csv: 'Name,Email\nNo Email,nope\nDup,dup@x.com\nDup2,dup@x.com\n' }))).json();
    expect(bad.errorCount).toBe(1); // "nope" invalid
    expect(bad.created).toBe(1); // first dup@x.com
    expect(bad.skippedCount).toBe(1); // second dup@x.com within the file
  });

  it('dryRun previews without writing', async () => {
    const app = makeApp();
    const before = (await boot(app)).contacts.length;
    const res = await (await app.request('/api/import', imp({ type: 'contacts', csv, dryRun: true }))).json();
    expect(res.dryRun).toBe(true);
    expect(res.created).toBe(2);
    expect((await boot(app)).contacts.length).toBe(before);
  });

  it('400s when a required column cannot be mapped', async () => {
    const app = makeApp();
    const res = await app.request('/api/import', imp({ type: 'contacts', csv: 'Full,Org\nx,y\n' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Email');
    expect(body.headers).toEqual(['Full', 'Org']);
  });
});

describe('CSV import — tickets', () => {
  const csv =
    'Subject,Requester email,Message,Priority,Status,Tags\n' +
    'Cannot login,zoe@example.com,I am locked out,high,open,"auth,urgent"\n' +
    'Refund please,ada@example.com,Where is my refund,,solved,billing\n';

  it('creates tickets, finds/creates the requester, and normalizes priority/status/tags', async () => {
    const app = makeApp();
    const res = await (await app.request('/api/import', imp({ type: 'tickets', csv }))).json();
    expect(res.created).toBe(2);

    const b = await boot(app);
    const login = b.tickets.find((t: { subject: string }) => t.subject === 'Cannot login');
    expect(login.priority).toBe('high');
    expect(login.status).toBe('open');
    expect(login.tags).toEqual(['auth', 'urgent']);
    const refund = b.tickets.find((t: { subject: string }) => t.subject === 'Refund please');
    expect(refund.priority).toBe('medium'); // blank → default
    expect(refund.status).toBe('solved');
    expect(refund.resolvedAt).not.toBeNull();
    expect(b.contacts.some((c: { email: string }) => c.email === 'zoe@example.com')).toBe(true);
  });

  it('applies a client mapping override', async () => {
    const app = makeApp();
    const custom = 'Title,From,Note\nHello there,pat@example.com,Body text\n';
    const res = await (await app.request('/api/import', imp({
      type: 'tickets', csv: custom, mapping: { subject: 'Title', requesterEmail: 'From', body: 'Note' },
    }))).json();
    expect(res.created).toBe(1);
    const b = await boot(app);
    expect(b.tickets.some((t: { subject: string }) => t.subject === 'Hello there')).toBe(true);
  });
});
