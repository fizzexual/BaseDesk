import { describe, expect, it } from 'vitest';
import { formatMetricValue, runReport } from '../src/features/reports/runReport';
import type { Agent, CustomReport, Ticket } from '../src/data/types';

const NOW = Date.now();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't', number: 1, subject: 'x', status: 'open', priority: 'high', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: daysAgo(0), updatedAt: daysAgo(0), snoozedUntil: null, lastMessageAt: daysAgo(0),
    lastMessagePreview: '', firstRespondedAt: null, resolvedAt: null, channelId: null,
    mergedIntoId: null, customFields: {}, awaitingReply: false, category: null,
    ...over,
  };
}
const agents: Record<string, Agent> = {
  a1: { id: 'a1', name: 'Alice' } as Agent,
  a2: { id: 'a2', name: 'Bob' } as Agent,
};
const cfg = (o: Partial<CustomReport>): CustomReport => ({ id: '', name: 'r', metric: 'volume', dimension: 'priority', range: 'all', ...o });

describe('runReport', () => {
  it('counts volume by priority, most first', () => {
    const rows = runReport(cfg({ metric: 'volume', dimension: 'priority' }), [ticket({ priority: 'high' }), ticket({ priority: 'high' }), ticket({ priority: 'low' })], agents);
    expect(rows.map((r) => [r.label, r.value])).toEqual([['High', 2], ['Low', 1]]);
  });

  it('counts solved tickets per status group', () => {
    const rows = runReport(cfg({ metric: 'solved', dimension: 'status' }), [ticket({ status: 'solved' }), ticket({ status: 'closed' }), ticket({ status: 'open' })], agents);
    expect(rows.find((r) => r.key === 'solved')!.value).toBe(1);
    expect(rows.find((r) => r.key === 'closed')!.value).toBe(1);
    expect(rows.find((r) => r.key === 'open')!.value).toBe(0);
  });

  it('averages CSAT by agent', () => {
    const rows = runReport(cfg({ metric: 'csat', dimension: 'agent' }), [
      ticket({ assigneeId: 'a1', satisfactionScore: 5 }),
      ticket({ assigneeId: 'a1', satisfactionScore: 3 }),
      ticket({ assigneeId: 'a2', satisfactionScore: 4 }),
    ], agents);
    expect(rows.find((r) => r.label === 'Alice')!.value).toBe(4);
    expect(rows.find((r) => r.label === 'Bob')!.value).toBe(4);
  });

  it('zero-fills every day in a fixed range', () => {
    const rows = runReport(cfg({ metric: 'volume', dimension: 'day', range: 'last_7' }), [ticket({ createdAt: daysAgo(1) })], agents);
    expect(rows).toHaveLength(7);
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(1);
  });

  it('excludes tickets outside the range', () => {
    const rows = runReport(cfg({ metric: 'volume', dimension: 'priority', range: 'last_7' }), [ticket({ createdAt: daysAgo(2) }), ticket({ createdAt: daysAgo(40) })], agents);
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(1);
  });

  it('formats metric values with units', () => {
    expect(formatMetricValue('resolution', 5)).toBe('5h');
    expect(formatMetricValue('resolution', 48)).toBe('2d');
    expect(formatMetricValue('csat', 4.6)).toBe('4.6');
    expect(formatMetricValue('csat', 0)).toBe('—');
    expect(formatMetricValue('volume', 12)).toBe('12');
  });
});
