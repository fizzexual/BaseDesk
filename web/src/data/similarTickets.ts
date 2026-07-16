import type { Ticket } from './types';

// Lightweight "possible duplicate" detection: compare the current ticket's
// subject against every other live ticket by meaningful-word overlap (Jaccard).
// A shared requester boosts the score and lowers the bar, since duplicates almost
// always come from the same person. No embeddings, no service — pure and instant.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'into', 'this', 'that', 'my', 'your',
  'our', 'are', 'was', 'were', 'it', 'to', 'of', 'in', 'on', 'at', 'we', 'you', 'not', 'no', 'can',
  'cant', 'cannot', 'have', 'has', 'had', 'get', 'got', 'please', 'help', 'issue', 'problem',
  'support', 'ticket', 'about', 'when', 'why', 'how', 'again',
]);

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

export interface SimilarMatch {
  ticket: Ticket;
  score: number; // 0–1
  sameRequester: boolean;
}

/** Best possible-duplicate for `current` among `all`, or null if nothing is close enough. */
export function findSimilarTicket(current: Ticket, all: Ticket[]): SimilarMatch | null {
  const cur = tokens(current.subject);
  if (cur.size < 3) return null; // too little signal to trust
  let best: SimilarMatch | null = null;
  for (const t of all) {
    if (t.id === current.id || t.mergedIntoId !== null || t.bucket !== 'inbox') continue;
    const other = tokens(t.subject);
    let inter = 0;
    for (const w of cur) if (other.has(w)) inter++;
    if (inter < 2) continue; // need at least two shared meaningful words
    const jaccard = inter / (cur.size + other.size - inter);
    const sameRequester = t.requesterId === current.requesterId;
    const score = sameRequester ? Math.min(1, jaccard + 0.15) : jaccard;
    const threshold = sameRequester ? 0.34 : 0.5;
    if (score >= threshold && (best === null || score > best.score)) {
      best = { ticket: t, score, sameRequester };
    }
  }
  return best;
}
