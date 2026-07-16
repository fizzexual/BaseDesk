import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.js';
import { isOpenNow, nextOpenIso, normalizeBusinessHours } from '../src/business-hours.js';
import { DEFAULT_BUSINESS_HOURS } from '../src/defaults.js';
import type { BusinessHours } from '../src/types.js';

function makeApp() {
  return createApp(mkdtempSync(path.join(tmpdir(), 'bd-bh-')));
}
const json = (method: string, body: unknown, token?: string) => ({
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

const weekday: BusinessHours = {
  enabled: true, timezone: 'UTC', message: 'closed',
  days: [null, ...Array(5).fill({ open: '09:00', close: '17:00' }), null], // Sun off, Mon–Fri 9–5, Sat off
};
const MON_NOON = Date.parse('2026-01-05T12:00:00Z'); // Monday
const MON_EVENING = Date.parse('2026-01-05T20:00:00Z');
const SUNDAY = Date.parse('2026-01-04T12:00:00Z');

describe('business-hours logic', () => {
  it('is open inside the window and closed outside it', () => {
    expect(isOpenNow(weekday, MON_NOON)).toBe(true);
    expect(isOpenNow(weekday, MON_EVENING)).toBe(false);
    expect(isOpenNow(weekday, SUNDAY)).toBe(false); // Sunday is closed
  });

  it('treats disabled hours as always open', () => {
    expect(isOpenNow({ ...weekday, enabled: false }, MON_EVENING)).toBe(true);
  });

  it('finds the next opening instant', () => {
    // Monday evening → next open is Tuesday 09:00 UTC.
    expect(nextOpenIso(weekday, MON_EVENING)).toBe('2026-01-06T09:00:00.000Z');
    // Sunday → Monday 09:00 UTC.
    expect(nextOpenIso(weekday, SUNDAY)).toBe('2026-01-05T09:00:00.000Z');
  });

  it('normalizes untrusted input to 7 valid days', () => {
    const n = normalizeBusinessHours({ enabled: true, days: [{ open: '17:00', close: '09:00' }, 'junk'] }, DEFAULT_BUSINESS_HOURS);
    expect(n.days).toHaveLength(7);
    expect(n.days[0]).toBeNull(); // inverted window dropped
    expect(n.timezone).toBe(DEFAULT_BUSINESS_HOURS.timezone); // filled from fallback
  });
});

describe('outside-hours auto-message', () => {
  it('posts an outside_hours embed when a ticket is opened while closed', async () => {
    const { app } = makeApp();
    // Always-closed schedule so the test is deterministic whenever it runs.
    await app.request('/api/settings/business-hours', json('PUT', { enabled: true, timezone: 'UTC', message: 'We are closed, {{name}}.', days: [null, null, null, null, null, null, null] }));
    const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Ada Byte', email: 'ada@ex.com', password: 'hunter2!' }))).json();
    const created = await (await app.request('/api/portal/tickets', json('POST', { subject: 'Help please', body: 'hello' }, reg.token))).json();

    const msgs = await (await app.request(`/api/tickets/${created.ticket.id}/messages`)).json();
    const auto = msgs.find((m: { embeds?: { type: string }[] }) => m.embeds?.some((e) => e.type === 'outside_hours'));
    expect(auto).toBeDefined();
    const embed = auto.embeds.find((e: { type: string }) => e.type === 'outside_hours');
    expect(embed.message).toContain('Ada'); // {{name}} filled with first name
    expect(auto.body).toBe('We are closed, Ada.');
  });

  it('stays silent during business hours', async () => {
    const { app } = makeApp();
    // Open 24/7 so we're always inside hours.
    await app.request('/api/settings/business-hours', json('PUT', { enabled: true, timezone: 'UTC', message: 'closed', days: Array(7).fill({ open: '00:00', close: '23:59' }) }));
    const reg = await (await app.request('/api/portal/register', json('POST', { name: 'Ben', email: 'ben@ex.com', password: 'hunter2!' }))).json();
    const created = await (await app.request('/api/portal/tickets', json('POST', { subject: 'x', body: 'y' }, reg.token))).json();
    const msgs = await (await app.request(`/api/tickets/${created.ticket.id}/messages`)).json();
    expect(msgs.some((m: { embeds?: { type: string }[] }) => m.embeds?.some((e) => e.type === 'outside_hours'))).toBe(false);
  });
});
