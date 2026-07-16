import { describe, expect, it } from 'vitest';
import { findSimilarTicket } from '../src/data/similarTickets';
import type { Ticket } from '../src/data/types';

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't', number: 1, subject: '', status: 'open', priority: 'medium', bucket: 'inbox',
    requesterId: 'c1', assigneeId: null, tags: [], channel: 'web',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    snoozedUntil: null, lastMessageAt: '2026-01-01T00:00:00Z', lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null,
    awaitingReply: false, customFields: {}, category: null, ...over,
  } as Ticket;
}

describe('findSimilarTicket', () => {
  const current = ticket({ id: 'cur', number: 10, requesterId: 'c1', subject: 'Refund for order 5567 not received' });

  it('matches a near-identical subject from the same contact', () => {
    const other = ticket({ id: 'o1', number: 4, requesterId: 'c1', subject: 'Refund for order 5567 still missing' });
    const m = findSimilarTicket(current, [current, other]);
    expect(m?.ticket.id).toBe('o1');
    expect(m?.sameRequester).toBe(true);
  });

  it('ignores unrelated tickets', () => {
    const other = ticket({ id: 'o2', number: 5, requesterId: 'c2', subject: 'How do I change my avatar picture' });
    expect(findSimilarTicket(current, [current, other])).toBeNull();
  });

  it('skips merged tombstones and non-inbox tickets', () => {
    const merged = ticket({ id: 'o3', requesterId: 'c1', subject: 'Refund for order 5567 not received', mergedIntoId: 'x' });
    const spam = ticket({ id: 'o4', requesterId: 'c1', subject: 'Refund for order 5567 not received', bucket: 'spam' });
    expect(findSimilarTicket(current, [current, merged, spam])).toBeNull();
  });

  it('needs enough signal (short subjects do not match)', () => {
    const a = ticket({ id: 'a', subject: 'Login', requesterId: 'c1' });
    const b = ticket({ id: 'b', subject: 'Login', requesterId: 'c1' });
    expect(findSimilarTicket(a, [a, b])).toBeNull();
  });
});
