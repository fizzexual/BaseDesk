import { describe, expect, it } from 'vitest';
import { supportTimers, formatDuration } from '../src/data/supportTime';
import type { Ticket } from '../src/data/types';

const HOUR = 3_600_000;

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't1', number: 1, subject: 's', status: 'open', priority: 'medium', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    snoozedUntil: null, lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null,
    awaitingReply: false, customFields: {}, category: null,
    ...over,
  } as Ticket;
}

const at = (iso: string) => Date.parse(iso);

describe('supportTimers', () => {
  it('runs the total clock from creation while open', () => {
    const t = ticket({ status: 'open', createdAt: '2026-01-01T00:00:00.000Z' });
    const r = supportTimers(t, at('2026-01-01T02:30:00.000Z'));
    expect(r.totalMs).toBe(2.5 * HOUR);
    expect(r.running).toBe(true);
  });

  it('leaves the agent clock null until the first agent reply', () => {
    const t = ticket({ firstRespondedAt: null });
    expect(supportTimers(t, at('2026-01-01T05:00:00.000Z')).agentMs).toBeNull();
  });

  it('runs the agent clock from the first agent reply', () => {
    const t = ticket({ createdAt: '2026-01-01T00:00:00.000Z', firstRespondedAt: '2026-01-01T01:00:00.000Z' });
    const r = supportTimers(t, at('2026-01-01T03:00:00.000Z'));
    expect(r.totalMs).toBe(3 * HOUR);
    expect(r.agentMs).toBe(2 * HOUR);
  });

  it('freezes both clocks at resolvedAt once solved/closed', () => {
    const t = ticket({
      status: 'closed', createdAt: '2026-01-01T00:00:00.000Z',
      firstRespondedAt: '2026-01-01T01:00:00.000Z', resolvedAt: '2026-01-01T04:00:00.000Z',
    });
    // now is well past resolution, but the clocks stop at resolvedAt.
    const r = supportTimers(t, at('2026-01-05T00:00:00.000Z'));
    expect(r.totalMs).toBe(4 * HOUR);
    expect(r.agentMs).toBe(3 * HOUR);
    expect(r.running).toBe(false);
  });

  it('resumes counting when a resolved ticket is reopened', () => {
    // resolvedAt stays stamped, but a non-terminal status means the clock is live again.
    const t = ticket({ status: 'open', createdAt: '2026-01-01T00:00:00.000Z', resolvedAt: '2026-01-01T04:00:00.000Z' });
    const r = supportTimers(t, at('2026-01-01T06:00:00.000Z'));
    expect(r.totalMs).toBe(6 * HOUR);
    expect(r.running).toBe(true);
  });
});

describe('formatDuration', () => {
  it('formats at most two units', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(2 * HOUR + 14 * 60_000)).toBe('2h 14m');
    expect(formatDuration(3 * 86_400_000 + 5 * HOUR)).toBe('3d 5h');
    expect(formatDuration(-100)).toBe('0s');
  });
});
