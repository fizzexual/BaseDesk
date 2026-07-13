import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { parseCsv, toCsv } from '../src/csv.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-export-'))).app;
}

describe('CSV export', () => {
  it('exports contacts as CSV — a header plus one row per contact', async () => {
    const app = makeApp();
    const res = await app.request('/api/export?type=contacts');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('basedesk-contacts.csv');

    const { headers, rows } = parseCsv(await res.text());
    expect(headers).toEqual(['name', 'email', 'company', 'mrr', 'location', 'createdAt']);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(rows.length).toBe(boot.contacts.length);
    expect(rows.some((r) => r.email === boot.contacts[0].email)).toBe(true);
  });

  it('exports tickets with requester email, assignee, and tags', async () => {
    const app = makeApp();
    const { headers, rows } = parseCsv(await (await app.request('/api/export?type=tickets')).text());
    expect(headers).toContain('requesterEmail');
    expect(headers).toContain('assignee');
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(rows.length).toBe(boot.tickets.length);
    // Every row's number maps to a real ticket.
    const numbers = new Set(boot.tickets.map((t: { number: number }) => String(t.number)));
    expect(rows.every((r) => numbers.has(r.number))).toBe(true);
  });

  it('400s an unknown export type', async () => {
    const app = makeApp();
    expect((await app.request('/api/export?type=widgets')).status).toBe(400);
  });

  it('round-trips CSV escaping for commas, quotes, and newlines', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['line1\nline2', 'z']]);
    const { rows } = parseCsv(csv);
    expect(rows[0].a).toBe('x,y');
    expect(rows[0].b).toBe('he said "hi"');
    expect(rows[1].a).toBe('line1\nline2');
  });
});
