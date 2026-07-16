import { describe, expect, it } from 'vitest';
import { weeklyLeaderboard } from '../src/features/team/scores';
import type { Ticket } from '../src/data/types';

const NOW = Date.parse('2026-07-16T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't', number: 1, subject: 's', status: 'solved', priority: 'medium', bucket: 'inbox',
    requesterId: 'c', assigneeId: 'a1', tags: [], channel: 'web',
    createdAt: ago(48), updatedAt: ago(1), snoozedUntil: null, lastMessageAt: ago(1), lastMessagePreview: '',
    firstRespondedAt: null, resolvedAt: null, channelId: null, mergedIntoId: null,
    awaitingReply: false, customFields: {}, category: null, ...over,
  } as Ticket;
}

describe('weeklyLeaderboard', () => {
  it('scores solves, CSAT, and fast responses, and ranks by points', () => {
    const tickets = [
      // a1: solved this week (+10), 5★ (+8), fast reply (+5) = 23
      ticket({ id: 't1', assigneeId: 'a1', createdAt: ago(30), resolvedAt: ago(2), satisfactionScore: 5, satisfactionAt: ago(1), firstRespondedAt: ago(29.5) }),
      // a1: another 4★ rating (+4) = 27, no solve
      ticket({ id: 't2', assigneeId: 'a1', createdAt: ago(30), resolvedAt: null, satisfactionScore: 4, satisfactionAt: ago(1) }),
      // a2: one solve (+10) = 10
      ticket({ id: 't3', assigneeId: 'a2', createdAt: ago(30), resolvedAt: ago(3) }),
    ];
    const board = weeklyLeaderboard(tickets, ['a1', 'a2'], NOW);
    expect(board.map((s) => s.agentId)).toEqual(['a1', 'a2']); // a1 leads
    expect(board[0].points).toBe(27);
    expect(board[0].solved).toBe(1);
    expect(board[0].avgCsat).toBe(4.5);
    expect(board[1].points).toBe(10);
  });

  it('ignores outcomes older than a week', () => {
    const board = weeklyLeaderboard(
      [ticket({ assigneeId: 'a1', resolvedAt: ago(24 * 9), satisfactionScore: 5, satisfactionAt: ago(24 * 9) })],
      ['a1'],
      NOW,
    );
    expect(board[0].points).toBe(0);
  });

  it('awards badges to the clear leaders', () => {
    const tickets = [
      ticket({ id: 'x1', assigneeId: 'a1', resolvedAt: ago(1) }),
      ticket({ id: 'x2', assigneeId: 'a1', resolvedAt: ago(2) }), // a1 = top solver (2)
      ticket({ id: 'y1', assigneeId: 'a2', satisfactionScore: 5, satisfactionAt: ago(1) }),
      ticket({ id: 'y2', assigneeId: 'a2', satisfactionScore: 5, satisfactionAt: ago(2) }), // a2 = customer favourite (avg 5, 2 ratings)
    ];
    const board = weeklyLeaderboard(tickets, ['a1', 'a2'], NOW);
    const a1 = board.find((s) => s.agentId === 'a1')!;
    const a2 = board.find((s) => s.agentId === 'a2')!;
    expect(a1.badges).toContain('🏆 Top solver');
    expect(a2.badges).toContain('⭐ Customer favourite');
  });
});
