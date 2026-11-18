import { describe, expect, it } from 'vitest';
import { businessDueMs, expectedFirstReplyAt } from '../src/sla.js';
import { DEFAULT_SLA_TARGETS, DEFAULT_SLA_HOURS } from '../src/defaults.js';
import type { SlaHours, Ticket } from '../src/types.js';

const NOW = Date.parse('2026-07-15T12:00:00Z');

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't1', number: 1, subject: 'x', status: 'open', priority: 'high', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    snoozedUntil: null, lastMessageAt: new Date(NOW).toISOString(), lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null,
    customFields: {}, awaitingReply: true, category: null,
    ...over,
  } as Ticket;
}

describe('businessDueMs', () => {
  it('counts only working hours across a weekend', () => {
    const hours: SlaHours = { enabled: true, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [] };
    const satNoon = Date.parse('2026-07-11T12:00:00Z'); // a Saturday
    // 60 minutes of business time → Monday 09:00 + 60m = Monday 10:00.
    expect(new Date(businessDueMs(satNoon, 60, hours)).toISOString()).toBe('2026-07-13T10:00:00.000Z');
  });
});

describe('expectedFirstReplyAt', () => {
  it('is created + first-response target while awaiting a reply (calendar hours)', () => {
    const hours: SlaHours = { ...DEFAULT_SLA_HOURS, enabled: false };
    const at = expectedFirstReplyAt(ticket({ priority: 'high' }), DEFAULT_SLA_TARGETS, hours);
    expect(at).not.toBeNull();
    expect(Date.parse(at!)).toBe(NOW + DEFAULT_SLA_TARGETS.high.firstResponseMins * 60_000);
  });
  it('is null once a reply was sent', () => {
    expect(expectedFirstReplyAt(ticket({ firstRespondedAt: new Date(NOW).toISOString() }), DEFAULT_SLA_TARGETS, DEFAULT_SLA_HOURS)).toBeNull();
  });
  it('is null when resolved or outside the inbox', () => {
    expect(expectedFirstReplyAt(ticket({ status: 'solved' }), DEFAULT_SLA_TARGETS, DEFAULT_SLA_HOURS)).toBeNull();
    expect(expectedFirstReplyAt(ticket({ bucket: 'archive' }), DEFAULT_SLA_TARGETS, DEFAULT_SLA_HOURS)).toBeNull();
  });
});
