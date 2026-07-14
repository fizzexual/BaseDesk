import { describe, expect, it } from 'vitest';
import { computeTicketSla, slaAttainment } from '../src/data/sla';
import { DEFAULT_SLA_TARGETS } from '../src/data/defaults';
import type { SlaHours, Ticket } from '../src/data/types';

const NOW = Date.parse('2026-07-12T12:00:00Z'); // a Sunday

// Mon–Fri, 09:00–17:00 UTC (an 8-hour, 480-minute working day).
const BIZ: SlaHours = { enabled: true, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't1', number: 1, subject: 'x', status: 'open', priority: 'high', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    snoozedUntil: null, lastMessageAt: new Date(NOW).toISOString(), lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null, customFields: {},
    awaitingReply: false, category: null,
    ...over,
  };
}

describe('computeTicketSla', () => {
  it('is on_track for a fresh high-priority ticket (60m first response)', () => {
    const sla = computeTicketSla(ticket({}), DEFAULT_SLA_TARGETS, NOW);
    expect(sla?.clock).toBe('first_response');
    expect(sla?.state).toBe('on_track');
  });

  it('breaches when first response is overdue', () => {
    const created = new Date(NOW - 2 * 3600_000).toISOString(); // 2h ago, target 60m
    const sla = computeTicketSla(ticket({ createdAt: created }), DEFAULT_SLA_TARGETS, NOW);
    expect(sla?.state).toBe('breached');
  });

  it('moves to the resolution clock once responded', () => {
    const created = new Date(NOW - 30 * 60_000).toISOString();
    const sla = computeTicketSla(
      ticket({ createdAt: created, firstRespondedAt: new Date(NOW - 10 * 60_000).toISOString() }),
      DEFAULT_SLA_TARGETS, NOW,
    );
    expect(sla?.clock).toBe('resolution');
  });

  it('pauses on hold', () => {
    const sla = computeTicketSla(ticket({ status: 'on_hold' }), DEFAULT_SLA_TARGETS, NOW);
    expect(sla?.state).toBe('paused');
  });

  it('reports met for a resolved ticket that beat its targets', () => {
    const created = new Date(NOW - 60 * 60_000).toISOString();
    const sla = computeTicketSla(
      ticket({
        status: 'solved', createdAt: created,
        firstRespondedAt: new Date(NOW - 55 * 60_000).toISOString(),
        resolvedAt: new Date(NOW - 10 * 60_000).toISOString(),
      }),
      DEFAULT_SLA_TARGETS, NOW,
    );
    expect(sla?.clock).toBe('done');
    expect(sla?.state).toBe('met');
  });

  it('returns null outside the inbox', () => {
    expect(computeTicketSla(ticket({ bucket: 'trash' }), DEFAULT_SLA_TARGETS, NOW)).toBeNull();
  });
});

describe('computeTicketSla with business hours', () => {
  // Friday 16:00 UTC, one hour before close. Resolution target (high) is 480 min:
  // 60 min run Friday, the weekend is skipped, the remaining 420 finish Monday 16:00.
  const created = '2026-07-10T16:00:00Z';
  const responded = '2026-07-10T16:10:00Z';

  it('pauses the resolution clock over the weekend', () => {
    const t = ticket({ createdAt: created, firstRespondedAt: responded });
    // Raw 24/7 clock: due Saturday 00:00, so Sunday noon is already breached.
    expect(computeTicketSla(t, DEFAULT_SLA_TARGETS, NOW)?.state).toBe('breached');
    // Business hours: due Monday 16:00, so Sunday noon is still on track.
    const biz = computeTicketSla(t, DEFAULT_SLA_TARGETS, NOW, BIZ);
    expect(biz?.clock).toBe('resolution');
    expect(biz?.state).toBe('on_track');
  });

  it('breaches once the business-hours deadline actually passes', () => {
    const t = ticket({ createdAt: created, firstRespondedAt: responded });
    const monEvening = Date.parse('2026-07-13T16:30:00Z'); // just past the Monday 16:00 due time
    expect(computeTicketSla(t, DEFAULT_SLA_TARGETS, monEvening, BIZ)?.state).toBe('breached');
  });

  it('is identical to the raw clock when hours are disabled', () => {
    const t = ticket({ createdAt: new Date(NOW - 2 * 3600_000).toISOString() });
    const off: SlaHours = { ...BIZ, enabled: false };
    expect(computeTicketSla(t, DEFAULT_SLA_TARGETS, NOW, off)?.state).toBe(
      computeTicketSla(t, DEFAULT_SLA_TARGETS, NOW)?.state,
    );
  });

  it('counts attainment against the business-hours deadline', () => {
    // Resolved Monday 15:00 — past the raw Saturday 00:00 due, but before the
    // business-hours Monday 16:00 due, so it is a miss raw and a hit with hours.
    const t = ticket({
      status: 'solved', createdAt: created, firstRespondedAt: responded,
      resolvedAt: '2026-07-13T15:00:00Z',
    });
    expect(slaAttainment([t], DEFAULT_SLA_TARGETS).resolutionPct).toBe(0);
    expect(slaAttainment([t], DEFAULT_SLA_TARGETS, BIZ).resolutionPct).toBe(1);
  });
});

describe('slaAttainment', () => {
  it('computes met percentages over milestone-reached tickets', () => {
    // high target = 60m first response. met: responded 5m after creation; missed: 110m after.
    const met = ticket({
      createdAt: new Date(NOW - 60 * 60_000).toISOString(),
      firstRespondedAt: new Date(NOW - 55 * 60_000).toISOString(),
    });
    const missed = ticket({
      id: 't2',
      createdAt: new Date(NOW - 120 * 60_000).toISOString(),
      firstRespondedAt: new Date(NOW - 10 * 60_000).toISOString(),
    });
    const a = slaAttainment([met, missed], DEFAULT_SLA_TARGETS);
    expect(a.firstResponseSample).toBe(2);
    expect(a.firstResponsePct).toBe(0.5);
  });
});
