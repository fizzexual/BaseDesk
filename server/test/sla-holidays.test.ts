import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { businessDueMs } from '../src/sla.js';
import type { SlaHours } from '../src/types.js';

const weekdays: SlaHours = { enabled: true, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [] };
const at = (iso: string) => new Date(iso).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe('SLA holiday calendar (businessDueMs)', () => {
  it('without holidays, 2 business hours from Mon 16:00 is Tue 10:00', () => {
    expect(iso(businessDueMs(at('2026-12-21T16:00:00Z'), 120, weekdays))).toBe('2026-12-22T10:00:00.000Z');
  });

  it('skips a holiday: Tue is off, so the clock lands on Wed 10:00', () => {
    const h = { ...weekdays, holidays: ['2026-12-22'] };
    expect(iso(businessDueMs(at('2026-12-21T16:00:00Z'), 120, h))).toBe('2026-12-23T10:00:00.000Z');
  });

  it('a ticket created on a holiday starts counting on the next working day', () => {
    const h = { ...weekdays, holidays: ['2026-12-25'] }; // Fri
    // Fri 25 Dec is off, Sat/Sun are not working days → Mon 28 Dec 09:00 + 60 min.
    expect(iso(businessDueMs(at('2026-12-25T10:00:00Z'), 60, h))).toBe('2026-12-28T10:00:00.000Z');
  });

  it('holiday dates are read in the desk time zone, not UTC', () => {
    // Sofia is UTC+2 in winter. 2026-12-22 07:30Z is 09:30 local on the holiday.
    const h: SlaHours = { ...weekdays, timezone: 'Europe/Sofia', holidays: ['2026-12-22'] };
    // Local Tue is off → Wed 23 Dec 09:00 local (07:00Z) + 30 min.
    expect(iso(businessDueMs(at('2026-12-22T07:30:00Z'), 30, h))).toBe('2026-12-23T07:30:00.000Z');
  });

  it('an install saved before holidays existed (no field) still works', () => {
    const { holidays: _drop, ...old } = weekdays;
    expect(iso(businessDueMs(at('2026-12-21T16:00:00Z'), 120, old as SlaHours))).toBe('2026-12-22T10:00:00.000Z');
  });

  it('every day a holiday falls back to wall-clock instead of looping forever', () => {
    const all: string[] = [];
    for (let d = 0; d < 4100; d++) all.push(iso(at('2026-12-21T00:00:00Z') + d * 86_400_000).slice(0, 10));
    const h = { ...weekdays, holidays: all };
    expect(businessDueMs(at('2026-12-21T16:00:00Z'), 60, h)).toBe(at('2026-12-21T17:00:00Z'));
  });
});

describe('PUT /api/settings/sla-hours', () => {
  const makeApp = () => createApp(mkdtempSync(path.join(tmpdir(), 'bd-hol-'))).app;
  const put = (app: ReturnType<typeof makeApp>, body: unknown) =>
    app.request('/api/settings/sla-hours', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('saves holidays sorted and de-duplicated, and bootstrap returns them', async () => {
    const app = makeApp();
    const res = await put(app, { ...weekdays, holidays: ['2026-12-31', '2026-12-24', '2026-12-31'] });
    expect(res.status).toBe(200);
    expect((await res.json()).holidays).toEqual(['2026-12-24', '2026-12-31']);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.slaHours.holidays).toEqual(['2026-12-24', '2026-12-31']);
  });

  it('keeps accepting a body without holidays (older clients) and stores an empty list', async () => {
    const { holidays: _drop, ...old } = weekdays;
    const res = await put(makeApp(), old);
    expect(res.status).toBe(200);
    expect((await res.json()).holidays).toEqual([]);
  });

  it.each([
    ['an impossible date', { ...weekdays, holidays: ['2026-02-30'] }],
    ['a non-date string', { ...weekdays, holidays: ['christmas'] }],
    ['holidays not an array', { ...weekdays, holidays: '2026-12-25' }],
    ['an unknown time zone', { ...weekdays, timezone: 'Mars/Olympus' }],
    ['end before start', { ...weekdays, start: '17:00', end: '09:00' }],
    ['an hour past 23', { ...weekdays, start: '25:00' }],
  ])('rejects %s with 400 and keeps the old value', async (_name, body) => {
    const app = makeApp();
    await put(app, { ...weekdays, holidays: ['2026-12-25'] });
    expect((await put(app, body)).status).toBe(400);
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.slaHours.holidays).toEqual(['2026-12-25']);
  });

  it('does not store keys it does not know', async () => {
    const app = makeApp();
    await put(app, { ...weekdays, evil: '<script>' });
    const boot = await (await app.request('/api/bootstrap')).json();
    expect(boot.slaHours).not.toHaveProperty('evil');
  });
});
