import { describe, expect, it } from 'vitest';
import { computeTicketSla, slaAttainment } from '../src/data/sla';
import { DEFAULT_SLA_TARGETS } from '../src/data/defaults';
import type { Ticket } from '../src/data/types';

const NOW = Date.parse('2026-07-12T12:00:00Z');

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't1', number: 1, subject: 'x', status: 'open', priority: 'high', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    snoozedUntil: null, lastMessageAt: new Date(NOW).toISOString(), lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null,
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
