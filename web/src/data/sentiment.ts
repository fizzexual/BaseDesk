export type Sentiment = 'positive' | 'neutral' | 'negative';

// Emotional-tone words only — deliberately NOT generic support terms like
// "issue"/"problem"/"error"/"refund", which describe the request, not the mood,
// and would tip every ticket negative.
const POSITIVE = [
  'thank', 'appreciate', 'grateful', 'great', 'awesome', 'love ', 'loving', 'excellent', 'perfect',
  'happy', 'glad', 'wonderful', 'amazing', 'fantastic', 'brilliant', 'pleased', 'delighted', 'helpful', 'lifesaver',
];
const NEGATIVE = [
  'angry', 'terrible', 'awful', 'frustrat', 'disappoint', 'unacceptable', 'ridiculous', 'useless', 'horrible',
  'hate', 'furious', 'upset', 'worst', 'disgust', 'appalling', 'outrageous', 'fed up', 'annoyed', 'annoying',
  'infuriat', 'pathetic', 'nonsense', 'shameful', 'livid',
];

/** Net tone of a single message: +1 per distinct positive cue, −1 per negative cue. */
export function scoreText(text: string): number {
  const lc = ` ${text.toLowerCase()} `;
  let s = 0;
  for (const w of POSITIVE) if (lc.includes(w)) s += 1;
  for (const w of NEGATIVE) if (lc.includes(w)) s -= 1;
  return s;
}

export function classify(score: number): Sentiment {
  if (score >= 1) return 'positive';
  if (score <= -1) return 'negative';
  return 'neutral';
}

/** Overall customer sentiment across their messages (summed tone). */
export function ticketSentiment(customerTexts: string[]): Sentiment {
  return classify(customerTexts.reduce((s, t) => s + scoreText(t), 0));
}

export const SENTIMENT_META: Record<Sentiment, { label: string; color: string }> = {
  positive: { label: 'Positive', color: 'var(--green)' },
  neutral: { label: 'Neutral', color: 'var(--gray-dot)' },
  negative: { label: 'Negative', color: 'var(--red)' },
};
