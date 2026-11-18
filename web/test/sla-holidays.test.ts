import { describe, expect, it } from 'vitest';
import { businessDueMs, computeTicketSla } from '../src/data/sla';
import { DEFAULT_SLA_TARGETS } from '../src/data/defaults';
import type { SlaHours, Ticket } from '../src/data/types';

const hours: SlaHours = { enabled: true, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [] };
const at = (iso: string) => new Date(iso).getTime();

describe('web SLA clock honours holidays (mirror of the server)', () => {
  it('skips a holiday day', () => {
    const due = businessDueMs(at('2026-12-21T16:00:00Z'), 120, { ...hours, holidays: ['2026-12-22'] });
    expect(new Date(due).toISOString()).toBe('2026-12-23T10:00:00.000Z');
  });

  it('a ticket is on track, not overdue, while the desk is off for a holiday', () => {
    const ticket = {
      id: 't1', number: 1, subject: 's', status: 'open', priority: 'high', bucket: 'inbox',
      requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
      createdAt: '2026-12-21T16:30:00Z', updatedAt: '2026-12-21T16:30:00Z',
      snoozedUntil: null, firstRespondedAt: null, resolvedAt: null,
    } as unknown as Ticket;
    // High = 60 business minutes. Mon 16:30 + 30 min = 17:00, rest on Tue — but Tue is a holiday.
    const now = at('2026-12-22T12:00:00Z');
    expect(computeTicketSla(ticket, DEFAULT_SLA_TARGETS, now, hours)?.state).toBe('breached');
    expect(computeTicketSla(ticket, DEFAULT_SLA_TARGETS, now, { ...hours, holidays: ['2026-12-22'] })?.state).not.toBe('breached');
  });
});
