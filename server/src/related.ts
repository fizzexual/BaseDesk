// Finding related tickets by walking the knowledge graph instead of sweeping the
// whole table: classify the ticket into its category → sub-category branch, then
// only compare against that branch. On a 2,500-ticket desk that turns a full scan
// into a couple of hundred comparisons, and the survivors are better matches
// because a true duplicate almost always lives in the same branch.

import { classifySub } from './taxonomy.js';

export interface RelatedRow {
  id: string;
  number: number;
  subject: string;
  status: string;
  category: string;
  requesterId: string;
}

export interface RelatedMatch {
  id: string;
  number: number;
  title: string;
  status: string;
  /** 0–1 subject overlap, nudged up when the same customer opened both. */
  score: number;
  sameRequester: boolean;
}

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

/** Widen from the sub-category to the whole category when the branch is too thin to be useful. */
const MIN_BRANCH = 20;

export interface RelatedResult {
  sub: string;
  /** Which branch we actually searched — 'sub' normally, 'category' when the sub-branch was too small. */
  scope: 'sub' | 'category';
  compared: number;
  matches: RelatedMatch[];
}

/**
 * Related tickets for `current`, searched only within its own branch.
 * `pool` is every active ticket; nothing outside the chosen branch is scored.
 */
export function findRelated(current: RelatedRow, pool: RelatedRow[], limit = 5): RelatedResult {
  const sub = classifySub(current.category, current.subject);
  const inCategory = pool.filter((t) => t.id !== current.id && t.category === current.category);
  const inSub = inCategory.filter((t) => classifySub(t.category, t.subject) === sub);

  // Walk one level up the tree when the sub-category alone gives us too little.
  const narrow = inSub.length >= MIN_BRANCH;
  const branch = narrow ? inSub : inCategory;
  const scope: 'sub' | 'category' = narrow ? 'sub' : 'category';

  const cur = tokens(current.subject);
  const matches: RelatedMatch[] = [];
  if (cur.size >= 3) {
    for (const t of branch) {
      const other = tokens(t.subject);
      let inter = 0;
      for (const w of cur) if (other.has(w)) inter += 1;
      if (inter < 2) continue; // need at least two shared meaningful words
      const jaccard = inter / (cur.size + other.size - inter);
      const sameRequester = t.requesterId === current.requesterId;
      const score = sameRequester ? Math.min(1, jaccard + 0.15) : jaccard;
      if (score < (sameRequester ? 0.34 : 0.5)) continue;
      matches.push({ id: t.id, number: t.number, title: t.subject, status: t.status, score: Math.round(score * 100) / 100, sameRequester });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { sub, scope, compared: branch.length, matches: matches.slice(0, limit) };
}
