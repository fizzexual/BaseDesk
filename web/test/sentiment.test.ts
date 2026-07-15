import { describe, expect, it } from 'vitest';
import { classify, scoreText, ticketSentiment } from '../src/data/sentiment';

describe('sentiment', () => {
  it('reads emotional tone, not generic support terms', () => {
    expect(classify(scoreText('Thank you so much, this was excellent and really helpful!'))).toBe('positive');
    expect(classify(scoreText('This is absolutely terrible and I am furious.'))).toBe('negative');
    // "issue", "invoice", "login", "problem" describe the request, not a mood.
    expect(classify(scoreText('I have an issue with my invoice and a login problem.'))).toBe('neutral');
  });

  it('sums tone across a customer’s messages', () => {
    expect(ticketSentiment(['I have a problem with billing', 'honestly this is unacceptable and awful'])).toBe('negative');
    expect(ticketSentiment(['thanks!', 'you are amazing'])).toBe('positive');
    expect(ticketSentiment(['can you help me set up X'])).toBe('neutral');
    expect(ticketSentiment([])).toBe('neutral');
  });
});
