import { describe, expect, it } from 'vitest';
import { draftReply, suggestTriage, summarizeThread } from '../src/features/ai/engine';
import type { CannedReply } from '../src/data/types';

const canned: CannedReply[] = [
  { id: 'cr_1', title: 'Refund policy', body: 'Refunds are available within 30 days for unused items.' },
  { id: 'cr_2', title: 'API rate limits', body: 'The API allows 600 requests per minute per token.' },
];

describe('suggestTriage', () => {
  it('raises priority on urgent language', () => {
    const s = suggestTriage({ subject: 'Site is down', bodyText: 'urgent, we cannot access anything', currentPriority: 'medium', currentTags: [] });
    expect(s.priority).toBe('urgent');
  });
  it('does not lower an already-high priority', () => {
    const s = suggestTriage({ subject: 'Question about plans', bodyText: 'just curious', currentPriority: 'high', currentTags: [] });
    expect(s.priority).toBeNull();
  });
  it('suggests topic tags and skips ones already present', () => {
    const s = suggestTriage({ subject: 'Double charge on my invoice', bodyText: 'refund please', currentPriority: 'medium', currentTags: ['billing'] });
    expect(s.tags).toContain('refund');
    expect(s.tags).not.toContain('billing');
  });
});

describe('draftReply', () => {
  it('greets by first name and signs off with the agent', () => {
    const d = draftReply({ subject: 'Help', contactName: 'Sofia Marino', agentName: 'Sam Reed', lastCustomerMessage: 'hi', canned });
    expect(d.startsWith('Hi Sofia,')).toBe(true);
    expect(d).toContain('Sam');
  });
  it('uses a matching canned reply when the topic overlaps', () => {
    const d = draftReply({ subject: 'Refund for my order', contactName: 'Amara Okafor', agentName: 'Sam Reed', lastCustomerMessage: 'I want a refund for unused items within 30 days', canned });
    expect(d).toContain('Refunds are available');
  });
});

describe('summarizeThread', () => {
  it('summarizes the first ask and the latest message', () => {
    const s = summarizeThread({
      contactName: 'Yuki Tanaka',
      messages: [
        { authorKind: 'contact', kind: 'reply', body: 'Where is my order?' },
        { authorKind: 'agent', kind: 'reply', body: 'It shipped yesterday and arrives Friday.' },
      ],
    });
    expect(s).toContain('Yuki');
    expect(s).toContain('2 messages');
    expect(s).toContain('Latest from your team');
  });
});
